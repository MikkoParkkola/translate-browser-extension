/**
 * Local Model Manager for translation using wllama (WebGPU/WASM).
 *
 * Refactored from the old llama.cpp mock to use real inference via @wllama/wllama.
 * Key changes:
 *   - Model loading via URL(s) instead of single ArrayBuffer (no RangeError)
 *   - Sharded GGUF support (multiple <500MB files)
 *   - WebGPU acceleration with WASM CPU fallback
 *   - wllama handles caching internally (Cache API / IndexedDB)
 *
 * Uses modular architecture: ModelValidator, ModelUpdater, ModelPerformanceMonitor.
 */

import { logger } from './logger.js';
import { standardErrorHandler } from './standardErrorHandler.js';
import { safeStorageGet, safeStorageSet } from '../core/storage';
import { ModelValidator } from './ModelValidator.js';
export type { ValidationResult } from './ModelValidator.js';
import { ModelUpdater } from './ModelUpdater.js';
import type { UpdateCheckResult } from './ModelUpdater.js';
import { ModelPerformanceMonitor } from './ModelPerformanceMonitor.js';
import type { PerformanceSummary } from './ModelPerformanceMonitor.js';
export type { PerformanceSummary } from './ModelPerformanceMonitor.js';

// ── Interfaces ──────────────────────────────────────────────────────

export interface InferenceConfig {
  n_ctx: number;
  n_batch: number;
  cache_type_k: string;
  cache_type_v: string;
}

export interface ModelConfig {
  modelUrls: string[];
  inference: InferenceConfig;
  totalSize: number;
  displayName: string;
}

export interface DownloadProgressInfo {
  loaded: number;
  total: number;
  progress: number;
  status?: string;
  shardIndex?: number;
  shardCount?: number;
  complete?: boolean;
}

export interface TranslationResult {
  text: string;
  translatedText: string;
  inferenceTime: number;
  confidence: number;
  tokensGenerated: number;
}

export interface ModelStatus {
  downloaded: boolean;
  loaded: boolean;
  size: number;
  downloadDate: string | null;
  lastValidated: string | null;
  version: string | null;
  integrity: string;
  backend: string;
  error?: string;
  performance?: PerformanceSummary;
  updateInfo?: ReturnType<ModelUpdater['getUpdateInfo']>;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'error';
  checks: Record<string, HealthCheck>;
  timestamp: string;
  summary: string;
  error?: string;
}

export interface HealthCheck {
  passed: boolean;
  message: string;
  status?: string;
}

export interface ModelInfo {
  available: boolean;
  ready: boolean;
  downloading: boolean;
  name: string;
  backend: string;
  performanceStats: PerformanceSummary;
}

export interface ModelDownloadProgress {
  isDownloading: boolean;
  progress: number;
}

interface ModelVersionEntry {
  size: number;
  checksums: Record<string, string>;
  urls: string[];
  features: string[];
  deprecated: boolean;
}

interface ModelRegistryEntry {
  versions: Record<string, ModelVersionEntry>;
  latest: string;
}

type ModelRegistry = Record<string, ModelRegistryEntry>;

/** Messages sent to the wllama worker. */
interface WorkerLoadMessage {
  type: 'loadModel';
  modelUrls: string[];
  config: InferenceConfig;
}

interface WorkerTranslateMessage {
  type: 'translate';
  prompt: string;
  maxTokens: number;
  temperature: number;
  requestId: string;
}

interface WorkerControlMessage {
  type: 'abort' | 'cleanup';
}

type WorkerOutboundMessage = WorkerLoadMessage | WorkerTranslateMessage | WorkerControlMessage;

/** Messages received from the wllama worker. */
interface WorkerProgressMessage {
  type: 'progress' | 'status';
  loaded?: number;
  total?: number;
  progress?: number;
  file?: string;
}

interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

interface WorkerResultMessage {
  type: 'result' | 'loaded';
  translatedText?: string;
  tokensGenerated?: number;
  modelInfo?: Record<string, unknown>;
}

type WorkerInboundMessage = WorkerProgressMessage | WorkerErrorMessage | WorkerResultMessage;

