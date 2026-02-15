/* global InferenceEngine, importScripts, postMessage, self */
/**
 * Web Worker for running local model inference via wllama (WebGPU/WASM).
 *
 * Replaces the old llamacpp-worker.js that tried to load the entire GGUF model
 * into a single Uint8Array (causing RangeError: Array buffer allocation failed).
 *
 * Now uses wllama's built-in chunked model loading -- no single large ArrayBuffer.
 *
 * Protocol (postMessage):
 *   -> { type: 'loadModel', modelUrls: string[], config?: object }
 *   <- { type: 'modelLoaded', modelInfo: object }
 *
 *   -> { type: 'translate', prompt: string, maxTokens?: number, temperature?: number, requestId: string }
 *   <- { type: 'translationComplete', requestId: string, translatedText: string, tokensGenerated: number }
 *
 *   -> { type: 'chatTranslate', messages: object[], maxTokens?: number, temperature?: number, requestId: string }
 *   <- { type: 'translationComplete', requestId: string, translatedText: string, tokensGenerated: number }
 *
 *   -> { type: 'cleanup', requestId?: string }
 *   <- { type: 'cleanupComplete', requestId?: string }
 *
 *   <- { type: 'error', requestId?: string, message: string }
 *   <- { type: 'progress', loaded: number, total: number, progress: number }
 */

// Import the inference engine
importScripts('llama.cpp.js');

class InferenceWorker {
  constructor() {
    this.engine = null;
    this.isReady = false;
    this._currentAbortController = null;
  }

  async initialize() {
    if (this.engine) return;

    this.engine = new InferenceEngine();
    await this.engine.init({
      suppressNativeLog: false,
      parallelDownloads: 3,
    });
  }

  /**
   * Load a model from URL(s). Supports sharded GGUF via multiple URLs.
   */
  async loadModel(modelUrls, config = {}) {
    try {
      await this.initialize();

      postMessage({ type: 'status', status: 'loading', message: 'Loading model...' });

      const result = await this.engine.loadModel(modelUrls, config, (progressInfo) => {
        postMessage({
          type: 'progress',
          loaded: progressInfo.loaded,
          total: progressInfo.total,
          progress: progressInfo.progress,
        });
      });

      this.isReady = true;
      postMessage({ type: 'modelLoaded', modelInfo: result.modelInfo });

    } catch (error) {
      console.error('[Worker] Model loading failed:', error);
      this.isReady = false;
      postMessage({
        type: 'error',
        message: `Failed to load model: ${  error.message}`,
      });
    }
  }

  /**
   * Load model from Blob(s) stored in IndexedDB.
   */
  async loadModelFromBlobs(blobs, config = {}) {
    try {
      await this.initialize();

      postMessage({ type: 'status', status: 'loading', message: 'Loading model from cache...' });

      const result = await this.engine.loadModelFromBlobs(blobs, config);

      this.isReady = true;
      postMessage({ type: 'modelLoaded', modelInfo: result.modelInfo });

    } catch (error) {
      console.error('[Worker] Model loading from blobs failed:', error);
      this.isReady = false;
      postMessage({
        type: 'error',
        message: `Failed to load model from cache: ${  error.message}`,
      });
    }
  }

  /**
   * Run translation using raw prompt completion.
   */
  async translate(prompt, maxTokens, temperature, requestId) {
    if (!this.isReady || !this.engine || !this.engine.isReady()) {
      postMessage({
        type: 'error',
        requestId,
        message: 'Model not loaded',
      });
      return;
    }

    try {
      this._currentAbortController = new AbortController();

      const result = await this.engine.complete(prompt, {
        maxTokens: maxTokens || 512,
        temperature: temperature || 0.1,
        abortSignal: this._currentAbortController.signal,
      });

      postMessage({
        type: 'translationComplete',
        requestId,
        translatedText: result.text,
        tokensGenerated: result.tokensGenerated,
      });

    } catch (error) {
      if (error.name === 'AbortError') {
        postMessage({
          type: 'translationCancelled',
          requestId,
          message: 'Translation was cancelled',
        });
      } else {
        console.error('[Worker] Translation failed:', error);
        postMessage({
          type: 'error',
          requestId,
          message: `Translation failed: ${  error.message}`,
        });
      }
    } finally {
      this._currentAbortController = null;
    }
  }

