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

import { InferenceEngine } from './llama.cpp';

// Worker global scope — not included in tsconfig lib (DOM-only), so declare locally
declare const self: {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
};

// --- Incoming message types ---

interface LoadModelMessage {
  type: 'loadModel';
  modelUrls?: string | string[];
  modelUrl?: string;
  config?: Record<string, unknown>;
  requestId?: string;
}

interface LoadModelFromBlobsMessage {
  type: 'loadModelFromBlobs';
  blobs: Blob[];
  config?: Record<string, unknown>;
  requestId?: string;
}

interface TranslateMessage {
  type: 'translate';
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  requestId: string;
}

interface ChatTranslateMessage {
  type: 'chatTranslate';
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  requestId: string;
}

interface AbortMessage {
  type: 'abort';
  requestId?: string;
}

interface CleanupMessage {
  type: 'cleanup';
  requestId?: string;
}

interface LegacyLoadMessage {
  type: 'load';
  modelUrls?: string | string[];
  config?: Record<string, unknown>;
  requestId?: string;
}

type WorkerMessage =
  | LoadModelMessage
  | LoadModelFromBlobsMessage
  | TranslateMessage
  | ChatTranslateMessage
  | AbortMessage
  | CleanupMessage
  | LegacyLoadMessage;

// --- Outgoing message types ---

interface StatusOutMessage {
  type: 'status';
  status: string;
  message: string;
}

interface ProgressOutMessage {
  type: 'progress';
  loaded: number;
  total: number;
  progress: number;
}

interface ModelLoadedOutMessage {
  type: 'modelLoaded';
  modelInfo: unknown;
}

interface TranslationCompleteOutMessage {
  type: 'translationComplete';
  requestId: string;
  translatedText: string;
  tokensGenerated: number;
}

interface TranslationCancelledOutMessage {
  type: 'translationCancelled';
  requestId: string;
  message: string;
}

interface CleanupCompleteOutMessage {
  type: 'cleanupComplete';
  requestId?: string;
}

interface ErrorOutMessage {
  type: 'error';
  requestId?: string;
  message: string;
}

type WorkerOutMessage =
  | StatusOutMessage
  | ProgressOutMessage
  | ModelLoadedOutMessage
  | TranslationCompleteOutMessage
  | TranslationCancelledOutMessage
  | CleanupCompleteOutMessage
  | ErrorOutMessage;

// Typed wrapper around the global postMessage for worker outgoing messages
const post = (msg: WorkerOutMessage): void => {
  postMessage(msg);
};

class InferenceWorker {
  engine: InferenceEngine | null;
  isReady: boolean;
  _currentAbortController: AbortController | null;

  constructor() {
    this.engine = null;
    this.isReady = false;
    this._currentAbortController = null;
  }

  async initialize(): Promise<void> {
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
  async loadModel(modelUrls: string | string[], config: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.initialize();

      post({ type: 'status', status: 'loading', message: 'Loading model...' });

      const result = await this.engine!.loadModel(modelUrls, config, (progressInfo) => {
        post({
          type: 'progress',
          loaded: progressInfo.loaded,
          total: progressInfo.total,
          progress: progressInfo.progress,
        });
      });

      this.isReady = true;
      post({ type: 'modelLoaded', modelInfo: result.modelInfo });

    } catch (error) {
      const err = error as Error;
      console.error('[Worker] Model loading failed:', err);
      this.isReady = false;
      post({
        type: 'error',
        message: `Failed to load model: ${err.message}`,
      });
    }
  }