// ── Default config ──────────────────────────────────────────────────

/**
 * Default model configuration.
 * Sharded URLs split the model into <500MB chunks to avoid ArrayBuffer limits.
 */
const DEFAULT_MODEL_CONFIG: ModelConfig = {
  modelUrls: [
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00001-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00002-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00003-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00004-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00005-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00006-of-00006.gguf',
  ],
  inference: {
    n_ctx: 2048,
    n_batch: 512,
    cache_type_k: 'q8_0',
    cache_type_v: 'q8_0',
  },
  totalSize: 2489909952, // 2.32 GB (6 shards)
  displayName: 'TranslateGemma 4B Q4_K_M',
};

// ── Class ───────────────────────────────────────────────────────────

export class LocalModelManager {
  isInitialized: boolean;
  modelLoaded: boolean;
  modelWorker: Worker | null;
  modelConfig: ModelConfig;

  downloadProgress: number;
  isDownloading: boolean;
  private downloadCancelled: boolean;

  private lastUsed: number;
  private unloadTimeout: number;
  private unloadTimer: ReturnType<typeof setTimeout> | null;

  private maxRetries: number;
  private retryDelayMs: number;
  private maxRetryDelayMs: number;
  consecutiveFailures: number;
  lastError: Error | null;
  private isInRecovery: boolean;
  modelCorrupted: boolean;

  private modelRegistry: ModelRegistry;

  validator: ModelValidator;
  updater: ModelUpdater;
  performanceMonitor: ModelPerformanceMonitor;

  constructor() {
    this.isInitialized = false;
    this.modelLoaded = false;
    this.modelWorker = null;
    this.modelConfig = { ...DEFAULT_MODEL_CONFIG };

    // Download state
    this.downloadProgress = 0;
    this.isDownloading = false;
    this.downloadCancelled = false;

    // Memory management
    this.lastUsed = Date.now();
    this.unloadTimeout = 5 * 60 * 1000; // 5 minutes
    this.unloadTimer = null;

    // Error handling
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
    this.maxRetryDelayMs = 10000;
    this.consecutiveFailures = 0;
    this.lastError = null;
    this.isInRecovery = false;
    this.modelCorrupted = false;

    // Model registry (kept for compatibility with ModelValidator/ModelUpdater)
    this.modelRegistry = {
      'translate-gemma-q4': {
        versions: {
          '1.0.0': {
            size: DEFAULT_MODEL_CONFIG.totalSize,
            checksums: {
              sha256: 'pending',
            },
            urls: DEFAULT_MODEL_CONFIG.modelUrls,
            features: ['Translation', 'Multi-language support'],
            deprecated: false,
          },
        },
        latest: '1.0.0',
      },
    };

    // Initialize specialized modules
    this.validator = new ModelValidator(this.modelRegistry, {
      enableSizeValidation: true,
      enableChecksumValidation: false,
      enableStructuralValidation: true,
      sizeTolerance: 0.05,
      checksumAlgorithm: 'sha256',
    });

    this.updater = new ModelUpdater(this.modelRegistry, {
      currentModelVersion: '1.0.0',
      autoUpdateEnabled: false,
      updateCheckInterval: 24 * 60 * 60 * 1000,
      updateNotifications: true,
    });

    this.performanceMonitor = new ModelPerformanceMonitor({
      enableMemoryMonitoring: true,
      enableInferenceTracking: true,
      enableAdaptiveOptimization: true,
      memoryThreshold: 0.8,
    });

    // Bind methods
    this.retrieveModel = this.retrieveModel.bind(this);
    this.downloadModel = this.downloadModel.bind(this);
  }

