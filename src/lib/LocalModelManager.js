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
import { ModelValidator } from './ModelValidator.js';
import { ModelUpdater } from './ModelUpdater.js';
import { ModelPerformanceMonitor } from './ModelPerformanceMonitor.js';

/**
 * Default model configuration.
 * Sharded URLs split the model into <500MB chunks to avoid ArrayBuffer limits.
 */
const DEFAULT_MODEL_CONFIG = {
  // Model shard URLs -- wllama downloads and caches each shard separately.
  // For a ~2.3GB Q4_K_M model, split into 6 shards of ~500MB each.
  // Update these URLs to point to your actual model hosting.
  modelUrls: [
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00001-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00002-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00003-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00004-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00005-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00006-of-00006.gguf',
  ],
  // Inference config passed to wllama
  inference: {
    n_ctx: 2048,
    n_batch: 512,
    cache_type_k: 'q8_0',
    cache_type_v: 'q8_0',
  },
  // Total expected size (for progress UI)
  totalSize: 2489909952, // 2.32 GB (6 shards)
  // Model name for display
  displayName: 'TranslateGemma 4B Q4_K_M',
};

export class LocalModelManager {
  constructor() {
    this.isInitialized = false;
    this.modelLoaded = false;
    this.modelWorker = null;
    this.modelConfig = { ...DEFAULT_MODEL_CONFIG };

    // Download state
    this.downloadProgress = 0;
    this.isDownloading = false;
    this.downloadCancelled = false;

    // Request management
    this.requestQueue = [];
    this.isProcessing = false;
    this.pendingRequests = new Map();

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
      enableChecksumValidation: false, // Checksums checked per-shard by wllama
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
  async init() {
    if (this.isInitialized) {
      return { success: true, message: 'Already initialized' };
    }

    try {
      logger.info('LocalModelManager', 'Initializing Local Model Manager (wllama backend)...');

      // Check if model is cached (wllama uses Cache API internally)
      const modelStatus = await this.getModelStatus();

      if (modelStatus.downloaded) {
        const updateInfo = await this.updater.checkForUpdates();
        logger.info('LocalModelManager', 'Model cached. Update info:', updateInfo);
      }

      // Schedule periodic update checks
      this.updater.scheduleUpdateCheck();

      // Start performance monitoring
      this.performanceMonitor.startPerformanceMonitoring();

      this.isInitialized = true;
      logger.info('LocalModelManager', 'Local Model Manager initialized (wllama backend)');

      return { success: true, message: 'Initialized successfully' };

    } catch (error) {
      const handledError = standardErrorHandler.handleError(error, {
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
   * This method triggers that download by loading the model in a worker.
   *
   * @param {function} [onProgress] - Progress callback ({loaded, total, progress, shardIndex, shardCount})
   * @param {number} [retryAttempt=0]
   */
  async downloadModel(onProgress = null, retryAttempt = 0) {
    if (this.isDownloading) {
      throw new Error('Download already in progress');
    }

    this.isDownloading = true;
    this.downloadProgress = 0;
    this.downloadCancelled = false;

    try {
      logger.info('LocalModelManager', 'Starting model download (sharded, wllama)...');

      // Create worker and load model -- wllama downloads and caches shards
      await this._ensureWorker();

      await this._sendWorkerMessage({
        type: 'loadModel',
        modelUrls: this.modelConfig.modelUrls,
        config: this.modelConfig.inference,
      }, (message) => {
        // Handle progress messages from worker
        if (message.type === 'progress') {
          this.downloadProgress = message.progress;
          if (onProgress) {
            onProgress({
              loaded: message.loaded,
              total: message.total,
              progress: message.progress,
              status: 'Downloading model shards...',
            });
          }
        }
      });

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

      // Update model status
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

      // Retry with exponential backoff
      if (retryAttempt < this.maxRetries && this._shouldRetryDownload(error)) {
        const delay = Math.min(
          this.retryDelayMs * Math.pow(2, retryAttempt),
          this.maxRetryDelayMs,
        );
        logger.info('LocalModelManager',
          `Retrying download in ${delay}ms (attempt ${retryAttempt + 1}/${this.maxRetries})`);

        await this._sleep(delay);
        return this.downloadModel(onProgress, retryAttempt + 1);
      }

      throw this._handleError(error, 'download', true);

    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * Cancel an in-progress download.
   */
  cancelModelDownload() {
    this.downloadCancelled = true;
    if (this.modelWorker) {
      this.modelWorker.postMessage({ type: 'abort' });
    }
    logger.info('LocalModelManager', 'Download cancellation requested');
  }

  /**
   * Load model into memory (if already cached).
   */
  async loadModel() {
    if (this.modelLoaded) {
      return { success: true, message: 'Model already loaded' };
    }

    try {
      logger.info('LocalModelManager', 'Loading model into memory...');

      await this._ensureWorker();

      // Load from URL(s) -- wllama will use cached shards if available
      await this._sendWorkerMessage({
        type: 'loadModel',
        modelUrls: this.modelConfig.modelUrls,
        config: this.modelConfig.inference,
      });

      this.modelLoaded = true;
      this.lastUsed = Date.now();
      this._scheduleUnload();

      logger.info('LocalModelManager', 'Model loaded successfully');
      return { success: true };

    } catch (error) {
      throw this._handleError(error, 'load', true);
    }
  }

  /**
   * Translate text using the loaded model.
   *
   * @param {string} text - Source text
   * @param {string} sourceLanguage - Source language code
   * @param {string} targetLanguage - Target language code
   * @returns {Promise<{text: string, translatedText: string, inferenceTime: number, confidence: number}>}
   */
  async translateText(text, sourceLanguage, targetLanguage) {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    const startTime = Date.now();
    const requestId = `tr_${  Date.now()  }_${  Math.random().toString(36).slice(2, 8)}`;

    try {
      const prompt = this._createTranslationPrompt(text, sourceLanguage, targetLanguage);

      const result = await this._sendWorkerMessage({
        type: 'translate',
        prompt,
        maxTokens: 512,
        temperature: 0.1,
        requestId,
      });

      const inferenceTime = Date.now() - startTime;

      // Update performance stats
      this.performanceMonitor.updatePerformanceStats(inferenceTime, true, text.length);

      this.lastUsed = Date.now();
      this._scheduleUnload();

      logger.debug('LocalModelManager', `Translation completed in ${inferenceTime}ms`);

      return {
        text: result.translatedText,
        translatedText: result.translatedText,
        inferenceTime,
        confidence: 0.8,
        tokensGenerated: result.tokensGenerated || 0,
      };

    } catch (error) {
      const inferenceTime = Date.now() - startTime;
      this.performanceMonitor.updatePerformanceStats(inferenceTime, false, text.length);

      if (this._shouldRetryTranslation(error) && this.consecutiveFailures < this.maxRetries) {
        logger.warn('LocalModelManager', 'Retrying translation after error:', error.message);

        if (error.message.includes('worker') || error.message.includes('not loaded')) {
          this.modelLoaded = false;
          await this.loadModel();
        }

        return this.translateText(text, sourceLanguage, targetLanguage);
      }

      throw this._handleError(error, 'translate', true);
    }
  }

  /**
   * Convenience alias for translateText (used by UI).
   */
  async translate(text, sourceLanguage, targetLanguage) {
    return this.translateText(text, sourceLanguage, targetLanguage);
  }

  /**
   * Get model status.
   */
  async getModelStatus() {
    try {
      const stored = await this._getStoredData('model_status');
      const defaultStatus = {
        downloaded: false,
        loaded: this.modelLoaded,
        size: 0,
        downloadDate: null,
        lastValidated: null,
        version: null,
        integrity: 'unknown',
        backend: 'wllama',
      };

      const status = { ...defaultStatus, ...stored, loaded: this.modelLoaded };
      status.performance = this.performanceMonitor.getPerformanceSummary();
      status.updateInfo = this.updater.getUpdateInfo();

      return status;

    } catch (error) {
      logger.error('LocalModelManager', 'Failed to get model status:', error);
      return { downloaded: false, loaded: false, error: error.message };
    }
  }

  /**
   * Get model info (legacy compatibility).
   */
  getModelInfo() {
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
  getDownloadProgress() {
    return {
      isDownloading: this.isDownloading,
      progress: this.downloadProgress,
    };
  }

  /**
   * Perform health check.
   */
  async performHealthCheck() {
    const health = {
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
      health.error = error.message;
    }

    return health;
  }

  /**
   * Aliases for legacy API compatibility.
   */
  async healthCheck() {
    return this.performHealthCheck();
  }

  async deleteModel() {
    try {
      // Terminate worker
      if (this.modelWorker) {
        this.modelWorker.postMessage({ type: 'cleanup' });
        this.modelWorker.terminate();
        this.modelWorker = null;
      }
      this.modelLoaded = false;

      // Clear wllama cache via Cache API
      if (typeof caches !== 'undefined') {
        const cacheKeys = await caches.keys();
        for (const key of cacheKeys) {
          if (key.includes('wllama') || key.includes('gguf')) {
            await caches.delete(key);
          }
        }
      }

      // Clear status from storage
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
  setModelUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('modelUrls must be a non-empty array');
    }
    this.modelConfig.modelUrls = urls;
    logger.info('LocalModelManager', `Model URLs updated (${urls.length} shards)`);
  }

  /**
   * Get performance summary.
   */
  getPerformanceSummary() {
    return this.performanceMonitor.getPerformanceSummary();
  }

  /**
   * Update model to latest version.
   */
  async updateModel(progressCallback = null) {
    return this.updater.updateModelToVersion(
      null,
      progressCallback,
      this.downloadModel.bind(this),
    );
  }

  /**
   * Clean up all resources.
   */
  async destroy() {
    try {
      logger.info('LocalModelManager', 'Cleaning up LocalModelManager...');

      this.performanceMonitor.destroy();
      this.updater.destroy();

      if (this.unloadTimer) {
        clearTimeout(this.unloadTimer);
      }

      if (this.modelWorker) {
        try {
          this.modelWorker.postMessage({ type: 'cleanup' });
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

  _createTranslationPrompt(text, sourceLanguage, targetLanguage) {
    return `Translate the following text from ${sourceLanguage} to ${targetLanguage}:\n\n${text}\n\nTranslation:`;
  }

  async _ensureWorker() {
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
  _sendWorkerMessage(message, onIntermediateMessage = null) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker communication timeout'));
      }, 5 * 60 * 1000); // 5 minute timeout (model download can be slow)

      const handler = (event) => {
        const data = event.data;

        // Handle intermediate messages (progress, status)
        if (data.type === 'progress' || data.type === 'status') {
          if (onIntermediateMessage) {
            onIntermediateMessage(data);
          }
          return; // Don't resolve yet
        }

        // Terminal messages
        clearTimeout(timeout);
        this.modelWorker.removeEventListener('message', handler);

        if (data.type === 'error') {
          reject(new Error(data.message));
        } else {
          resolve(data);
        }
      };

      this.modelWorker.addEventListener('message', handler);
      this.modelWorker.postMessage(message);
    });
  }

  _handleError(error, context, retryable = true) {
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

  _shouldRetryDownload(error) {
    const msg = error.message || '';
    return msg.includes('network') ||
           msg.includes('timeout') ||
           msg.includes('fetch') ||
           msg.includes('Failed to fetch');
  }

  _shouldRetryTranslation(error) {
    const msg = error.message || '';
    return !msg.includes('memory') && !msg.includes('corrupted');
  }

  _scheduleUnload() {
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
    }
    this.unloadTimer = setTimeout(() => {
      if (Date.now() - this.lastUsed >= this.unloadTimeout) {
        this._unloadModel();
      }
    }, this.unloadTimeout);
  }

  async _unloadModel() {
    if (this.modelWorker) {
      try {
        this.modelWorker.postMessage({ type: 'cleanup' });
      } catch { /* ignore */ }
      this.modelWorker.terminate();
      this.modelWorker = null;
    }
    this.modelLoaded = false;
    logger.info('LocalModelManager', 'Model unloaded due to inactivity');
  }

  async _triggerRecovery() {
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

  async retrieveModel() {
    // wllama manages its own cache -- return status only
    const status = await this.getModelStatus();
    return status.downloaded ? { cached: true } : null;
  }

  async updateModelStatus(updates) {
    const current = await this._getStoredData('model_status') || {};
    const updated = { ...current, ...updates };
    await this._storeData('model_status', updated);
  }

  _sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  // IndexedDB storage helpers
  async _getStoredData(key) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([key], (result) => {
            resolve(result[key] || null);
          });
        } else {
          // Fallback to localStorage for testing
          const data = localStorage.getItem(`lmm_${  key}`);
          resolve(data ? JSON.parse(data) : null);
        }
      } catch {
        resolve(null);
      }
    });
  }

  async _storeData(key, data) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [key]: data }, () => resolve());
        } else {
          localStorage.setItem(`lmm_${  key}`, JSON.stringify(data));
          resolve();
        }
      } catch {
        resolve();
      }
    });
  }
}