  /**
   * Load model from Blob(s) stored in IndexedDB.
   */
  async loadModelFromBlobs(blobs: Blob[], config: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.initialize();

      post({ type: 'status', status: 'loading', message: 'Loading model from cache...' });

      const result = await this.engine!.loadModelFromBlobs(blobs, config);

      this.isReady = true;
      post({ type: 'modelLoaded', modelInfo: result.modelInfo });

    } catch (error) {
      const err = error as Error;
      console.error('[Worker] Model loading from blobs failed:', err);
      this.isReady = false;
      post({
        type: 'error',
        message: `Failed to load model from cache: ${err.message}`,
      });
    }
  }

  /**
   * Run translation using raw prompt completion.
   */
  async translate(prompt: string, maxTokens: number | undefined, temperature: number | undefined, requestId: string): Promise<void> {
    if (!this.isReady || !this.engine || !this.engine.isReady()) {
      post({
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

      post({
        type: 'translationComplete',
        requestId,
        translatedText: result.text,
        tokensGenerated: result.tokensGenerated,
      });

    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        post({
          type: 'translationCancelled',
          requestId,
          message: 'Translation was cancelled',
        });
      } else {
        console.error('[Worker] Translation failed:', err);
        post({
          type: 'error',
          requestId,
          message: `Translation failed: ${err.message}`,
        });
      }
    } finally {
      this._currentAbortController = null;
    }
  }

  /**
   * Run translation using chat completion (if model supports chat template).
   */
  async chatTranslate(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number | undefined,
    temperature: number | undefined,
    requestId: string,
  ): Promise<void> {
    if (!this.isReady || !this.engine || !this.engine.isReady()) {
      post({
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

      post({
        type: 'translationComplete',
        requestId,
        translatedText: result.text,
        tokensGenerated: result.tokensGenerated,
      });

    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        post({
          type: 'translationCancelled',
          requestId,
          message: 'Translation was cancelled',
        });
      } else {
        console.error('[Worker] Chat translation failed:', err);
        post({
          type: 'error',
          requestId,
          message: `Chat translation failed: ${err.message}`,
        });
      }
    } finally {
      this._currentAbortController = null;
    }
  }

  /**
   * Abort current generation.
   */
  abort(_requestId?: string): void {
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
  async cleanup(requestId?: string): Promise<void> {
    try {
      this.abort();

      if (this.engine) {
        await this.engine.destroy();
        this.engine = null;
      }

      this.isReady = false;
      post({ type: 'cleanupComplete', requestId });

    } catch (error) {
      const err = error as Error;
      console.error('[Worker] Cleanup error:', err);
      post({
        type: 'error',
        requestId,
        message: `Cleanup failed: ${err.message}`,
      });
    }
  }
}

// --- Worker message handler ---
const worker = new InferenceWorker();

self.onmessage = async function (event: MessageEvent<WorkerMessage>): Promise<void> {
  const { type, requestId } = event.data as WorkerMessage & { requestId?: string };

  try {
    switch (type) {
      case 'loadModel':
        await worker.loadModel(
          (event.data as LoadModelMessage).modelUrls || (event.data as LoadModelMessage).modelUrl || [],
          (event.data as LoadModelMessage).config || {},
        );
        break;

      case 'loadModelFromBlobs':
        await worker.loadModelFromBlobs(
          (event.data as LoadModelFromBlobsMessage).blobs,
          /* v8 ignore start */
          (event.data as LoadModelFromBlobsMessage).config || {},
          /* v8 ignore stop */
        );
        break;

      case 'translate':
        await worker.translate(
          (event.data as TranslateMessage).prompt,
          (event.data as TranslateMessage).maxTokens,
          (event.data as TranslateMessage).temperature,
          requestId!,
        );
        break;

      case 'chatTranslate':
        await worker.chatTranslate(
          (event.data as ChatTranslateMessage).messages,
          (event.data as ChatTranslateMessage).maxTokens,
          (event.data as ChatTranslateMessage).temperature,
          requestId!,
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
        if ((event.data as LegacyLoadMessage).modelUrls) {
          await worker.loadModel(
            (event.data as LegacyLoadMessage).modelUrls!,
            /* v8 ignore start */
            (event.data as LegacyLoadMessage).config || {},
            /* v8 ignore stop */
          );
        } else {
          post({
            type: 'error',
            requestId,
            message: 'Legacy modelData loading is no longer supported. Use modelUrls instead.',
          });
        }
        break;

      default:
        post({
          type: 'error',
          requestId,
          message: `Unknown message type: ${type as string}`,
        });
    }
  } catch (error) {
    const err = error as Error;
    console.error('[Worker] Error handling message:', err);
    post({
      type: 'error',
      requestId,
      message: err.message,
    });
  }
};

// Clean up resources when the worker is terminated
self.addEventListener('beforeunload', () => {
  worker.cleanup();
});