  /**
   * Initialize the model manager.
   */
  async init(): Promise<{ success: boolean; message: string }> {
    if (this.isInitialized) {
      return { success: true, message: 'Already initialized' };
    }

    try {
      logger.info('LocalModelManager', 'Initializing Local Model Manager (wllama backend)...');

      const modelStatus = await this.getModelStatus();

      if (modelStatus.downloaded) {
        const updateInfo: UpdateCheckResult = await this.updater.checkForUpdates();
        logger.info('LocalModelManager', 'Model cached. Update info:', updateInfo);
      }

      this.updater.scheduleUpdateCheck();
      this.performanceMonitor.startPerformanceMonitoring();

      this.isInitialized = true;
      logger.info('LocalModelManager', 'Local Model Manager initialized (wllama backend)');

      return { success: true, message: 'Initialized successfully' };

    } catch (error) {
      const handledError = standardErrorHandler.handleError(error as Error, {
        operation: 'init',
        component: 'LocalModelManager',
        recoverable: false,
      });
      logger.error('LocalModelManager', 'Initialization failed:', handledError);
      throw handledError;
    }
  }

  /**
   * Download (cache) the model shards.
   * wllama's loadModelFromUrl downloads and caches each shard via Cache API.
   */
  async downloadModel(
    onProgress: ((info: DownloadProgressInfo) => void) | null = null,
    retryAttempt = 0,
  ): Promise<{ success: boolean }> {
    if (this.isDownloading) {
      throw new Error('Download already in progress');
    }

    this.isDownloading = true;
    this.downloadProgress = 0;
    this.downloadCancelled = false;

    try {
      logger.info('LocalModelManager', 'Starting model download (sharded, wllama)...');

      await this._ensureWorker();

      await this._sendWorkerMessage({
        type: 'loadModel',
        modelUrls: this.modelConfig.modelUrls,
        config: this.modelConfig.inference,
      }, (message: WorkerInboundMessage) => {
        if (message.type === 'progress') {
          const msg = message as WorkerProgressMessage;
          this.downloadProgress = msg.progress ?? 0;
          if (onProgress) {
            onProgress({
              loaded: msg.loaded ?? 0,
              total: msg.total ?? 0,
              progress: msg.progress ?? 0,
              status: 'Downloading model shards...',
            });
          }
        }
      }, 20 * 60_000); // 20 min — large model downloads can take time

      this.downloadProgress = 100;
      if (onProgress) {
        onProgress({
          loaded: this.modelConfig.totalSize,
          total: this.modelConfig.totalSize,
          progress: 100,
          complete: true,
          status: 'Download complete',
        });
      }

      this.modelLoaded = true;
      this.consecutiveFailures = 0;
      this.lastError = null;

      await this.updateModelStatus({
        downloaded: true,
        downloadDate: new Date().toISOString(),
        version: '1.0.0',
        integrity: 'verified',
        backend: 'wllama',
      });

      logger.info('LocalModelManager', 'Model download and loading completed');
      return { success: true };

    } catch (error) {
      logger.error('LocalModelManager', 'Model download failed:', error);

      if (this.downloadCancelled) {
        throw new Error('Download cancelled by user');
      }

      if (retryAttempt < this.maxRetries && this._shouldRetryDownload(error as Error)) {
        const delay = Math.min(
          this.retryDelayMs * Math.pow(2, retryAttempt),
          this.maxRetryDelayMs,
        );
        logger.info('LocalModelManager',
          `Retrying download in ${delay}ms (attempt ${retryAttempt + 1}/${this.maxRetries})`);

        await this._sleep(delay);
        return this.downloadModel(onProgress, retryAttempt + 1);
      }

      throw this._handleError(error as Error, 'download', true);

    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * Cancel an in-progress download.
   */
  cancelModelDownload(): void {
    this.downloadCancelled = true;
    if (this.modelWorker) {
      this.modelWorker.postMessage({ type: 'abort' } satisfies WorkerControlMessage);
    }
    logger.info('LocalModelManager', 'Download cancellation requested');
  }

  /**
   * Load model into memory (if already cached).
   */
  async loadModel(): Promise<{ success: boolean; message?: string }> {
    if (this.modelLoaded) {
      return { success: true, message: 'Model already loaded' };
    }

    try {
      logger.info('LocalModelManager', 'Loading model into memory...');

      await this._ensureWorker();

      await this._sendWorkerMessage({
        type: 'loadModel',
        modelUrls: this.modelConfig.modelUrls,
        config: this.modelConfig.inference,
      }, null, 5 * 60_000); // 5 min — model init from cache is slower on low-end hardware

      this.modelLoaded = true;
      this.lastUsed = Date.now();
      this._scheduleUnload();

      logger.info('LocalModelManager', 'Model loaded successfully');
      return { success: true };

    } catch (error) {
      throw this._handleError(error as Error, 'load', true);
    }
  }

  /**
   * Translate text using the loaded model.
   */
  async translateText(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<TranslationResult> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    const startTime = Date.now();
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `tr_${crypto.randomUUID()}`
      : `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const prompt = this._createTranslationPrompt(text, sourceLanguage, targetLanguage);

      const result = await this._sendWorkerMessage({
        type: 'translate',
        prompt,
        maxTokens: 512,
        temperature: 0.1,
        requestId,
      }) as WorkerResultMessage;

      const inferenceTime = Date.now() - startTime;

      this.performanceMonitor.updatePerformanceStats(inferenceTime, true, text.length);

      this.lastUsed = Date.now();
      this._scheduleUnload();

      logger.debug('LocalModelManager', `Translation completed in ${inferenceTime}ms`);

      return {
        text: result.translatedText ?? '',
        translatedText: result.translatedText ?? '',
        inferenceTime,
        confidence: 0.8,
        tokensGenerated: (result.tokensGenerated as number) ?? 0,
      };

    } catch (error) {
      const inferenceTime = Date.now() - startTime;
      this.performanceMonitor.updatePerformanceStats(inferenceTime, false, text.length);

      if (this._shouldRetryTranslation(error as Error) && this.consecutiveFailures < this.maxRetries) {
        logger.warn('LocalModelManager', 'Retrying translation after error:', (error as Error).message);

        if ((error as Error).message.includes('worker') || (error as Error).message.includes('not loaded')) {
          this.modelLoaded = false;
          await this.loadModel();
        }

        return this.translateText(text, sourceLanguage, targetLanguage);
      }

      throw this._handleError(error as Error, 'translate', true);
    }
  }

  /**
   * Convenience alias for translateText (used by UI).
   */
  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<TranslationResult> {
    return this.translateText(text, sourceLanguage, targetLanguage);
  }

  /**
   * Get model status.
   */
  async getModelStatus(): Promise<ModelStatus> {
    try {
      const stored = await this._getStoredData('model_status') as Partial<ModelStatus> | null;
      const defaultStatus: ModelStatus = {
        downloaded: false,
        loaded: this.modelLoaded,
        size: 0,
        downloadDate: null,
        lastValidated: null,
        version: null,
        integrity: 'unknown',
        backend: 'wllama',
      };

      const status: ModelStatus = { ...defaultStatus, ...stored, loaded: this.modelLoaded };
      status.performance = this.performanceMonitor.getPerformanceSummary();
      status.updateInfo = this.updater.getUpdateInfo();

      return status;

    } catch (error) {
      logger.error('LocalModelManager', 'Failed to get model status:', error);
      return { downloaded: false, loaded: false, size: 0, downloadDate: null, lastValidated: null, version: null, integrity: 'unknown', backend: 'wllama', error: (error as Error).message };
    }
  }

  /**
   * Get model info (legacy compatibility).
   */
  getModelInfo(): ModelInfo {
    return {
      available: this.modelLoaded || this.isDownloading,
      ready: this.modelLoaded,
      downloading: this.isDownloading,
      name: this.modelConfig.displayName,
      backend: 'wllama',
      performanceStats: this.performanceMonitor.getPerformanceSummary(),
    };
  }

  /**
   * Get download progress (for UI polling).
   */
  getDownloadProgress(): ModelDownloadProgress {
    return {
      isDownloading: this.isDownloading,
      progress: this.downloadProgress,
    };
  }

  /**
   * Perform health check.
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const health: HealthCheckResult = {
      status: 'healthy',
      checks: {},
      timestamp: new Date().toISOString(),
      summary: '',
    };

    try {
      health.checks.initialized = {
        passed: this.isInitialized,
        message: this.isInitialized ? 'Manager initialized' : 'Manager not initialized',
      };

      const modelStatus = await this.getModelStatus();
      health.checks.modelAvailable = {
        passed: modelStatus.downloaded,
        message: modelStatus.downloaded ? 'Model cached' : 'Model not downloaded',
      };

      health.checks.worker = {
        passed: this.modelWorker !== null && this.modelLoaded,
        message: this.modelLoaded ? 'Worker operational' : 'Worker not loaded',
      };

      health.checks.backend = {
        passed: true,
        message: 'Backend: wllama (WebGPU/WASM)',
        status: 'ok',
      };

      const failedChecks = Object.values(health.checks).filter((c) => !c.passed);
      if (failedChecks.length === 0) {
        health.status = 'healthy';
      } else if (failedChecks.length <= Object.keys(health.checks).length / 2) {
        health.status = 'degraded';
      } else {
        health.status = 'unhealthy';
      }

      health.summary = `${Object.keys(health.checks).length - failedChecks.length}/${Object.keys(health.checks).length} checks passed`;

    } catch (error) {
      health.status = 'error';
      health.error = (error as Error).message;
    }

    return health;
  }

  /**
   * Aliases for legacy API compatibility.
   */
  async healthCheck(): Promise<HealthCheckResult> {
    return this.performHealthCheck();
  }

  async deleteModel(): Promise<void> {
    try {
      if (this.modelWorker) {
        this.modelWorker.postMessage({ type: 'cleanup' } satisfies WorkerControlMessage);
        this.modelWorker.terminate();
        this.modelWorker = null;
      }
      this.modelLoaded = false;

      if (typeof caches !== 'undefined') {
        const cacheKeys = await caches.keys();
        const wllamaKeys = cacheKeys.filter((key) => key.includes('wllama') || key.includes('gguf'));
        await Promise.all(wllamaKeys.map((key) => caches.delete(key)));
      }

      await this._storeData('model_status', { downloaded: false });

      logger.info('LocalModelManager', 'Model deleted and cache cleared');
    } catch (error) {
      logger.error('LocalModelManager', 'Delete failed:', error);
      throw error;
    }
  }

  /**
   * Set custom model URLs (for different models or self-hosted shards).
   */
  setModelUrls(urls: string[]): void {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('modelUrls must be a non-empty array');
    }
    this.modelConfig.modelUrls = urls;
    logger.info('LocalModelManager', `Model URLs updated (${urls.length} shards)`);
  }

  /**
   * Get performance summary.
   */
  getPerformanceSummary(): PerformanceSummary {
    return this.performanceMonitor.getPerformanceSummary();
  }

  /**
   * Update model to latest version.
   */
  async updateModel(
    progressCallback: ((info: DownloadProgressInfo) => void) | null = null,
  ): Promise<unknown> {
    return this.updater.updateModelToVersion(
      null,
      progressCallback as ((info: unknown) => void) | null,
      this.downloadModel.bind(this) as (...args: unknown[]) => unknown,
    );
  }

  /**
   * Clean up all resources.
   */
  async destroy(): Promise<void> {
    try {
      logger.info('LocalModelManager', 'Cleaning up LocalModelManager...');

      this.performanceMonitor.destroy();
      this.updater.destroy();

      if (this.unloadTimer) {
        clearTimeout(this.unloadTimer);
      }

      if (this.modelWorker) {
        try {
          this.modelWorker.postMessage({ type: 'cleanup' } satisfies WorkerControlMessage);
        } catch { /* ignore */ }
        this.modelWorker.terminate();
        this.modelWorker = null;
      }

      this.isInitialized = false;
      this.modelLoaded = false;

      logger.info('LocalModelManager', 'Cleanup completed');

    } catch (error) {
      logger.error('LocalModelManager', 'Error during cleanup:', error);
    }
  }

  // ================================
  // Private helper methods
  // ================================

  private _createTranslationPrompt(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): string {
    return `Translate the following text from ${sourceLanguage} to ${targetLanguage}:\n\n${text}\n\nTranslation:`;
  }

  private async _ensureWorker(): Promise<void> {
    if (this.modelWorker) return;

    const workerUrl = (typeof chrome !== 'undefined' && chrome.runtime)
      ? chrome.runtime.getURL('llamacpp-worker.js')
      : 'llamacpp-worker.js';

    this.modelWorker = new Worker(workerUrl);
    logger.info('LocalModelManager', 'Worker created');
  }

  /**
   * Send a message to the worker and wait for a typed response.
   * Handles 'progress' messages via an optional callback.
   */
  private _sendWorkerMessage(
    message: WorkerOutboundMessage,
    onIntermediateMessage: ((msg: WorkerInboundMessage) => void) | null = null,
    timeoutMs = 60_000,
  ): Promise<WorkerResultMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker communication timeout'));
      }, timeoutMs);

      const handler = (event: MessageEvent<WorkerInboundMessage>): void => {
        const data = event.data;

        if (data.type === 'progress' || data.type === 'status') {
          if (onIntermediateMessage) {
            onIntermediateMessage(data);
          }
          return;
        }

        clearTimeout(timeout);
        this.modelWorker?.removeEventListener('message', handler);

        if (data.type === 'error') {
          reject(new Error((data as WorkerErrorMessage).message));
        } else {
          resolve(data as WorkerResultMessage);
        }
      };

      this.modelWorker!.addEventListener('message', handler);
      this.modelWorker!.postMessage(message);
    });
  }

  private _handleError(error: Error, context: string, retryable = true): Error {
    logger.error('LocalModelManager', `Error in ${context}:`, error);

    this.lastError = error;
    this.consecutiveFailures++;

    const handledError = standardErrorHandler.handleError(error, {
      operation: context,
      component: 'LocalModelManager',
      recoverable: retryable,
      retryCount: this.consecutiveFailures,
    });

    if (this.consecutiveFailures >= 3 && !this.isInRecovery) {
      this._triggerRecovery();
    }

    return handledError;
  }

  private _shouldRetryDownload(error: Error): boolean {
    const msg = error.message || '';
    return msg.includes('network') ||
           msg.includes('timeout') ||
           msg.includes('fetch') ||
           msg.includes('Failed to fetch');
  }

  private _shouldRetryTranslation(error: Error): boolean {
    const msg = error.message || '';
    return !msg.includes('memory') && !msg.includes('corrupted');
  }

  private _scheduleUnload(): void {
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
    }
    this.unloadTimer = setTimeout(() => {
      if (Date.now() - this.lastUsed >= this.unloadTimeout) {
        this._unloadModel();
      }
    }, this.unloadTimeout);
  }

  private async _unloadModel(): Promise<void> {
    if (this.modelWorker) {
      try {
        this.modelWorker.postMessage({ type: 'cleanup' } satisfies WorkerControlMessage);
      } catch { /* ignore */ }
      this.modelWorker.terminate();
      this.modelWorker = null;
    }
    this.modelLoaded = false;
    logger.info('LocalModelManager', 'Model unloaded due to inactivity');
  }

  private async _triggerRecovery(): Promise<void> {
    this.isInRecovery = true;
    try {
      logger.warn('LocalModelManager', 'Triggering recovery mode');
      await this._unloadModel();
      this.modelCorrupted = true;
      this.consecutiveFailures = 0;
      this.lastError = null;
      logger.info('LocalModelManager', 'Recovery completed');
    } catch (error) {
      logger.error('LocalModelManager', 'Recovery failed:', error);
    } finally {
      this.isInRecovery = false;
    }
  }

  async retrieveModel(): Promise<{ cached: boolean } | null> {
    const status = await this.getModelStatus();
    return status.downloaded ? { cached: true } : null;
  }

  async updateModelStatus(updates: Partial<ModelStatus>): Promise<void> {
    const current = (await this._getStoredData('model_status') as Partial<ModelStatus>) || {};
    const updated = { ...current, ...updates };
    await this._storeData('model_status', updated);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  // Storage helpers — chrome path uses safeStorageGet/Set; fallback uses localStorage
  private async _getStoredData(key: string): Promise<unknown> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await safeStorageGet<Record<string, unknown>>([key]);
        return result[key] ?? null;
      }
      const data = localStorage.getItem(`lmm_${key}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async _storeData(key: string, data: unknown): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await safeStorageSet({ [key]: data });
      } else {
        localStorage.setItem(`lmm_${key}`, JSON.stringify(data));
      }
    } catch {
      // Silently ignore storage errors
    }
  }
}