  /**
   * Run translation using chat completion (if model supports chat template).
   */
  async chatTranslate(messages, maxTokens, temperature, requestId) {
    if (!this.isReady || !this.engine || !this.engine.isReady()) {
      postMessage({
        type: 'error',
        requestId,
        message: 'Model not loaded',
      });
      return;
    }

    try {
      this._currentAbortController = new AbortController();

      const result = await this.engine.chatComplete(messages, {
        maxTokens: maxTokens || 512,
        temperature: temperature || 0.1,
        abortSignal: this._currentAbortController.signal,
      });

      postMessage({
        type: 'translationComplete',
        requestId,
        translatedText: result.text,
        tokensGenerated: result.tokensGenerated,
      });

    } catch (error) {
      if (error.name === 'AbortError') {
        postMessage({
          type: 'translationCancelled',
          requestId,
          message: 'Translation was cancelled',
        });
      } else {
        console.error('[Worker] Chat translation failed:', error);
        postMessage({
          type: 'error',
          requestId,
          message: `Chat translation failed: ${  error.message}`,
        });
      }
    } finally {
      this._currentAbortController = null;
    }
  }

  /**
   * Abort current generation.
   */
  abort(_requestId) {
    if (this._currentAbortController) {
      this._currentAbortController.abort();
      this._currentAbortController = null;
    }
    if (this.engine) {
      this.engine.abort();
    }
  }

  /**
   * Full cleanup.
   */
  async cleanup(requestId) {
    try {
      this.abort();

      if (this.engine) {
        await this.engine.destroy();
        this.engine = null;
      }

      this.isReady = false;
      postMessage({ type: 'cleanupComplete', requestId });

    } catch (error) {
      console.error('[Worker] Cleanup error:', error);
      postMessage({
        type: 'error',
        requestId,
        message: `Cleanup failed: ${  error.message}`,
      });
    }
  }
}

// --- Worker message handler ---
const worker = new InferenceWorker();

self.onmessage = async function(event) {
  const { type, requestId } = event.data;

  try {
    switch (type) {
      case 'loadModel':
        await worker.loadModel(
          event.data.modelUrls || event.data.modelUrl,
          event.data.config || {},
        );
        break;

      case 'loadModelFromBlobs':
        await worker.loadModelFromBlobs(
          event.data.blobs,
          event.data.config || {},
        );
        break;

      case 'translate':
        await worker.translate(
          event.data.prompt,
          event.data.maxTokens,
          event.data.temperature,
          requestId,
        );
        break;

      case 'chatTranslate':
        await worker.chatTranslate(
          event.data.messages,
          event.data.maxTokens,
          event.data.temperature,
          requestId,
        );
        break;

      case 'abort':
        worker.abort(requestId);
        break;

      case 'cleanup':
        await worker.cleanup(requestId);
        break;

      // Legacy compatibility: 'loadModel' with modelData (old API)
      case 'load':
        // Old API sent raw modelData buffer -- this no longer works for large models.
        // Redirect to URL-based loading if possible.
        if (event.data.modelUrls) {
          await worker.loadModel(event.data.modelUrls, event.data.config || {});
        } else {
          postMessage({
            type: 'error',
            requestId,
            message: 'Legacy modelData loading is no longer supported. Use modelUrls instead.',
          });
        }
        break;

      default:
        postMessage({
          type: 'error',
          requestId,
          message: `Unknown message type: ${  type}`,
        });
    }
  } catch (error) {
    console.error('[Worker] Error handling message:', error);
    postMessage({
      type: 'error',
      requestId,
      message: error.message,
    });
  }
};

self.onclose = function() {
  worker.cleanup();
};
