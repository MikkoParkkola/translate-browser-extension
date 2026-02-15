/**
 * WebGPU/WASM inference engine using wllama
 * Replaces the old mock llama.cpp WASM interface with real inference via @wllama/wllama.
 *
 * Solves: RangeError: Array buffer allocation failed (single 2.5GB ArrayBuffer)
 * by using wllama's built-in chunked/sharded model loading and WebGPU acceleration.
 *
 * Provides a high-level API consumed by LocalModelManager and llamacpp-worker.
 */

// We dynamically import the wllama bundle so this file works in both
// module (service-worker) and classic-script (web-page) contexts.
let _WllamaModule = null;

async function getWllamaModule() {
  if (_WllamaModule) return _WllamaModule;

  // In extension context, import from the bundled copy
  try {
    const mod = await import('./wllama.bundle.js');
    _WllamaModule = mod;
    return mod;
  } catch (err) {
    console.error('[InferenceEngine] Failed to import wllama bundle:', err);
    throw new Error(`Failed to load inference engine: ${  err.message}`);
  }
}

/**
 * Detect WebGPU availability in the current environment.
 * @returns {Promise<boolean>}
 */
async function detectWebGPU() {
  try {
    if (typeof navigator === 'undefined') return false;
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * High-level inference engine wrapping wllama.
 * Handles model loading (with sharding support), inference, and cleanup.
 */
class InferenceEngine {
  constructor() {
    /** @type {import('@wllama/wllama').Wllama | null} */
    this.wllama = null;
    this.isModelLoaded = false;
    this.hasWebGPU = false;
    this.modelInfo = null;
    this._abortController = null;
  }

  /**
   * Initialize the engine (creates the Wllama instance).
   * Call this once before loadModel().
   * @param {object} [options]
   * @param {boolean} [options.suppressNativeLog=false]
   * @param {number}  [options.parallelDownloads=3]
   */
  async init(options = {}) {
    const mod = await getWllamaModule();
    const { Wllama } = mod;

    this.hasWebGPU = await detectWebGPU();

    console.log('[InferenceEngine] WebGPU available:', this.hasWebGPU);

    // Determine WASM paths -- use local copies shipped with the extension
    const extensionBase = (typeof chrome !== 'undefined' && chrome.runtime)
      ? chrome.runtime.getURL('')
      : './';

    const wasmPaths = {
      'single-thread/wllama.wasm': `${extensionBase  }wllama-single.wasm`,
      'multi-thread/wllama.wasm': `${extensionBase  }wllama-multi.wasm`,
    };

    this.wllama = new Wllama(wasmPaths, {
      suppressNativeLog: options.suppressNativeLog || false,
      parallelDownloads: options.parallelDownloads || 3,
      allowOffline: true,
      logger: {
        debug: (...args) => console.debug('[wllama]', ...args),
        log: (...args) => console.log('[wllama]', ...args),
        warn: (...args) => console.warn('[wllama]', ...args),
        error: (...args) => console.error('[wllama]', ...args),
      },
    });

    console.log('[InferenceEngine] Engine initialized');
    return { success: true, hasWebGPU: this.hasWebGPU };
  }

  /**
   * Load a model from one or more URLs (supports sharded GGUF).
   *
   * For sharded models, pass an array of URLs for each shard.
   * wllama handles downloading, caching, and reassembling them internally --
   * no single large ArrayBuffer is ever created.
   *
   * @param {string|string[]} modelUrls  Single URL or array of shard URLs
   * @param {object} [config]            LoadModelConfig overrides
   * @param {function} [onProgress]      Progress callback: ({loaded, total, progress})
   * @returns {Promise<{success: boolean}>}
   */
  async loadModel(modelUrls, config = {}, onProgress = null) {
    if (!this.wllama) {
      throw new Error('Engine not initialized. Call init() first.');
    }

    if (this.isModelLoaded) {
      console.log('[InferenceEngine] Unloading previous model before loading new one');
      await this.unloadModel();
    }

    const urls = Array.isArray(modelUrls) ? modelUrls : [modelUrls];

    console.log('[InferenceEngine] Loading model from', urls.length, 'shard(s)');

    const loadConfig = {
      n_ctx: config.n_ctx || 2048,
      n_batch: config.n_batch || 512,
      n_threads: config.n_threads || Math.min(navigator.hardwareConcurrency || 4, 4),
      cache_type_k: config.cache_type_k || 'q8_0',
      cache_type_v: config.cache_type_v || 'q8_0',
      ...config,
    };

    try {
      // wllama.loadModelFromUrl handles:
      // - Parallel chunked downloads
      // - Browser cache (Cache API or IndexedDB)
      // - No single large ArrayBuffer
      await this.wllama.loadModelFromUrl(urls, {
        ...loadConfig,
        progressCallback: onProgress ? ({ loaded, total }) => {
          const progress = total > 0 ? (loaded / total) * 100 : 0;
          onProgress({ loaded, total, progress });
        } : undefined,
      });

      this.isModelLoaded = true;
      this.modelInfo = this.wllama.getLoadedContextInfo();

      console.log('[InferenceEngine] Model loaded successfully:', this.modelInfo);
      return { success: true, modelInfo: this.modelInfo };

    } catch (error) {
      console.error('[InferenceEngine] Model loading failed:', error);
      this.isModelLoaded = false;
      throw error;
    }
  }

  /**
   * Load a model from local Blob(s) (for pre-downloaded models stored in IndexedDB).
   *
   * @param {Blob[]} blobs   Array of Blob objects (one per shard)
   * @param {object} [config]  LoadModelConfig overrides
   * @returns {Promise<{success: boolean}>}
   */
  async loadModelFromBlobs(blobs, config = {}) {
    if (!this.wllama) {
      throw new Error('Engine not initialized. Call init() first.');
    }

    if (this.isModelLoaded) {
      await this.unloadModel();
    }

    const loadConfig = {
      n_ctx: config.n_ctx || 2048,
      n_batch: config.n_batch || 512,
      n_threads: config.n_threads || Math.min(navigator.hardwareConcurrency || 4, 4),
      cache_type_k: config.cache_type_k || 'q8_0',
      cache_type_v: config.cache_type_v || 'q8_0',
      ...config,
    };

    try {
      await this.wllama.loadModel(blobs, loadConfig);
      this.isModelLoaded = true;
      this.modelInfo = this.wllama.getLoadedContextInfo();
      console.log('[InferenceEngine] Model loaded from blobs:', this.modelInfo);
      return { success: true, modelInfo: this.modelInfo };
    } catch (error) {
      console.error('[InferenceEngine] Model loading from blobs failed:', error);
      this.isModelLoaded = false;
      throw error;
    }
  }

  /**
   * Translate text by running completion on a translation prompt.
   *
   * @param {string} prompt       Full formatted prompt (with instruction template)
   * @param {object} [options]
   * @param {number} [options.maxTokens=512]
   * @param {number} [options.temperature=0.1]
   * @param {AbortSignal} [options.abortSignal]
   * @returns {Promise<{text: string, tokensGenerated: number}>}
   */
  async complete(prompt, options = {}) {
    if (!this.isModelLoaded || !this.wllama) {
      throw new Error('Model not loaded');
    }

    const maxTokens = options.maxTokens || 512;
    const temperature = options.temperature || 0.1;

    // Use createCompletion for raw prompt completion
    const result = await this.wllama.createCompletion(prompt, {
      nPredict: maxTokens,
      sampling: {
        temp: temperature,
        top_p: 0.9,
        top_k: 40,
        penalty_repeat: 1.1,
      },
      abortSignal: options.abortSignal,
    });

    // Count tokens in result (approximate via wllama tokenize)
    let tokensGenerated = 0;
    try {
      const tokens = await this.wllama.tokenize(result);
      tokensGenerated = tokens.length;
    } catch {
      // Approximate: ~4 chars per token
      tokensGenerated = Math.ceil(result.length / 4);
    }

    return {
      text: result.trim(),
      tokensGenerated,
    };
  }

  /**
   * Run chat completion using the model's chat template.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [options]
   * @returns {Promise<{text: string, tokensGenerated: number}>}
   */
  async chatComplete(messages, options = {}) {
    if (!this.isModelLoaded || !this.wllama) {
      throw new Error('Model not loaded');
    }

    const maxTokens = options.maxTokens || 512;
    const temperature = options.temperature || 0.1;

    const result = await this.wllama.createChatCompletion(messages, {
      nPredict: maxTokens,
      sampling: {
        temp: temperature,
        top_p: 0.9,
        top_k: 40,
        penalty_repeat: 1.1,
      },
      abortSignal: options.abortSignal,
    });

    let tokensGenerated = 0;
    try {
      const tokens = await this.wllama.tokenize(result);
      tokensGenerated = tokens.length;
    } catch {
      tokensGenerated = Math.ceil(result.length / 4);
    }

    return {
      text: result.trim(),
      tokensGenerated,
    };
  }

  /**
   * Abort the current generation.
   */
  abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /**
   * Unload the model and free memory.
   */
  async unloadModel() {
    if (this.wllama) {
      try {
        await this.wllama.exit();
      } catch (err) {
        console.warn('[InferenceEngine] Error during model unload:', err);
      }
    }
    this.isModelLoaded = false;
    this.modelInfo = null;
    console.log('[InferenceEngine] Model unloaded');
  }

  /**
   * Full cleanup -- destroys the wllama instance.
   */
  async destroy() {
    await this.unloadModel();
    this.wllama = null;
    console.log('[InferenceEngine] Engine destroyed');
  }

  /**
   * Get model context info if loaded.
   */
  getContextInfo() {
    if (!this.isModelLoaded || !this.wllama) return null;
    return this.wllama.getLoadedContextInfo();
  }

  /**
   * Check if engine is ready for inference.
   */
  isReady() {
    return this.isModelLoaded && this.wllama !== null;
  }
}

// Export for ES module and classic script contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { InferenceEngine, detectWebGPU };
} else if (typeof self !== 'undefined') {
  self.InferenceEngine = InferenceEngine;
  self.detectWebGPU = detectWebGPU;
}

export { InferenceEngine, detectWebGPU };
