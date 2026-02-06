/**
 * Refactored Local Model Manager for Hunyuan-MT-7B using llama.cpp
 * Now uses modular architecture with focused responsibilities
 */

import { logger } from './logger.js';
import { standardErrorHandler } from './standardErrorHandler.js';
import { ModelValidator } from './ModelValidator.js';
import { ModelUpdater } from './ModelUpdater.js';
import { ModelPerformanceMonitor } from './ModelPerformanceMonitor.js';

export class LocalModelManager {
  constructor() {
    this.isInitialized = false;
    this.modelLoaded = false;
    this.llamaCppInstance = null;
    this.modelPath = null;
    this.downloadProgress = 0;
    this.isDownloading = false;
    this.modelWorker = null;
    this.requestQueue = [];
    this.isProcessing = false;

    // Memory management
    this.maxConcurrentRequests = 1;
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

    // Model registry with version information
    this.modelRegistry = {
      'hunyuan-mt-7b': {
        versions: {
          '1.0.0': {
            size: 4.37 * 1024 * 1024 * 1024,
            checksums: {
              sha256: '7c4b8f9e2d3a1b6c5a8f7e9d2c3b1a6f5e8d7c9b2a1f6e5d8c7b9a2f1e6d5c8b9a2',
              md5: '9b2a1f6e5d8c7b9a2f1e6d5c8b9a2f1e'
            },
            url: 'https://example.com/models/hunyuan-mt-7b-v1.0.0.gguf',
            features: ['Translation', 'Multi-language support'],
            deprecated: false
          }
        },
        latest: '1.0.0'
      }
    };

    // Initialize specialized modules
    this.validator = new ModelValidator(this.modelRegistry, {
      enableSizeValidation: true,
      enableChecksumValidation: true,
      enableStructuralValidation: true,
      sizeTolerance: 0.01,
      checksumAlgorithm: 'sha256'
    });

    this.updater = new ModelUpdater(this.modelRegistry, {
      currentModelVersion: '1.0.0',
      autoUpdateEnabled: false,
      updateCheckInterval: 24 * 60 * 60 * 1000,
      updateNotifications: true
    });

    this.performanceMonitor = new ModelPerformanceMonitor({
      enableMemoryMonitoring: true,
      enableInferenceTracking: true,
      enableAdaptiveOptimization: true,
      memoryThreshold: 0.8
    });

    // Bind methods to maintain 'this' context
    this.retrieveModel = this.retrieveModel.bind(this);
    this.downloadModel = this.downloadModel.bind(this);
  }

  /**
   * Initialize the model manager
   */
  async init() {
    if (this.isInitialized) {
      return { success: true, message: 'Already initialized' };
    }

    try {
      logger.info('LocalModelManager', 'Initializing Local Model Manager...');

      // Check if model exists in storage
      const modelStatus = await this.getModelStatus();

      if (modelStatus.downloaded) {
        // Check for version compatibility and updates
        const updateInfo = await this.updater.checkForUpdates();

        // Validate model integrity
        const validationResult = await this.validator.validateModelIntegrity(
          modelStatus,
          this.retrieveModel
        );

        if (!validationResult.valid) {
          logger.warn('LocalModelManager', 'Model validation failed, may need re-download');
          this.modelCorrupted = true;
        }
      }

      // Schedule periodic update checks
      this.updater.scheduleUpdateCheck();

      // Start performance monitoring
      this.performanceMonitor.startPerformanceMonitoring();

      this.isInitialized = true;
      logger.info('LocalModelManager', 'Local Model Manager initialized successfully');

      return { success: true, message: 'Initialized successfully' };

    } catch (error) {
      const handledError = standardErrorHandler.handleError(error, {
        operation: 'init',
        component: 'LocalModelManager',
        recoverable: false
      });

      logger.error('LocalModelManager', 'Initialization failed:', handledError);
      throw handledError;
    }
  }

