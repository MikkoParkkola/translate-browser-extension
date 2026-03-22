import { createLogger } from './core/logger';

const log = createLogger('InferenceEngine');

/**
 * WebGPU/WASM inference engine using wllama
 * Replaces the old mock llama.cpp WASM interface with real inference via @wllama/wllama.
 *
 * Solves: RangeError: Array buffer allocation failed (single 2.5GB ArrayBuffer)
 * by using wllama's built-in chunked/sharded model loading and WebGPU acceleration.
 *
 * Provides a high-level API consumed by LocalModelManager and llamacpp-worker.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Options passed to InferenceEngine.init() */
interface InitOptions {
  suppressNativeLog?: boolean;
  parallelDownloads?: number;
}

/** Config overrides forwarded to wllama's loadModel / loadModelFromUrl */
interface LoadModelConfig {
  n_ctx?: number;
  n_batch?: number;
  n_threads?: number;
  cache_type_k?: string;
  cache_type_v?: string;
  [key: string]: unknown;
}

/** Options for text completion */
interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

/** Options for chat completion */
interface ChatCompleteOptions {
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

/** Progress info emitted during model download */
interface ProgressInfo {
  loaded: number;
  total: number;
  progress: number;
  elapsed: number;
}

/** Value returned from complete() and chatComplete() */
interface CompletionResult {
  text: string;
  tokensGenerated: number;
}

/** Opaque context info returned by wllama */
interface ModelInfo {
  [key: string]: unknown;
}

/** A single chat message */
interface ChatMessage {
  role: string;
  content: string;
}

/** Subset of the wllama instance API that InferenceEngine actually uses */
interface WllamaInstance {
  loadModelFromUrl(
    urls: string[],
    config: Record<string, unknown>,
  ): Promise<void>;
  loadModel(blobs: Blob[], config: Record<string, unknown>): Promise<void>;
  createCompletion(
    prompt: string,
    opts: Record<string, unknown>,
  ): Promise<string>;
  createChatCompletion(
    messages: ChatMessage[],
    opts: Record<string, unknown>,
  ): Promise<string>;
  tokenize(text: string): Promise<number[]>;
  getLoadedContextInfo(): ModelInfo;
  exit(): Promise<void>;
}

/** Shape of the dynamically-imported wllama bundle */
interface WllamaModule {
  Wllama: new (...args: unknown[]) => WllamaInstance;
}

/** Chrome-only Performance.memory (non-standard) */
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

// We dynamically import the wllama bundle so this file works in both
// module (service-worker) and classic-script (web-page) contexts.
// Cache the import promise (not the result) to avoid race conditions
// when multiple callers invoke getWllamaModule() concurrently.
let _wllamaPromise: Promise<WllamaModule> | null = null;

async function getWllamaModule(): Promise<WllamaModule> {
  if (!_wllamaPromise) {
    // @ts-expect-error -- bundled JS without type declarations
    _wllamaPromise = (import('./wllama.bundle.js') as Promise<WllamaModule>).catch((err: Error) => {
      _wllamaPromise = null;
      log.error('Failed to import wllama bundle:', err);
      throw new Error(`Failed to load inference engine: ${err.message}`);
    });
  }
  return _wllamaPromise;
}

/**
 * Detect WebGPU availability in the current environment.
 */
async function detectWebGPU(): Promise<boolean> {
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
 * Log memory usage if performance.memory is available (Chrome only).
 */
function logMemoryUsage(label: string): void {
  try {
    const mem = (performance as unknown as { memory?: PerformanceMemory }).memory;
    if (typeof performance !== 'undefined' && mem) {
      const usedMB = (mem.usedJSHeapSize / (1024 * 1024)).toFixed(1);
      const totalMB = (mem.totalJSHeapSize / (1024 * 1024)).toFixed(1);
      const limitMB = (mem.jsHeapSizeLimit / (1024 * 1024)).toFixed(1);
      log.info(`[memory] ${label}: ${usedMB}MB used / ${totalMB}MB total / ${limitMB}MB limit`);
    }
  } catch {
    // performance.memory not available; skip silently
  }
}

// ---------------------------------------------------------------------------
// InferenceEngine
// ---------------------------------------------------------------------------

/**
 * High-level inference engine wrapping wllama.
 * Handles model loading (with sharding support), inference, and cleanup.
 */
class InferenceEngine {
  wllama: WllamaInstance | null = null;
  isModelLoaded = false;
  hasWebGPU = false;
  modelInfo: ModelInfo | null = null;
  private _abortController: AbortController | null = null;

  /**
   * Initialize the engine (creates the Wllama instance).
   * Call this once before loadModel().
   */
  async init(options: InitOptions = {}): Promise<{ success: boolean; hasWebGPU: boolean }> {
    const mod = await getWllamaModule();
    const { Wllama } = mod;

    this.hasWebGPU = await detectWebGPU();

    log.info('WebGPU available:', this.hasWebGPU);

    // Determine WASM paths -- use local copies shipped with the extension
    const extensionBase = (typeof chrome !== 'undefined' && chrome.runtime)
      ? chrome.runtime.getURL('')
      : './';

    const wasmPaths: Record<string, string> = {
      'single-thread/wllama.wasm': `${extensionBase}wllama-single.wasm`,
      'multi-thread/wllama.wasm': `${extensionBase}wllama-multi.wasm`,
    };

    this.wllama = new Wllama(wasmPaths, {
      suppressNativeLog: options.suppressNativeLog || false,
      parallelDownloads: options.parallelDownloads || 3,
      allowOffline: true,
      logger: {
        debug: (...args: unknown[]) => console.debug('[wllama]', ...args),
        log: (...args: unknown[]) => console.log('[wllama]', ...args),
        warn: (...args: unknown[]) => console.warn('[wllama]', ...args),
        error: (...args: unknown[]) => console.error('[wllama]', ...args),
      },
    }) as WllamaInstance;

    log.info('Engine initialized');
    return { success: true, hasWebGPU: this.hasWebGPU };
  }

  /**
   * Load a model from one or more URLs (supports sharded GGUF).
   *
   * For sharded models, pass an array of URLs for each shard.
   * wllama handles downloading, caching, and reassembling them internally --
   * no single large ArrayBuffer is ever created.
   */
  async loadModel(
    modelUrls: string | string[],
    config: LoadModelConfig = {},
    onProgress: ((info: ProgressInfo) => void) | null = null,
  ): Promise<{ success: boolean; modelInfo: ModelInfo }> {
    if (!this.wllama) {
      throw new Error('Engine not initialized. Call init() first.');
    }

    if (this.isModelLoaded) {
      log.info('Unloading previous model before loading new one');
      await this.unloadModel();
    }

    const urls = Array.isArray(modelUrls) ? modelUrls : [modelUrls];

    log.info('Loading model from', urls.length, 'shard(s)');
    logMemoryUsage('pre-load');

    const loadStartTime = Date.now();
    let lastProgressTime = loadStartTime;

    const loadConfig: Record<string, unknown> = {
      n_ctx: config.n_ctx || 2048,
      n_batch: config.n_batch || 512,
      /* v8 ignore start */
      n_threads: config.n_threads || Math.min(navigator.hardwareConcurrency || 4, 4),
      /* v8 ignore stop */
      cache_type_k: config.cache_type_k || 'q8_0',
      cache_type_v: config.cache_type_v || 'q8_0',
      ...config,
    };

    try {
      await this.wllama.loadModelFromUrl(urls, {
        ...loadConfig,
        progressCallback: onProgress ? ({ loaded, total }: { loaded: number; total: number }) => {
          const now = Date.now();
          const progress = total > 0 ? (loaded / total) * 100 : 0;
          const elapsed = now - lastProgressTime;
          lastProgressTime = now;
          onProgress({ loaded, total, progress, elapsed });
        } : undefined,
      });

      const loadDurationMs = Date.now() - loadStartTime;
      this.isModelLoaded = true;
      this.modelInfo = this.wllama.getLoadedContextInfo();

      log.info('Model loaded successfully:', this.modelInfo);
      log.info('[timing] Model load completed in', loadDurationMs, 'ms');
      logMemoryUsage('post-load');

      return { success: true, modelInfo: this.modelInfo };

    } catch (error) {
      const loadDurationMs = Date.now() - loadStartTime;
      log.error('Model loading failed:', error);
      log.error('[timing] Model load failed after', loadDurationMs, 'ms');
      this.isModelLoaded = false;
      throw error;
    }
  }

  /**
   * Load a model from local Blob(s) (for pre-downloaded models stored in IndexedDB).
   */
  async loadModelFromBlobs(
    blobs: Blob[],
    config: LoadModelConfig = {},
  ): Promise<{ success: boolean; modelInfo: ModelInfo }> {
    if (!this.wllama) {
      throw new Error('Engine not initialized. Call init() first.');
    }

    if (this.isModelLoaded) {
      await this.unloadModel();
    }

    const loadConfig: Record<string, unknown> = {
      n_ctx: config.n_ctx || 2048,
      n_batch: config.n_batch || 512,
      /* v8 ignore start */
      n_threads: config.n_threads || Math.min(navigator.hardwareConcurrency || 4, 4),
      /* v8 ignore stop */
      cache_type_k: config.cache_type_k || 'q8_0',
      cache_type_v: config.cache_type_v || 'q8_0',
      ...config,
    };

    const loadStartTime = Date.now();

    try {
      await this.wllama.loadModel(blobs, loadConfig);
      const loadDurationMs = Date.now() - loadStartTime;

      this.isModelLoaded = true;
      this.modelInfo = this.wllama.getLoadedContextInfo();
      log.info('Model loaded from blobs:', this.modelInfo);
      log.info('[timing] Blob load completed in', loadDurationMs, 'ms');
      logMemoryUsage('post-blob-load');

      return { success: true, modelInfo: this.modelInfo };
    } catch (error) {
      const loadDurationMs = Date.now() - loadStartTime;
      log.error('Model loading from blobs failed:', error);
      log.error('[timing] Blob load failed after', loadDurationMs, 'ms');
      this.isModelLoaded = false;
      throw error;
    }
  }

  /**
   * Translate text by running completion on a translation prompt.
   */
  async complete(prompt: string, options: CompleteOptions = {}): Promise<CompletionResult> {
    if (!this.isModelLoaded || !this.wllama) {
      throw new Error('Model not loaded');
    }

    const maxTokens = options.maxTokens || 512;
    const temperature = options.temperature || 0.1;

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
   */
  async chatComplete(messages: ChatMessage[], options: ChatCompleteOptions = {}): Promise<CompletionResult> {
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

  /** Abort the current generation. */
  abort(): void {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /** Unload the model and free memory. */
  async unloadModel(): Promise<void> {
    if (this.wllama) {
      try {
        await this.wllama.exit();
      } catch (err) {
        log.warn('Error during model unload:', err);
      }
    }
    this.isModelLoaded = false;
    this.modelInfo = null;
    log.info('Model unloaded');
  }

  /** Full cleanup -- destroys the wllama instance. */
  async destroy(): Promise<void> {
    await this.unloadModel();
    this.wllama = null;
    log.info('Engine destroyed');
  }

  /** Get model context info if loaded. */
  getContextInfo(): ModelInfo | null {
    if (!this.isModelLoaded || !this.wllama) return null;
    return this.wllama.getLoadedContextInfo();
  }

  /** Check if engine is ready for inference. */
  isReady(): boolean {
    return this.isModelLoaded && this.wllama !== null;
  }
}

export { InferenceEngine, detectWebGPU };
export type {
  InitOptions,
  LoadModelConfig,
  CompleteOptions,
  ChatCompleteOptions,
  ProgressInfo,
  CompletionResult,
  ModelInfo,
  ChatMessage,
  WllamaInstance,
};