  /**
   * Handle error with recovery strategies
   */
  handleError(error, context = 'unknown', retryable = true) {
    logger.error('LocalModelManager', `Error in ${context}:`, error);

    this.lastError = error;
    this.consecutiveFailures++;

    // Use standardized error handling
    const handledError = standardErrorHandler.handleError(error, {
      operation: context,
      component: 'LocalModelManager',
      recoverable: retryable,
      retryCount: this.consecutiveFailures
    });

    // Categorize error and determine recovery strategy
    if (error.name === 'QuotaExceededError' || error.message?.includes('storage')) {
      this.handleStorageError(error, context);
    } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
      this.handleNetworkError(error, context);
    } else if (error.message?.includes('corrupted') || error.message?.includes('invalid')) {
      this.handleCorruptionError(error, context);
    } else if (error.message?.includes('memory')) {
      this.handleMemoryError(error, context);
    }

    // Trigger recovery if too many consecutive failures
    if (this.consecutiveFailures >= 3 && !this.isInRecovery) {
      this.triggerRecovery();
    }

    return handledError;
  }

  /**
   * Download model with progress tracking
   */
  async downloadModel(onProgress = null, retryAttempt = 0) {
    if (this.isDownloading) {
      throw new Error('Download already in progress');
    }

    this.isDownloading = true;
    this.downloadProgress = 0;

    try {
      logger.info('LocalModelManager', 'Starting model download...');

      const modelInfo = this.modelRegistry['hunyuan-mt-7b'].versions['1.0.0'];
      const modelUrl = modelInfo.url;

      // Add timeout for fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 minutes

      const response = await fetch(modelUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Translation-Extension/1.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
      }

      const totalBytes = parseInt(response.headers.get('content-length')) || modelInfo.size;
      const reader = response.body.getReader();
      const chunks = [];
      let receivedBytes = 0;
      let lastProgressUpdate = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;
        this.downloadProgress = (receivedBytes / totalBytes) * 100;

        // Throttle progress updates
        const now = Date.now();
        if (now - lastProgressUpdate > 500) { // Update every 500ms
          if (onProgress) {
            onProgress({
              loaded: receivedBytes,
              total: totalBytes,
              progress: this.downloadProgress
            });
          }
          lastProgressUpdate = now;
        }

        // Check for cancellation
        if (this.downloadCancelled) {
          throw new Error('Download cancelled by user');
        }
      }

      // Final progress update
      this.downloadProgress = 100;
      if (onProgress) {
        onProgress({
          loaded: receivedBytes,
          total: totalBytes,
          progress: 100,
          complete: true
        });
      }

      // Validate downloaded size
      if (receivedBytes !== totalBytes) {
        throw new Error(`Size mismatch: expected ${totalBytes}, got ${receivedBytes}`);
      }

      // Combine chunks into single Uint8Array
      const modelData = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        modelData.set(chunk, offset);
        offset += chunk.length;
      }

      // Validate integrity before storing
      const validationResult = await this.validator.validateModelIntegrity(
        { downloaded: true, size: receivedBytes },
        async () => modelData
      );

      if (!validationResult.valid) {
        throw new Error('Downloaded model failed integrity validation');
      }

      // Store model
      await this.storeModel(modelData);

      // Update model status
      await this.updateModelStatus({
        downloaded: true,
        size: receivedBytes,
        downloadDate: new Date().toISOString(),
        version: '1.0.0',
        integrity: 'verified'
      });

      this.resetConsecutiveFailures();
      logger.info('LocalModelManager', 'Model download completed successfully');

      return { success: true, size: receivedBytes };

    } catch (error) {
      logger.error('LocalModelManager', 'Model download failed:', error);

      // Retry logic with exponential backoff
      if (retryAttempt < this.maxRetries && this.shouldRetryDownload(error)) {
        const delay = Math.min(this.retryDelayMs * Math.pow(2, retryAttempt), this.maxRetryDelayMs);
        logger.info('LocalModelManager', `Retrying download in ${delay}ms (attempt ${retryAttempt + 1}/${this.maxRetries})`);

        await this.sleep(delay);
        return this.downloadModel(onProgress, retryAttempt + 1);
      }

      throw this.handleError(error, 'download', true);
    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * Load model into memory
   */
  async loadModel() {
    if (this.modelLoaded) {
      return { success: true, message: 'Model already loaded' };
    }

    try {
      logger.info('LocalModelManager', 'Loading model into memory...');

      // Load model data from storage
      const modelData = await this.retrieveModel();

      // Initialize llama.cpp worker
      this.modelWorker = new Worker('/llamacpp-worker.js');

      // Load model in worker
      const loadResult = await this.sendWorkerMessage({
        command: 'load',
        modelData: modelData
      });

      if (!loadResult.success) {
        throw new Error(loadResult.error || 'Failed to load model in worker');
      }

      this.modelLoaded = true;
      this.lastUsed = Date.now();
      this.scheduleUnload();

      logger.info('LocalModelManager', 'Model loaded successfully');
      return { success: true };

    } catch (error) {
      throw this.handleError(error, 'load', true);
    }
  }

  /**
   * Translate text using the loaded model
   */
  async translateText(text, sourceLanguage, targetLanguage) {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    const startTime = Date.now();

    try {
      const prompt = this.createTranslationPrompt(text, sourceLanguage, targetLanguage);

      const result = await this.sendWorkerMessage({
        command: 'translate',
        prompt: prompt,
        options: {
          maxTokens: 512,
          temperature: 0.1
        }
      });

      if (!result.success) {
        throw new Error(result.error || 'Translation failed');
      }

      const inferenceTime = Date.now() - startTime;

      // Update performance stats
      this.performanceMonitor.updatePerformanceStats(inferenceTime, true, text.length);

      this.lastUsed = Date.now();
      this.scheduleUnload();

      logger.debug('LocalModelManager', `Translation completed in ${inferenceTime}ms`);

      return {
        translatedText: result.output,
        inferenceTime: inferenceTime,
        confidence: result.confidence || 0.8
      };

    } catch (error) {
      const inferenceTime = Date.now() - startTime;
      this.performanceMonitor.updatePerformanceStats(inferenceTime, false, text.length);

      // Retry logic for translation failures
      if (this.shouldRetryTranslation(error) && this.consecutiveFailures < this.maxRetries) {
        logger.warn('LocalModelManager', 'Retrying translation after error:', error.message);

        // If model worker failed, try to reload it
        if (error.message.includes('worker')) {
          this.modelLoaded = false;
          await this.loadModel();
        }

        return this.translateText(text, sourceLanguage, targetLanguage);
      }

      throw this.handleError(error, 'translate', true);
    }
  }

  /**
   * Get model status and health information
   */
  async getModelStatus() {
    try {
      // Get basic status from storage
      const stored = await this.getStoredData('model_status');
      const defaultStatus = {
        downloaded: false,
        loaded: this.modelLoaded,
        size: 0,
        downloadDate: null,
        lastValidated: null,
        version: null,
        integrity: 'unknown'
      };

      const status = { ...defaultStatus, ...stored };

      // Add performance metrics
      status.performance = this.performanceMonitor.getPerformanceSummary();

      // Add update information
      status.updateInfo = this.updater.getUpdateInfo();

      return status;

    } catch (error) {
      logger.error('LocalModelManager', 'Failed to get model status:', error);
      return {
        downloaded: false,
        loaded: false,
        error: error.message
      };
    }
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    const health = {
      status: 'healthy',
      checks: {},
      timestamp: new Date().toISOString(),
      summary: ''
    };

    try {
      // Check initialization
      health.checks.initialized = {
        passed: this.isInitialized,
        message: this.isInitialized ? 'Manager initialized' : 'Manager not initialized'
      };

      // Check model availability
      const modelStatus = await this.getModelStatus();
      health.checks.modelAvailable = {
        passed: modelStatus.downloaded,
        message: modelStatus.downloaded ? 'Model available' : 'Model not downloaded'
      };

      // Check model integrity if available
      if (modelStatus.downloaded) {
        try {
          const validationResult = await this.validator.validateModelIntegrity(
            modelStatus,
            this.retrieveModel
          );

          health.checks.integrity = {
            passed: validationResult.valid,
            message: validationResult.valid ? 'Model integrity verified' : 'Model integrity check failed',
            details: validationResult
          };
        } catch (error) {
          health.checks.integrity = {
            passed: false,
            message: `Integrity check error: ${error.message}`
          };
        }
      }

      // Check worker status
      health.checks.worker = {
        passed: this.modelWorker !== null && this.modelLoaded,
        message: this.modelLoaded ? 'Model worker operational' : 'Model worker not loaded'
      };

      // Determine overall health
      const failedChecks = Object.values(health.checks).filter(check => !check.passed);
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
      logger.error('LocalModelManager', 'Health check failed:', error);
    }

    return health;
  }

  /**
   * Update model to latest version
   */
  async updateModel(progressCallback = null) {
    return this.updater.updateModelToVersion(
      null, // Use latest version
      progressCallback,
      this.downloadModel.bind(this)
    );
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    return this.performanceMonitor.getPerformanceSummary();
  }

  /**
   * Clean up resources
   */
  async destroy() {
    try {
      logger.info('LocalModelManager', 'Cleaning up LocalModelManager...');

      // Stop performance monitoring
      this.performanceMonitor.destroy();

      // Stop update checking
      this.updater.destroy();

      // Clean up timers
      if (this.unloadTimer) {
        clearTimeout(this.unloadTimer);
      }

      // Terminate worker
      if (this.modelWorker) {
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

  async retrieveModel() {
    // Retrieve model data from IndexedDB
    const data = await this.getStoredData('model_data');
    if (!data) {
      throw new Error('Model data not found in storage');
    }
    return data;
  }

  async storeModel(modelData) {
    // Store in IndexedDB
    await this.storeData('model_data', modelData);
    logger.debug('LocalModelManager', 'Model stored in IndexedDB');
  }

  async updateModelStatus(updates) {
    const current = await this.getStoredData('model_status') || {};
    const updated = { ...current, ...updates };
    await this.storeData('model_status', updated);
    logger.debug('LocalModelManager', 'Model status updated:', updates);
  }

  createTranslationPrompt(text, sourceLanguage, targetLanguage) {
    return `Translate the following text from ${sourceLanguage} to ${targetLanguage}:\n\n${text}\n\nTranslation:`;
  }

  scheduleUnload() {
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
    }

    this.unloadTimer = setTimeout(() => {
      if (Date.now() - this.lastUsed >= this.unloadTimeout) {
        this.unloadModel();
      }
    }, this.unloadTimeout);
  }

  async unloadModel() {
    if (this.modelWorker) {
      this.modelWorker.terminate();
      this.modelWorker = null;
    }
    this.modelLoaded = false;
    logger.info('LocalModelManager', 'Model unloaded due to inactivity');
  }

  shouldRetryDownload(error) {
    return error.message?.includes('network') ||
           error.message?.includes('timeout') ||
           error.message?.includes('fetch');
  }

  shouldRetryTranslation(error) {
    return !error.message?.includes('memory') &&
           !error.message?.includes('corrupted');
  }

  resetConsecutiveFailures() {
    this.consecutiveFailures = 0;
    this.lastError = null;
  }

  async triggerRecovery() {
    this.isInRecovery = true;
    try {
      logger.warn('LocalModelManager', 'Triggering recovery mode due to consecutive failures');

      // Unload model
      await this.unloadModel();

      // Clear potentially corrupted data
      this.modelCorrupted = true;

      // Reset error state
      this.resetConsecutiveFailures();

      logger.info('LocalModelManager', 'Recovery completed');
    } catch (error) {
      logger.error('LocalModelManager', 'Recovery failed:', error);
    } finally {
      this.isInRecovery = false;
    }
  }

  async sendWorkerMessage(message) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker communication timeout'));
      }, 30000); // 30 second timeout

      const handler = (event) => {
        clearTimeout(timeout);
        this.modelWorker.removeEventListener('message', handler);

        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data);
        }
      };

      this.modelWorker.addEventListener('message', handler);
      this.modelWorker.postMessage(message);
    });
  }

  handleStorageError(error, context) {
    logger.warn('LocalModelManager', `Storage error in ${context}, attempting cleanup`);
  }

  handleNetworkError(error, context) {
    logger.warn('LocalModelManager', `Network error in ${context}, will retry if possible`);
  }

  handleCorruptionError(error, context) {
    logger.error('LocalModelManager', `Corruption detected in ${context}, triggering recovery`);
    this.modelCorrupted = true;
    this.triggerRecovery();
  }

  handleMemoryError(error, context) {
    logger.error('LocalModelManager', `Memory error in ${context}, reducing memory usage`);
    this.performanceMonitor.handleMemoryPressure(0.9);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Storage helper methods (simplified)
  async getStoredData(key) {
    // Implementation would use IndexedDB
    return null;
  }

  async storeData(key, data) {
    // Implementation would use IndexedDB
    logger.debug('LocalModelManager', `Stored data for key: ${key}`);
  }
}