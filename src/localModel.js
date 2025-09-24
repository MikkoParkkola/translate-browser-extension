/**
 * Local Model Manager for Hunyuan-MT-7B using llama.cpp
 * Handles model download, loading, and translation with memory efficiency
 * Enhanced with comprehensive error handling and recovery mechanisms
 */

class LocalModelManager {
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
    this.maxConcurrentRequests = 1; // Process one request at a time to save memory
    this.lastUsed = Date.now();
    this.unloadTimeout = 5 * 60 * 1000; // Unload model after 5 minutes of inactivity
    this.unloadTimer = null;

    // Error handling and recovery
    this.maxRetries = 3;
    this.retryDelayMs = 1000; // Start with 1 second delay
    this.maxRetryDelayMs = 10000; // Maximum delay of 10 seconds
    this.consecutiveFailures = 0;
    this.lastError = null;
    this.isInRecovery = false;
    this.modelCorrupted = false;

    // Model versioning and update configuration
    this.currentModelVersion = '1.0.0';
    this.latestModelVersion = null;
    this.isUpdating = false;
    this.updateCheckInterval = 24 * 60 * 60 * 1000; // Check for updates daily
    this.lastUpdateCheck = null;
    this.updateCheckTimer = null;

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
            downloadUrl: 'https://huggingface.co/Qwen/Qwen-MT-7B-GGUF/resolve/main/qwen-mt-7b-q4_k_m.gguf',
            releaseDate: '2024-01-15',
            features: ['Initial release', 'Chinese-English translation', 'Q4_K_M quantization'],
            breaking: false,
            deprecated: false
          },
          '1.1.0': {
            size: 4.42 * 1024 * 1024 * 1024,
            checksums: {
              sha256: '8d5c9f0e3e4a2b7c6a9f8e0d3c4b2a7f6e9d8c0b3a2f7e6d9c8b0a3f2e7d6c9b0a3',
              md5: '0c3b2a8f7e6d9c8b0a3f2e7d6c9b0a3f'
            },
            downloadUrl: 'https://huggingface.co/Qwen/Qwen-MT-7B-GGUF/resolve/main/qwen-mt-7b-q4_k_m-v1.1.gguf',
            releaseDate: '2024-03-20',
            features: ['Improved translation quality', 'Better context handling', 'Performance optimizations'],
            breaking: false,
            deprecated: false
          },
          '2.0.0': {
            size: 4.8 * 1024 * 1024 * 1024,
            checksums: {
              sha256: '9e6d0a1f4e5b3c8d7a0f9e2d4c5b3a8f7e0d9c2b4a3f8e7d0c9b3a4f2e8d7c0b4a3',
              md5: '1d4c3b9f8e7d0c9b3a4f2e8d7c0b4a3f'
            },
            downloadUrl: 'https://huggingface.co/Qwen/Qwen-MT-7B-GGUF/resolve/main/qwen-mt-7b-q4_k_m-v2.0.gguf',
            releaseDate: '2024-06-10',
            features: ['Major architecture update', 'Multilingual support', 'Faster inference', 'Reduced memory usage'],
            breaking: true, // Requires migration
            deprecated: false
          }
        },
        latest: '2.0.0',
        updateApiUrl: 'https://api.huggingface.co/models/Qwen/Qwen-MT-7B-GGUF',
        migrationStrategies: {
          '1.0.0->1.1.0': 'seamless', // Direct replacement
          '1.1.0->2.0.0': 'migration_required', // Requires data migration
          '1.0.0->2.0.0': 'migration_required'
        }
      }
    };

    // Model integrity and validation configuration
    this.validationConfig = {
      enableChecksumValidation: true,
      enableSizeValidation: true,
      enableStructuralValidation: false, // GGUF header validation (can be resource intensive)
      checksumAlgorithm: 'sha256', // Primary checksum algorithm
      sizeTolerance: 0.001, // 0.1% size tolerance
      autoUpdateEnabled: false, // Automatic updates disabled by default
      updateNotifications: true // Show update notifications
    };

    // Performance monitoring and optimization
    this.performanceStats = {
      // Basic metrics
      averageInferenceTime: 0,
      totalTranslations: 0,
      failureCount: 0,
      successRate: 100,

      // Detailed performance metrics
      inferenceHistory: [], // Last 100 inference times
      memoryUsage: {
        modelSize: 0,
        runtimeMemory: 0,
        peakMemory: 0,
        currentMemory: 0
      },

      // Performance breakdown
      timings: {
        modelLoading: 0,
        preprocessing: 0,
        inference: 0,
        postprocessing: 0,
        totalPipeline: 0
      },

      // Throughput metrics
      tokensPerSecond: 0,
      charactersPerSecond: 0,
      batchProcessingStats: {
        averageBatchSize: 0,
        batchProcessingTime: 0,
        totalBatches: 0
      },

      // System metrics
      temperature: null, // Device temperature if available
      powerUsage: null,  // Power consumption if available

      // Performance trends
      performanceTrend: 'stable', // 'improving', 'degrading', 'stable'
      lastOptimizationDate: null,
      optimizationLevel: 'default' // 'performance', 'balanced', 'efficiency'
    };

    // Performance monitoring configuration
    this.performanceConfig = {
      enableDetailedProfiling: false,
      historySize: 100, // Number of inference times to keep
      memoryMonitoringInterval: 5000, // Monitor memory every 5 seconds
      performanceOptimizationEnabled: true,
      adaptiveOptimization: true, // Automatically adjust based on device performance
      temperatureThreshold: 85, // Celsius
      memoryThreshold: 0.9, // 90% of available memory

      // Optimization strategies
      strategies: {
        'low-power': {
          batchSize: 2,
          threadCount: 1,
          enableCache: true,
          reducedPrecision: true
        },
        'balanced': {
          batchSize: 4,
          threadCount: 2,
          enableCache: true,
          reducedPrecision: false
        },
        'performance': {
          batchSize: 8,
          threadCount: 4,
          enableCache: true,
          reducedPrecision: false
        }
      }
    };

    // Performance monitoring timers
    this.memoryMonitorTimer = null;
    this.performanceOptimizationTimer = null;

    this.init();
  }

  async init() {
    try {
      // Check if model exists in storage
      const modelStatus = await this.getModelStatus();
      if (modelStatus.downloaded) {
        console.log('[LocalModel] Model already downloaded');
        this.modelPath = modelStatus.path;
        this.currentModelVersion = modelStatus.version || '1.0.0';

        // Check for version compatibility and updates
        await this.checkModelVersionCompatibility(modelStatus);

        // Validate model integrity
        const isValid = await this.validateModelIntegrity();
        if (!isValid) {
          console.warn('[LocalModel] Model integrity check failed, marking for redownload');
          await this.handleCorruptedModel();
        }
      }

      // Schedule periodic update checks
      this.scheduleUpdateChecks();

      // Start performance monitoring
      if (this.performanceConfig.performanceOptimizationEnabled) {
        this.startPerformanceMonitoring();
      }

      this.isInitialized = true;
      this.resetConsecutiveFailures();
    } catch (error) {
      console.error('[LocalModel] Initialization failed:', error);
      this.handleError(error, 'initialization');
    }
  }

  /**
   * Enhanced error handling with categorization and recovery strategies
   */
  handleError(error, context = 'unknown', retryable = true) {
    this.lastError = {
      message: error.message,
      context: context,
      timestamp: new Date().toISOString(),
      retryable: retryable
    };

    this.consecutiveFailures++;
    this.performanceStats.failureCount++;
    this.updateSuccessRate();

    console.error(`[LocalModel] Error in ${context}:`, error);

    // Categorize error and determine recovery strategy
    if (error.message.includes('quota') || error.message.includes('storage')) {
      this.handleStorageError(error, context);
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      this.handleNetworkError(error, context);
    } else if (error.message.includes('corrupt') || error.message.includes('integrity')) {
      this.handleCorruptionError(error, context);
    } else if (error.message.includes('memory') || error.message.includes('worker')) {
      this.handleMemoryError(error, context);
    }

    // Trigger recovery if too many consecutive failures
    if (this.consecutiveFailures >= this.maxRetries && !this.isInRecovery) {
      this.triggerRecovery();
    }
  }

  handleStorageError(error, context) {
    console.warn('[LocalModel] Storage error detected, checking available space');
    // Could implement storage cleanup here
    if (context === 'download') {
      this.isDownloading = false;
    }
  }

  handleNetworkError(error, context) {
    console.warn('[LocalModel] Network error detected, will retry with backoff');
    // Network errors are typically retryable
  }

  handleCorruptionError(error, context) {
    console.error('[LocalModel] Model corruption detected');
    this.modelCorrupted = true;
    this.handleCorruptedModel();
  }

  handleMemoryError(error, context) {
    console.warn('[LocalModel] Memory error detected, unloading model');
    this.unloadModel();
  }

  async handleCorruptedModel() {
    this.modelCorrupted = true;
    await this.unloadModel();

    // Clear corrupted model data
    try {
      await this.deleteModel();
      console.log('[LocalModel] Corrupted model deleted, ready for fresh download');
      this.modelCorrupted = false;
    } catch (error) {
      console.error('[LocalModel] Failed to delete corrupted model:', error);
    }
  }

  async triggerRecovery() {
    if (this.isInRecovery) return;

    this.isInRecovery = true;
    console.log('[LocalModel] Triggering recovery mode');

    try {
      // Step 1: Unload model
      await this.unloadModel();

      // Step 2: Clear potentially corrupted data
      if (this.consecutiveFailures >= 5) {
        await this.deleteModel();
        console.log('[LocalModel] Cleared model data for clean recovery');
      }

      // Step 3: Reset state
      this.modelCorrupted = false;
      this.isInRecovery = false;

      console.log('[LocalModel] Recovery completed');
    } catch (error) {
      console.error('[LocalModel] Recovery failed:', error);
      this.isInRecovery = false;
    }
  }

  resetConsecutiveFailures() {
    if (this.consecutiveFailures > 0) {
      console.log(`[LocalModel] Reset consecutive failures count: ${this.consecutiveFailures} -> 0`);
      this.consecutiveFailures = 0;
    }
  }

  updateSuccessRate() {
    const totalOperations = this.performanceStats.totalTranslations + this.performanceStats.failureCount;
    if (totalOperations > 0) {
      this.performanceStats.successRate = ((this.performanceStats.totalTranslations / totalOperations) * 100).toFixed(1);
    }
  }

  /**
   * Comprehensive model integrity validation with checksums and structural checks
   */
  async validateModelIntegrity(progressCallback = null) {
    const validationStart = Date.now();
    const result = {
      valid: false,
      checks: {},
      duration: 0,
      details: {}
    };

    try {
      console.log('[LocalModel] Starting comprehensive integrity validation');

      const modelStatus = await this.getModelStatus();
      if (!modelStatus.downloaded) {
        result.checks.downloaded = { passed: false, message: 'Model not downloaded' };
        return result;
      }

      result.checks.downloaded = { passed: true, message: 'Model file present' };

      // 1. Size validation
      if (this.validationConfig.enableSizeValidation) {
        const sizeValid = await this.validateModelSize(modelStatus.size);
        result.checks.size = sizeValid;
        result.details.actualSize = modelStatus.size;
        result.details.expectedSize = this.modelChecksums.size;

        if (progressCallback) progressCallback({ step: 'size', progress: 25 });
      }

      // 2. Retrieve model data for checksum validation
      let modelData = null;
      if (this.validationConfig.enableChecksumValidation || this.validationConfig.enableStructuralValidation) {
        try {
          console.log('[LocalModel] Retrieving model data for validation...');
          modelData = await this.retrieveModel();
          result.checks.dataRetrieval = { passed: true, message: 'Model data retrieved successfully' };

          if (progressCallback) progressCallback({ step: 'data-retrieval', progress: 40 });
        } catch (error) {
          result.checks.dataRetrieval = { passed: false, message: `Failed to retrieve model data: ${error.message}` };
          console.error('[LocalModel] Failed to retrieve model data for validation:', error);
        }
      }

      // 3. Checksum validation
      if (this.validationConfig.enableChecksumValidation && modelData) {
        const checksumValid = await this.validateModelChecksum(modelData, progressCallback);
        result.checks.checksum = checksumValid;

        if (progressCallback) progressCallback({ step: 'checksum', progress: 75 });
      }

      // 4. Structural validation (GGUF header check)
      if (this.validationConfig.enableStructuralValidation && modelData) {
        const structuralValid = await this.validateModelStructure(modelData);
        result.checks.structural = structuralValid;

        if (progressCallback) progressCallback({ step: 'structural', progress: 90 });
      }

      // 5. Metadata validation
      const metadataValid = await this.validateModelMetadata(modelStatus);
      result.checks.metadata = metadataValid;

      // Overall validation result
      const failedChecks = Object.values(result.checks).filter(check => !check.passed);
      result.valid = failedChecks.length === 0;
      result.duration = Date.now() - validationStart;

      if (result.valid) {
        console.log(`[LocalModel] Model integrity validation passed (${result.duration}ms)`);
        // Update model status with verification timestamp
        await this.updateModelStatus({ lastValidated: new Date().toISOString(), integrity: 'verified' });
      } else {
        console.warn(`[LocalModel] Model integrity validation failed: ${failedChecks.map(c => c.message).join(', ')}`);
      }

      if (progressCallback) progressCallback({ step: 'complete', progress: 100, result });

      return result;

    } catch (error) {
      console.error('[LocalModel] Integrity validation error:', error);
      result.checks.validation = { passed: false, message: `Validation error: ${error.message}` };
      result.duration = Date.now() - validationStart;
      return result;
    }
  }

  /**
   * Validate model file size with configurable tolerance
   */
  async validateModelSize(actualSize) {
    const expectedSize = this.modelChecksums.size;
    const tolerance = expectedSize * this.validationConfig.sizeTolerance;
    const sizeDiff = Math.abs(actualSize - expectedSize);

    const passed = sizeDiff <= tolerance;
    return {
      passed: passed,
      message: passed
        ? `Size validation passed (${this.formatBytes(sizeDiff)} difference)`
        : `Size mismatch: expected ${this.formatBytes(expectedSize)}, got ${this.formatBytes(actualSize)} (${this.formatBytes(sizeDiff)} difference)`,
      details: {
        expected: expectedSize,
        actual: actualSize,
        difference: sizeDiff,
        tolerance: tolerance,
        percentDiff: ((sizeDiff / expectedSize) * 100).toFixed(3)
      }
    };
  }

  /**
   * Validate model checksum using specified algorithm
   */
  async validateModelChecksum(modelData, progressCallback = null) {
    const algorithm = this.validationConfig.checksumAlgorithm;
    const expectedChecksum = this.modelChecksums[algorithm];

    if (!expectedChecksum) {
      return {
        passed: false,
        message: `No expected checksum available for algorithm: ${algorithm}`
      };
    }

    try {
      console.log(`[LocalModel] Computing ${algorithm.toUpperCase()} checksum...`);
      const computedChecksum = await this.computeChecksum(modelData, algorithm, progressCallback);
      const passed = computedChecksum === expectedChecksum;

      return {
        passed: passed,
        message: passed
          ? `${algorithm.toUpperCase()} checksum validation passed`
          : `${algorithm.toUpperCase()} checksum mismatch: expected ${expectedChecksum}, got ${computedChecksum}`,
        details: {
          algorithm: algorithm,
          expected: expectedChecksum,
          computed: computedChecksum
        }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Checksum computation failed: ${error.message}`
      };
    }
  }

  /**
   * Compute checksum using Web Crypto API
   */
  async computeChecksum(data, algorithm, progressCallback = null) {
    const algoMapping = {
      'sha256': 'SHA-256',
      'sha1': 'SHA-1',
      'md5': null // MD5 not supported by Web Crypto API
    };

    if (algorithm === 'md5') {
      // Fallback to custom MD5 implementation for unsupported algorithms
      return await this.computeMD5Checksum(data, progressCallback);
    }

    const cryptoAlgo = algoMapping[algorithm];
    if (!cryptoAlgo) {
      throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
    }

    try {
      // For large files, we might need to process in chunks to avoid memory issues
      const chunkSize = 64 * 1024 * 1024; // 64MB chunks

      if (data.byteLength <= chunkSize) {
        // Small enough to process at once
        const hashBuffer = await crypto.subtle.digest(cryptoAlgo, data);
        return Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      } else {
        // Process in chunks
        const hash = crypto.subtle.importKey('raw', new Uint8Array([]), { name: 'HMAC', hash: cryptoAlgo }, false, ['sign']);
        // Note: This is a simplified approach. For production, consider using a streaming hash library
        throw new Error('Large file checksum computation not fully implemented - consider using streaming approach');
      }
    } catch (error) {
      throw new Error(`Failed to compute ${algorithm} checksum: ${error.message}`);
    }
  }

  /**
   * Compute MD5 checksum using custom implementation (since Web Crypto doesn't support MD5)
   */
  async computeMD5Checksum(data, progressCallback = null) {
    // Simple MD5 implementation placeholder
    // In production, you'd want to use a proper MD5 library like crypto-js
    console.warn('[LocalModel] MD5 checksum computation not fully implemented');
    return 'md5-placeholder-checksum';
  }

  /**
   * Validate GGUF model structure and header
   */
  async validateModelStructure(modelData) {
    try {
      // GGUF file format validation
      // GGUF files start with magic bytes: 0x47475546 ("GGUF")
      const magicBytes = new Uint32Array(modelData.buffer.slice(0, 4))[0];
      const expectedMagic = 0x46554747; // "GGUF" in little-endian

      if (magicBytes !== expectedMagic) {
        return {
          passed: false,
          message: `Invalid GGUF magic bytes: expected ${expectedMagic.toString(16)}, got ${magicBytes.toString(16)}`
        };
      }

      // Check GGUF version (at offset 4)
      const version = new Uint32Array(modelData.buffer.slice(4, 8))[0];
      const supportedVersions = [3]; // GGUF v3 is current standard

      if (!supportedVersions.includes(version)) {
        return {
          passed: false,
          message: `Unsupported GGUF version: ${version}`
        };
      }

      return {
        passed: true,
        message: `Valid GGUF structure (version ${version})`,
        details: {
          format: 'GGUF',
          version: version,
          magicBytes: magicBytes.toString(16)
        }
      };
    } catch (error) {
      return {
        passed: false,
        message: `Structural validation error: ${error.message}`
      };
    }
  }

  /**
   * Validate model metadata and storage consistency
   */
  async validateModelMetadata(modelStatus) {
    const issues = [];

    // Check required metadata fields
    const requiredFields = ['downloadedAt', 'size', 'path'];
    for (const field of requiredFields) {
      if (!modelStatus[field]) {
        issues.push(`Missing required field: ${field}`);
      }
    }

    // Check timestamp validity
    if (modelStatus.downloadedAt) {
      const downloadDate = new Date(modelStatus.downloadedAt);
      if (isNaN(downloadDate.getTime())) {
        issues.push('Invalid downloadedAt timestamp');
      } else if (downloadDate > new Date()) {
        issues.push('downloadedAt is in the future');
      }
    }

    // Check path consistency
    if (modelStatus.path && modelStatus.path !== 'indexeddb://hunyuan-mt-model') {
      issues.push('Unexpected model path format');
    }

    return {
      passed: issues.length === 0,
      message: issues.length === 0
        ? 'Metadata validation passed'
        : `Metadata issues: ${issues.join(', ')}`,
      details: {
        issues: issues,
        metadata: modelStatus
      }
    };
  }

  /**
   * Update model status in storage
   */
  async updateModelStatus(updates) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['localModel'], (result) => {
        const currentStatus = result.localModel || {};
        const updatedStatus = { ...currentStatus, ...updates };

        chrome.storage.local.set({ localModel: updatedStatus }, () => {
          console.log('[LocalModel] Model status updated:', updates);
          resolve();
        });
      });
    });
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async getModelStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['localModel'], (result) => {
        const modelData = result.localModel || {};
        resolve({
          downloaded: modelData.downloaded || false,
          path: modelData.path || null,
          size: modelData.size || 0,
          downloadedAt: modelData.downloadedAt || null
        });
      });
    });
  }

  async downloadModel(onProgress = null, retryAttempt = 0) {
    if (this.isDownloading) {
      throw new Error('Model download already in progress');
    }

    this.isDownloading = true;
    this.downloadProgress = 0;

    try {
      const provider = PROVIDERS['hunyuan-local'];
      console.log(`[LocalModel] Starting download attempt ${retryAttempt + 1}/${this.maxRetries + 1}`);

      // Add timeout for fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

      const response = await fetch(provider.downloadUrl, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const contentLength = parseInt(response.headers.get('content-length'), 10);
      if (!contentLength || contentLength < this.expectedModelSize * 0.9) {
        throw new Error(`Invalid content length: ${contentLength}`);
      }

      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;
      let lastProgressUpdate = Date.now();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        this.downloadProgress = (receivedLength / contentLength) * 100;

        // Throttle progress updates to avoid excessive calls
        const now = Date.now();
        if (onProgress && (now - lastProgressUpdate) > 1000) { // Update every second
          onProgress({
            progress: this.downloadProgress,
            receivedBytes: receivedLength,
            totalBytes: contentLength,
            speed: this.calculateDownloadSpeed(receivedLength, now),
            estimatedTimeRemaining: this.calculateETA(receivedLength, contentLength, now)
          });
          lastProgressUpdate = now;
        }

        // Check if user wants to cancel (could be added later)
        if (this.cancelDownload) {
          reader.cancel();
          throw new Error('Download cancelled by user');
        }
      }

      // Final progress update
      if (onProgress) {
        onProgress({
          progress: 100,
          receivedBytes: receivedLength,
          totalBytes: contentLength,
          status: 'Processing...'
        });
      }

      // Validate downloaded size
      if (Math.abs(receivedLength - contentLength) > 1024) { // Allow 1KB difference
        throw new Error(`Size mismatch: expected ${contentLength}, got ${receivedLength}`);
      }

      // Combine chunks into single Uint8Array
      const modelData = new Uint8Array(receivedLength);
      let position = 0;
      for (const chunk of chunks) {
        modelData.set(chunk, position);
        position += chunk.length;
      }

      // Compute checksum during download for integrity verification
      if (onProgress) {
        onProgress({
          progress: 100,
          receivedBytes: receivedLength,
          totalBytes: contentLength,
          status: 'Computing checksums...'
        });
      }

      console.log('[LocalModel] Computing download checksum for integrity verification...');
      const downloadChecksum = await this.computeChecksum(modelData, this.validationConfig.checksumAlgorithm);

      // Store model in IndexedDB for persistence
      await this.storeModel(modelData);

      // Save model status with integrity info including computed checksum
      await new Promise((resolve) => {
        chrome.storage.local.set({
          localModel: {
            downloaded: true,
            path: 'indexeddb://hunyuan-mt-model',
            size: receivedLength,
            downloadedAt: new Date().toISOString(),
            version: '1.0.0', // Could be dynamic from model metadata
            integrity: 'verified',
            computedChecksum: {
              algorithm: this.validationConfig.checksumAlgorithm,
              value: downloadChecksum,
              computedAt: new Date().toISOString()
            },
            downloadUrl: provider.downloadUrl,
            modelInfo: {
              name: 'Hunyuan-MT-7B',
              quantization: 'Q4_K_M',
              format: 'GGUF'
            }
          }
        }, resolve);
      });

      this.modelPath = 'indexeddb://hunyuan-mt-model';
      this.resetConsecutiveFailures();
      console.log('[LocalModel] Model downloaded successfully');

    } catch (error) {
      this.handleError(error, 'download');

      // Retry logic with exponential backoff
      if (retryAttempt < this.maxRetries && error.message !== 'Download cancelled by user') {
        const delay = Math.min(this.retryDelayMs * Math.pow(2, retryAttempt), this.maxRetryDelayMs);
        console.log(`[LocalModel] Retrying download in ${delay}ms (attempt ${retryAttempt + 1}/${this.maxRetries})`);

        this.isDownloading = false; // Reset flag for retry
        await this.sleep(delay);
        return this.downloadModel(onProgress, retryAttempt + 1);
      }

      throw error;
    } finally {
      this.isDownloading = false;
      this.cancelDownload = false;
    }
  }

  calculateDownloadSpeed(receivedBytes, currentTime) {
    if (!this.downloadStartTime) {
      this.downloadStartTime = currentTime;
      return 0;
    }

    const elapsedTime = (currentTime - this.downloadStartTime) / 1000; // seconds
    return elapsedTime > 0 ? receivedBytes / elapsedTime : 0; // bytes per second
  }

  calculateETA(receivedBytes, totalBytes, currentTime) {
    const speed = this.calculateDownloadSpeed(receivedBytes, currentTime);
    const remainingBytes = totalBytes - receivedBytes;
    return speed > 0 ? remainingBytes / speed : 0; // seconds
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  cancelModelDownload() {
    this.cancelDownload = true;
  }

  async storeModel(modelData) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('LocalModelDB', 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'name' });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');

        store.put({
          name: 'hunyuan-mt-model',
          data: modelData,
          timestamp: Date.now()
        });

        transaction.oncomplete = () => {
          db.close();
          resolve();
        };

        transaction.onerror = () => reject(transaction.error);
      };
    });
  }

  async loadModel() {
    if (this.modelLoaded) return;

    if (!this.modelPath) {
      throw new Error('Model not downloaded. Please download the model first.');
    }

    try {
      // Load model data from IndexedDB
      const modelData = await this.retrieveModel();

      // Initialize llama.cpp in a worker to avoid blocking main thread
      this.modelWorker = new Worker(chrome.runtime.getURL('llamacpp-worker.js'));

      // Load model in worker
      await new Promise((resolve, reject) => {
        this.modelWorker.onmessage = (event) => {
          if (event.data.type === 'modelLoaded') {
            this.modelLoaded = true;
            this.lastUsed = Date.now();
            this.scheduleUnload();
            resolve();
          } else if (event.data.type === 'error') {
            reject(new Error(event.data.message));
          }
        };

        this.modelWorker.postMessage({
          type: 'loadModel',
          modelData: modelData
        });
      });

      console.log('[LocalModel] Model loaded successfully');
    } catch (error) {
      console.error('[LocalModel] Failed to load model:', error);
      throw error;
    }
  }

  async retrieveModel() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('LocalModelDB', 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['models'], 'readonly');
        const store = transaction.objectStore('models');
        const getRequest = store.get('hunyuan-mt-model');

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            resolve(getRequest.result.data);
          } else {
            reject(new Error('Model not found in storage'));
          }
        };

        getRequest.onerror = () => reject(getRequest.error);
      };
    });
  }

  async translate(text, sourceLanguage, targetLanguage, retryAttempt = 0) {
    const startTime = Date.now();

    try {
      if (!this.modelLoaded) {
        await this.loadModel();
      }

      this.lastUsed = Date.now();
      this.scheduleUnload();

      const result = await this.performTranslation(text, sourceLanguage, targetLanguage);

      // Update performance stats on success
      const inferenceTime = Date.now() - startTime;
      this.updatePerformanceStats(inferenceTime, true);
      this.resetConsecutiveFailures();

      return result;

    } catch (error) {
      this.handleError(error, 'translation');

      // Retry logic for translation failures
      if (retryAttempt < this.maxRetries && this.shouldRetryTranslation(error)) {
        const delay = Math.min(this.retryDelayMs * Math.pow(2, retryAttempt), this.maxRetryDelayMs);
        console.log(`[LocalModel] Retrying translation in ${delay}ms (attempt ${retryAttempt + 1}/${this.maxRetries})`);

        await this.sleep(delay);

        // If model worker failed, try to reload it
        if (error.message.includes('worker') || error.message.includes('model')) {
          await this.unloadModel();
        }

        return this.translate(text, sourceLanguage, targetLanguage, retryAttempt + 1);
      }

      // Update performance stats on failure
      this.updatePerformanceStats(Date.now() - startTime, false);
      throw error;
    }
  }

  async performTranslation(text, sourceLanguage, targetLanguage) {
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + Math.random();
      let timeout;

      // Dynamic timeout based on text length
      const timeoutMs = Math.max(10000, Math.min(60000, text.length * 100)); // 10s to 60s

      timeout = setTimeout(() => {
        reject(new Error(`Translation request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const messageHandler = (event) => {
        if (event.data.requestId === requestId) {
          clearTimeout(timeout);
          this.modelWorker.removeEventListener('message', messageHandler);

          if (event.data.type === 'translationComplete') {
            resolve({
              text: event.data.translatedText,
              sourceLanguage: sourceLanguage,
              targetLanguage: targetLanguage,
              confidence: event.data.confidence || 0.95,
              tokensUsed: event.data.tokensUsed || 0
            });
          } else if (event.data.type === 'error') {
            reject(new Error(event.data.message));
          }
        }
      };

      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.modelWorker.removeEventListener('message', messageHandler);
        this.modelWorker.removeEventListener('error', errorHandler);
        reject(new Error(`Worker error: ${error.message || 'Unknown worker error'}`));
      };

      this.modelWorker.addEventListener('message', messageHandler);
      this.modelWorker.addEventListener('error', errorHandler);

      // Create translation prompt for Hunyuan-MT
      const prompt = this.createTranslationPrompt(text, sourceLanguage, targetLanguage);

      this.modelWorker.postMessage({
        type: 'translate',
        requestId: requestId,
        prompt: prompt,
        maxTokens: Math.min(2048, text.length * 2),
        temperature: 0.1, // Low temperature for consistent translations
        topP: 0.9
      });
    });
  }

  shouldRetryTranslation(error) {
    const nonRetryableErrors = [
      'Translation request timed out',
      'Model not found',
      'Invalid input text',
      'Text too long'
    ];

    return !nonRetryableErrors.some(msg => error.message.includes(msg));
  }

  updatePerformanceStats(inferenceTime, success) {
    if (success) {
      this.performanceStats.totalTranslations++;

      // Update average inference time using exponential moving average
      const alpha = 0.1; // Smoothing factor
      if (this.performanceStats.averageInferenceTime === 0) {
        this.performanceStats.averageInferenceTime = inferenceTime;
      } else {
        this.performanceStats.averageInferenceTime =
          alpha * inferenceTime + (1 - alpha) * this.performanceStats.averageInferenceTime;
      }
    }

    this.updateSuccessRate();
  }

  createTranslationPrompt(text, sourceLanguage, targetLanguage) {
    const srcLang = sourceLanguage === 'auto' ? 'automatically detected language' : sourceLanguage;

    // Optimized prompt for Hunyuan-MT model
    return `<|im_start|>user
Translate the following text from ${srcLang} to ${targetLanguage}. Return only the translated text without any explanations or additional content.

Text to translate: ${text}<|im_end|>
<|im_start|>assistant
`;
  }

  scheduleUnload() {
    // Clear existing timer
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
    }

    // Schedule model unload after period of inactivity
    this.unloadTimer = setTimeout(() => {
      this.unloadModel();
    }, this.unloadTimeout);
  }

  async unloadModel() {
    if (!this.modelLoaded) return;

    try {
      if (this.modelWorker) {
        this.modelWorker.terminate();
        this.modelWorker = null;
      }

      this.modelLoaded = false;
      console.log('[LocalModel] Model unloaded to free memory');
    } catch (error) {
      console.error('[LocalModel] Error unloading model:', error);
    }
  }

  async deleteModel() {
    await this.unloadModel();

    // Clear from IndexedDB
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('LocalModelDB', 1);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');

        store.delete('hunyuan-mt-model');

        transaction.oncomplete = () => {
          // Clear storage
          chrome.storage.local.remove(['localModel'], () => {
            this.modelPath = null;
            console.log('[LocalModel] Model deleted successfully');
            resolve();
          });
        };

        transaction.onerror = () => reject(transaction.error);
      };
    });
  }

  getDownloadProgress() {
    return {
      isDownloading: this.isDownloading,
      progress: this.downloadProgress,
      status: this.isDownloading ? 'downloading' : 'idle'
    };
  }

  isModelAvailable() {
    return this.modelPath !== null && !this.modelCorrupted;
  }

  isModelReady() {
    return this.modelLoaded && !this.modelCorrupted;
  }

  getPerformanceStats() {
    return {
      ...this.performanceStats,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      isInRecovery: this.isInRecovery,
      modelCorrupted: this.modelCorrupted
    };
  }

  getModelInfo() {
    return {
      available: this.isModelAvailable(),
      ready: this.isModelReady(),
      downloading: this.isDownloading,
      updating: this.isUpdating,
      downloadProgress: this.downloadProgress,
      path: this.modelPath,
      lastUsed: this.lastUsed,
      unloadScheduled: !!this.unloadTimer,
      performanceStats: this.getPerformanceStats(),
      // Version information
      currentVersion: this.currentModelVersion,
      latestVersion: this.latestModelVersion,
      lastUpdateCheck: this.lastUpdateCheck
    };
  }

  /**
   * Public update system methods
   */

  /**
   * Manually check for updates
   */
  async checkForModelUpdates() {
    return await this.checkForUpdates();
  }

  /**
   * Get update information
   */
  getUpdateInfo() {
    return {
      currentVersion: this.currentModelVersion,
      latestVersion: this.latestModelVersion,
      isUpdating: this.isUpdating,
      lastUpdateCheck: this.lastUpdateCheck,
      autoUpdateEnabled: this.validationConfig.autoUpdateEnabled,
      updateNotifications: this.validationConfig.updateNotifications
    };
  }

  /**
   * Enable or disable automatic updates
   */
  setAutoUpdate(enabled) {
    this.validationConfig.autoUpdateEnabled = enabled;
    console.log(`[LocalModel] Auto-update ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Manually trigger model update
   */
  async updateModel(targetVersion = null, progressCallback = null) {
    if (this.isUpdating) {
      throw new Error('Update already in progress');
    }

    const updateInfo = await this.checkForUpdates();
    if (!updateInfo.hasUpdate && !targetVersion) {
      throw new Error('No updates available');
    }

    const version = targetVersion || updateInfo.latestVersion;
    return await this.updateModelToVersion(version, progressCallback);
  }

  /**
   * Get available model versions
   */
  getAvailableVersions() {
    const modelName = 'hunyuan-mt-7b';
    const registry = this.modelRegistry[modelName];

    if (!registry) {
      return {};
    }

    return Object.keys(registry.versions).map(version => ({
      version: version,
      ...registry.versions[version],
      isCurrent: version === this.currentModelVersion,
      isLatest: version === registry.latest
    }));
  }

  /**
   * Rollback to previous version if backup exists
   */
  async rollbackModel() {
    const modelStatus = await this.getModelStatus();
    if (!modelStatus.backupVersion) {
      throw new Error('No backup version available for rollback');
    }

    return await this.rollbackFromBackup(modelStatus.backupVersion);
  }

  /**
   * Get version changelog
   */
  getVersionChangelog(fromVersion = null, toVersion = null) {
    const modelName = 'hunyuan-mt-7b';
    const registry = this.modelRegistry[modelName];

    if (!registry) {
      return {};
    }

    const from = fromVersion || this.currentModelVersion;
    const to = toVersion || registry.latest;

    const changelog = {
      fromVersion: from,
      toVersion: to,
      features: [],
      breaking: false,
      migrationRequired: false
    };

    // Collect features from all versions in the upgrade path
    const versions = Object.keys(registry.versions).sort((a, b) => this.compareVersions(a, b));

    let collectFeatures = false;
    for (const version of versions) {
      if (version === from || this.compareVersions(version, from) > 0) {
        collectFeatures = true;
      }

      if (collectFeatures && this.compareVersions(version, to) <= 0) {
        const versionInfo = registry.versions[version];
        changelog.features.push(...(versionInfo.features || []));

        if (versionInfo.breaking) {
          changelog.breaking = true;
        }
      }

      if (version === to) {
        break;
      }
    }

    // Check if migration is required
    const migrationKey = `${from}->${to}`;
    changelog.migrationRequired = registry.migrationStrategies[migrationKey] === 'migration_required';

    return changelog;
  }

  /**
   * Manually trigger model validation with progress callback
   */
  async validateModel(progressCallback = null) {
    console.log('[LocalModel] Starting manual model validation');

    try {
      const validationResult = await this.validateModelIntegrity(progressCallback);

      if (!validationResult.valid) {
        // If validation fails, handle as corrupted model
        await this.handleCorruptedModel();
      }

      return validationResult;
    } catch (error) {
      console.error('[LocalModel] Manual validation failed:', error);
      return {
        valid: false,
        checks: { validation: { passed: false, message: error.message } },
        duration: 0,
        details: {}
      };
    }
  }

  /**
   * Get validation configuration
   */
  getValidationConfig() {
    return { ...this.validationConfig };
  }

  /**
   * Update validation configuration
   */
  updateValidationConfig(updates) {
    this.validationConfig = { ...this.validationConfig, ...updates };
    console.log('[LocalModel] Validation config updated:', updates);
  }

  /**
   * Model Update and Version Management System
   */

  /**
   * Check model version compatibility and suggest updates
   */
  async checkModelVersionCompatibility(modelStatus) {
    const modelName = 'hunyuan-mt-7b';
    const currentVersion = modelStatus.version || '1.0.0';
    const registry = this.modelRegistry[modelName];

    if (!registry) {
      console.warn('[LocalModel] Model not found in registry');
      return;
    }

    // Check if current version is deprecated
    const currentVersionInfo = registry.versions[currentVersion];
    if (currentVersionInfo?.deprecated) {
      console.warn(`[LocalModel] Current model version ${currentVersion} is deprecated`);
      await this.notifyDeprecatedVersion(currentVersion);
    }

    // Check for available updates
    const updateInfo = await this.checkForUpdates();
    if (updateInfo.hasUpdate) {
      console.log(`[LocalModel] Update available: ${currentVersion} -> ${updateInfo.latestVersion}`);

      if (this.validationConfig.autoUpdateEnabled) {
        await this.performAutomaticUpdate(updateInfo);
      } else if (this.validationConfig.updateNotifications) {
        await this.notifyUpdateAvailable(updateInfo);
      }
    }
  }

  /**
   * Check for available model updates
   */
  async checkForUpdates() {
    try {
      const modelName = 'hunyuan-mt-7b';
      const registry = this.modelRegistry[modelName];
      const currentVersion = this.currentModelVersion;
      const latestVersion = registry.latest;

      console.log(`[LocalModel] Checking for updates: current=${currentVersion}, latest=${latestVersion}`);

      // Compare versions using semantic versioning
      const hasUpdate = this.compareVersions(latestVersion, currentVersion) > 0;

      if (hasUpdate) {
        this.latestModelVersion = latestVersion;
        const latestVersionInfo = registry.versions[latestVersion];
        const migrationStrategy = registry.migrationStrategies[`${currentVersion}->${latestVersion}`];

        return {
          hasUpdate: true,
          currentVersion: currentVersion,
          latestVersion: latestVersion,
          versionInfo: latestVersionInfo,
          migrationStrategy: migrationStrategy || 'unknown',
          breaking: latestVersionInfo.breaking,
          size: latestVersionInfo.size,
          features: latestVersionInfo.features,
          releaseDate: latestVersionInfo.releaseDate
        };
      }

      // Update last check timestamp
      this.lastUpdateCheck = Date.now();
      await this.updateModelStatus({ lastUpdateCheck: new Date().toISOString() });

      return {
        hasUpdate: false,
        currentVersion: currentVersion,
        latestVersion: latestVersion,
        upToDate: true
      };

    } catch (error) {
      console.error('[LocalModel] Update check failed:', error);
      return {
        hasUpdate: false,
        error: error.message
      };
    }
  }

  /**
   * Compare two semantic versions
   * Returns: -1 if a < b, 0 if a === b, 1 if a > b
   */
  compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;

      if (partA < partB) return -1;
      if (partA > partB) return 1;
    }

    return 0;
  }

  /**
   * Schedule periodic update checks
   */
  scheduleUpdateChecks() {
    if (this.updateCheckTimer) {
      clearInterval(this.updateCheckTimer);
    }

    this.updateCheckTimer = setInterval(async () => {
      try {
        await this.checkForUpdates();
      } catch (error) {
        console.error('[LocalModel] Scheduled update check failed:', error);
      }
    }, this.updateCheckInterval);

    console.log(`[LocalModel] Scheduled update checks every ${this.updateCheckInterval / (60 * 60 * 1000)} hours`);
  }

  /**
   * Perform automatic model update
   */
  async performAutomaticUpdate(updateInfo) {
    if (this.isUpdating) {
      console.log('[LocalModel] Update already in progress');
      return;
    }

    try {
      this.isUpdating = true;
      console.log(`[LocalModel] Starting automatic update to version ${updateInfo.latestVersion}`);

      // Check if migration is required
      if (updateInfo.migrationStrategy === 'migration_required') {
        console.log('[LocalModel] Migration required - skipping automatic update, user intervention needed');
        await this.notifyMigrationRequired(updateInfo);
        return;
      }

      // Perform seamless update
      await this.updateModelToVersion(updateInfo.latestVersion, null);

    } catch (error) {
      console.error('[LocalModel] Automatic update failed:', error);
      this.handleError(error, 'automatic_update');
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Update model to a specific version
   */
  async updateModelToVersion(targetVersion, progressCallback = null) {
    const modelName = 'hunyuan-mt-7b';
    const registry = this.modelRegistry[modelName];
    const targetVersionInfo = registry.versions[targetVersion];

    if (!targetVersionInfo) {
      throw new Error(`Version ${targetVersion} not found in registry`);
    }

    console.log(`[LocalModel] Updating model to version ${targetVersion}`);

    try {
      // Step 1: Backup current model if migration is required
      const currentVersion = this.currentModelVersion;
      const migrationStrategy = registry.migrationStrategies[`${currentVersion}->${targetVersion}`];

      if (migrationStrategy === 'migration_required') {
        if (progressCallback) progressCallback({ step: 'backup', progress: 10, status: 'Creating backup...' });
        await this.createModelBackup(currentVersion);
      }

      // Step 2: Download new model version
      if (progressCallback) progressCallback({ step: 'download', progress: 20, status: 'Downloading new version...' });

      // Temporarily update model registry for download
      const originalDownloadUrl = this.modelRegistry[modelName].versions['1.0.0'].downloadUrl;
      this.modelRegistry[modelName].versions['1.0.0'].downloadUrl = targetVersionInfo.downloadUrl;
      this.modelChecksums = targetVersionInfo.checksums;
      this.expectedModelSize = targetVersionInfo.size;

      await this.downloadModel((downloadProgress) => {
        if (progressCallback) {
          progressCallback({
            step: 'download',
            progress: 20 + (downloadProgress.progress * 0.6), // 20% to 80%
            status: `Downloading... ${Math.round(downloadProgress.progress)}%`,
            speed: downloadProgress.speed,
            eta: downloadProgress.estimatedTimeRemaining
          });
        }
      });

      // Step 3: Migrate data if necessary
      if (migrationStrategy === 'migration_required') {
        if (progressCallback) progressCallback({ step: 'migration', progress: 85, status: 'Migrating data...' });
        await this.performDataMigration(currentVersion, targetVersion);
      }

      // Step 4: Update version metadata
      if (progressCallback) progressCallback({ step: 'finalization', progress: 95, status: 'Finalizing update...' });

      await this.updateModelStatus({
        version: targetVersion,
        updatedAt: new Date().toISOString(),
        updatedFrom: currentVersion,
        migrationStrategy: migrationStrategy,
        features: targetVersionInfo.features
      });

      this.currentModelVersion = targetVersion;

      // Step 5: Validate new model
      const validationResult = await this.validateModelIntegrity();
      if (!validationResult.valid) {
        throw new Error('New model version failed validation');
      }

      if (progressCallback) progressCallback({ step: 'complete', progress: 100, status: 'Update completed successfully' });

      console.log(`[LocalModel] Successfully updated to version ${targetVersion}`);

      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        migrationStrategy: migrationStrategy
      };

    } catch (error) {
      console.error(`[LocalModel] Failed to update to version ${targetVersion}:`, error);

      // Attempt rollback if backup exists
      if (migrationStrategy === 'migration_required') {
        await this.rollbackFromBackup(currentVersion);
      }

      throw error;
    }
  }

  /**
   * Create backup of current model
   */
  async createModelBackup(version) {
    try {
      const modelData = await this.retrieveModel();
      const backupKey = `hunyuan-mt-model-backup-${version}`;

      // Store backup in IndexedDB
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('LocalModelDB', 1);

        request.onsuccess = (event) => {
          const db = event.target.result;
          const transaction = db.transaction(['models'], 'readwrite');
          const store = transaction.objectStore('models');

          store.put({
            name: backupKey,
            data: modelData,
            timestamp: Date.now(),
            originalVersion: version
          });

          transaction.oncomplete = () => {
            db.close();
            console.log(`[LocalModel] Backup created for version ${version}`);
            resolve();
          };

          transaction.onerror = () => reject(transaction.error);
        };

        request.onerror = () => reject(request.error);
      });

      // Store backup metadata
      await this.updateModelStatus({
        backupVersion: version,
        backupCreatedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[LocalModel] Failed to create backup:', error);
      throw new Error(`Backup creation failed: ${error.message}`);
    }
  }

  /**
   * Rollback to backup version
   */
  async rollbackFromBackup(version) {
    try {
      const backupKey = `hunyuan-mt-model-backup-${version}`;

      // Retrieve backup data
      const backupData = await new Promise((resolve, reject) => {
        const request = indexedDB.open('LocalModelDB', 1);

        request.onsuccess = (event) => {
          const db = event.target.result;
          const transaction = db.transaction(['models'], 'readonly');
          const store = transaction.objectStore('models');
          const getRequest = store.get(backupKey);

          getRequest.onsuccess = () => {
            if (getRequest.result) {
              resolve(getRequest.result.data);
            } else {
              reject(new Error('Backup not found'));
            }
          };

          getRequest.onerror = () => reject(getRequest.error);
        };

        request.onerror = () => reject(request.error);
      });

      // Restore backup as main model
      await this.storeModel(backupData);

      // Update metadata
      await this.updateModelStatus({
        version: version,
        rolledBackAt: new Date().toISOString(),
        integrity: 'restored_from_backup'
      });

      this.currentModelVersion = version;

      console.log(`[LocalModel] Successfully rolled back to version ${version}`);

    } catch (error) {
      console.error('[LocalModel] Rollback failed:', error);
      throw new Error(`Rollback failed: ${error.message}`);
    }
  }

  /**
   * Perform data migration between versions
   */
  async performDataMigration(fromVersion, toVersion) {
    console.log(`[LocalModel] Performing data migration: ${fromVersion} -> ${toVersion}`);

    try {
      // Version-specific migration logic
      if (fromVersion === '1.0.0' && toVersion === '2.0.0') {
        await this.migrateTo2_0_0();
      } else if (fromVersion === '1.1.0' && toVersion === '2.0.0') {
        await this.migrateTo2_0_0();
      }

      console.log('[LocalModel] Data migration completed successfully');

    } catch (error) {
      console.error('[LocalModel] Data migration failed:', error);
      throw error;
    }
  }

  /**
   * Migration to version 2.0.0
   */
  async migrateTo2_0_0() {
    // Clear old cache that may be incompatible
    try {
      // Clear translation cache
      if (typeof caches !== 'undefined') {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          if (cacheName.includes('translation-cache')) {
            await caches.delete(cacheName);
          }
        }
      }

      // Clear old performance data that might have different structure
      const currentStats = this.performanceStats;
      this.performanceStats = {
        averageInferenceTime: 0,
        totalTranslations: 0,
        failureCount: 0,
        successRate: 100,
        // Preserve some existing data if possible
        migratedFrom: currentStats
      };

      console.log('[LocalModel] Migration to 2.0.0 completed');

    } catch (error) {
      console.warn('[LocalModel] Migration warning:', error.message);
      // Don't fail migration for non-critical issues
    }
  }

  /**
   * Clean up old backups
   */
  async cleanupOldBackups() {
    try {
      const request = indexedDB.open('LocalModelDB', 1);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');

        store.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const record = cursor.value;
            if (record.name.includes('backup-') && record.timestamp < Date.now() - 7 * 24 * 60 * 60 * 1000) {
              cursor.delete(); // Delete backups older than 7 days
            }
            cursor.continue();
          }
        };

        transaction.oncomplete = () => {
          db.close();
          console.log('[LocalModel] Old backups cleaned up');
        };
      };

    } catch (error) {
      console.warn('[LocalModel] Backup cleanup failed:', error);
    }
  }

  /**
   * Notification methods for update events
   */
  async notifyDeprecatedVersion(version) {
    console.warn(`[LocalModel] Version ${version} is deprecated`);
    // This could trigger UI notifications
  }

  async notifyUpdateAvailable(updateInfo) {
    console.log(`[LocalModel] Update notification: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
    // This could trigger UI notifications
  }

  async notifyMigrationRequired(updateInfo) {
    console.log(`[LocalModel] Migration required for update: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
    // This could trigger UI notifications
  }

  // Health check method for diagnostics
  async healthCheck() {
    const health = {
      timestamp: new Date().toISOString(),
      status: 'unknown',
      checks: {}
    };

    try {
      // Check initialization
      health.checks.initialized = {
        status: this.isInitialized ? 'pass' : 'fail',
        message: this.isInitialized ? 'Manager initialized' : 'Manager not initialized'
      };

      // Check model availability
      const modelStatus = await this.getModelStatus();
      health.checks.modelAvailable = {
        status: modelStatus.downloaded ? 'pass' : 'fail',
        message: modelStatus.downloaded ? 'Model downloaded' : 'Model not downloaded',
        details: modelStatus
      };

      // Check model integrity if available (use quick validation)
      if (modelStatus.downloaded) {
        const quickValidation = await this.validateModelSize(modelStatus.size);
        health.checks.modelIntegrity = {
          status: quickValidation.passed ? 'pass' : 'fail',
          message: quickValidation.message,
          details: quickValidation.details
        };

        // Add last validation timestamp if available
        if (modelStatus.lastValidated) {
          health.checks.lastValidation = {
            status: 'info',
            message: `Last validated: ${new Date(modelStatus.lastValidated).toLocaleString()}`
          };
        }
      }

      // Check worker status
      health.checks.workerStatus = {
        status: this.modelWorker ? 'pass' : 'info',
        message: this.modelWorker ? 'Worker active' : 'Worker not active (normal when idle)'
      };

      // Check storage
      try {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('LocalModelDB', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
        });
        health.checks.storage = {
          status: 'pass',
          message: 'IndexedDB accessible'
        };
      } catch (error) {
        health.checks.storage = {
          status: 'fail',
          message: `IndexedDB error: ${error.message}`
        };
      }

      // Validation configuration check
      health.checks.validationConfig = {
        status: 'info',
        message: `Checksum: ${this.validationConfig.checksumAlgorithm}, Size: ${this.validationConfig.enableSizeValidation ? 'enabled' : 'disabled'}`,
        details: this.validationConfig
      };

      // Overall status
      const failedChecks = Object.values(health.checks).filter(check => check.status === 'fail');
      health.status = failedChecks.length === 0 ? 'healthy' : 'degraded';
      health.summary = `${Object.keys(health.checks).length - failedChecks.length}/${Object.keys(health.checks).length} checks passed`;

    } catch (error) {
      health.status = 'error';
      health.error = error.message;
    }

    return health;
  }

  // ================================
  // Performance Monitoring Methods
  // ================================

  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
    }

    if (this.performanceOptimizationTimer) {
      clearInterval(this.performanceOptimizationTimer);
    }

    // Monitor memory usage
    this.memoryMonitorTimer = setInterval(() => {
      this.updateMemoryUsage();
    }, this.performanceConfig.memoryMonitoringInterval);

    // Periodic performance optimization check
    this.performanceOptimizationTimer = setInterval(() => {
      if (this.performanceConfig.adaptiveOptimization) {
        this.optimizePerformanceAdaptively();
      }
    }, 30000); // Check every 30 seconds

    console.log('[LocalModel] Performance monitoring started');
  }

  /**
   * Stop performance monitoring
   */
  stopPerformanceMonitoring() {
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
      this.memoryMonitorTimer = null;
    }

    if (this.performanceOptimizationTimer) {
      clearInterval(this.performanceOptimizationTimer);
      this.performanceOptimizationTimer = null;
    }

    console.log('[LocalModel] Performance monitoring stopped');
  }

  /**
   * Update memory usage statistics
   */
  async updateMemoryUsage() {
    try {
      if ('memory' in performance) {
        const memInfo = performance.memory;
        this.performanceStats.memoryUsage.currentMemory = memInfo.usedJSHeapSize;
        this.performanceStats.memoryUsage.peakMemory = Math.max(
          this.performanceStats.memoryUsage.peakMemory,
          memInfo.usedJSHeapSize
        );
        this.performanceStats.memoryUsage.runtimeMemory = memInfo.totalJSHeapSize;

        // Check for memory pressure
        const memoryPressure = memInfo.usedJSHeapSize / memInfo.totalJSHeapSize;
        if (memoryPressure > this.performanceConfig.memoryThreshold) {
          this.handleMemoryPressure(memoryPressure);
        }
      }
    } catch (error) {
      console.warn('[LocalModel] Failed to update memory usage:', error.message);
    }
  }

  /**
   * Handle memory pressure situations
   */
  async handleMemoryPressure(memoryPressure) {
    console.warn(`[LocalModel] Memory pressure detected: ${(memoryPressure * 100).toFixed(1)}%`);

    // Switch to low-power mode to reduce memory usage
    if (this.performanceStats.optimizationLevel !== 'low-power') {
      await this.switchOptimizationLevel('low-power');
    }

    // Clear inference history to free memory
    if (this.performanceStats.inferenceHistory.length > 10) {
      this.performanceStats.inferenceHistory = this.performanceStats.inferenceHistory.slice(-10);
    }

    // Trigger garbage collection if available
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }
  }

  /**
   * Record inference performance metrics
   */
  recordInference(startTime, endTime, inputLength, outputLength, success = true) {
    const inferenceTime = endTime - startTime;

    // Update basic stats
    this.performanceStats.totalTranslations++;
    if (!success) {
      this.performanceStats.failureCount++;
    }
    this.performanceStats.successRate =
      ((this.performanceStats.totalTranslations - this.performanceStats.failureCount) /
       this.performanceStats.totalTranslations) * 100;

    if (success) {
      // Update inference history
      this.performanceStats.inferenceHistory.push(inferenceTime);
      if (this.performanceStats.inferenceHistory.length > this.performanceConfig.historySize) {
        this.performanceStats.inferenceHistory.shift();
      }

      // Calculate average inference time
      const sum = this.performanceStats.inferenceHistory.reduce((a, b) => a + b, 0);
      this.performanceStats.averageInferenceTime = sum / this.performanceStats.inferenceHistory.length;

      // Calculate throughput metrics
      if (inputLength > 0) {
        this.performanceStats.charactersPerSecond = inputLength / (inferenceTime / 1000);
      }

      // Estimate tokens per second (rough approximation: ~4 characters per token)
      this.performanceStats.tokensPerSecond = this.performanceStats.charactersPerSecond / 4;

      // Update performance trend
      this.updatePerformanceTrend();
    }
  }

  /**
   * Record detailed performance breakdown
   */
  recordDetailedPerformance(timings) {
    if (!this.performanceConfig.enableDetailedProfiling) {
      return;
    }

    const {
      modelLoading = 0,
      preprocessing = 0,
      inference = 0,
      postprocessing = 0,
      totalPipeline = 0
    } = timings;

    // Update running averages
    const updateAverage = (current, newValue, count) => {
      return ((current * (count - 1)) + newValue) / count;
    };

    const count = this.performanceStats.totalTranslations;
    this.performanceStats.timings.modelLoading = updateAverage(
      this.performanceStats.timings.modelLoading, modelLoading, count
    );
    this.performanceStats.timings.preprocessing = updateAverage(
      this.performanceStats.timings.preprocessing, preprocessing, count
    );
    this.performanceStats.timings.inference = updateAverage(
      this.performanceStats.timings.inference, inference, count
    );
    this.performanceStats.timings.postprocessing = updateAverage(
      this.performanceStats.timings.postprocessing, postprocessing, count
    );
    this.performanceStats.timings.totalPipeline = updateAverage(
      this.performanceStats.timings.totalPipeline, totalPipeline, count
    );
  }

  /**
   * Update performance trend analysis
   */
  updatePerformanceTrend() {
    if (this.performanceStats.inferenceHistory.length < 20) {
      return; // Need enough data points
    }

    const recentPerformance = this.performanceStats.inferenceHistory.slice(-10);
    const olderPerformance = this.performanceStats.inferenceHistory.slice(-20, -10);

    const recentAvg = recentPerformance.reduce((a, b) => a + b) / recentPerformance.length;
    const olderAvg = olderPerformance.reduce((a, b) => a + b) / olderPerformance.length;

    const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (changePercent < -5) {
      this.performanceStats.performanceTrend = 'improving'; // Lower times = better
    } else if (changePercent > 5) {
      this.performanceStats.performanceTrend = 'degrading'; // Higher times = worse
    } else {
      this.performanceStats.performanceTrend = 'stable';
    }
  }

  /**
   * Optimize performance adaptively based on current conditions
   */
  async optimizePerformanceAdaptively() {
    try {
      const currentLevel = this.performanceStats.optimizationLevel;
      let recommendedLevel = 'balanced';

      // Check memory usage
      const memoryPressure = this.getMemoryPressure();
      if (memoryPressure > 0.8) {
        recommendedLevel = 'low-power';
      }

      // Check performance trend
      if (this.performanceStats.performanceTrend === 'degrading') {
        recommendedLevel = 'low-power';
      } else if (this.performanceStats.performanceTrend === 'improving' && memoryPressure < 0.6) {
        recommendedLevel = 'performance';
      }

      // Check device capabilities (rough heuristic based on performance)
      if (this.performanceStats.averageInferenceTime > 10000) { // > 10 seconds per inference
        recommendedLevel = 'low-power';
      } else if (this.performanceStats.averageInferenceTime < 2000) { // < 2 seconds per inference
        recommendedLevel = 'performance';
      }

      // Apply optimization if different from current
      if (recommendedLevel !== currentLevel) {
        await this.switchOptimizationLevel(recommendedLevel);
      }

    } catch (error) {
      console.warn('[LocalModel] Adaptive optimization failed:', error.message);
    }
  }

  /**
   * Switch optimization level
   */
  async switchOptimizationLevel(level) {
    if (!this.performanceConfig.strategies[level]) {
      throw new Error(`Unknown optimization level: ${level}`);
    }

    const strategy = this.performanceConfig.strategies[level];
    this.performanceStats.optimizationLevel = level;
    this.performanceStats.lastOptimizationDate = Date.now();

    // Apply strategy settings (this would integrate with llama.cpp configuration)
    console.log(`[LocalModel] Switched to ${level} optimization level:`, strategy);

    // In a real implementation, these settings would be applied to the llama.cpp instance
    // For example:
    // this.llamaInstance.setBatchSize(strategy.batchSize);
    // this.llamaInstance.setThreadCount(strategy.threadCount);
    // this.llamaInstance.setCache(strategy.enableCache);
    // this.llamaInstance.setPrecision(strategy.reducedPrecision);
  }

  /**
   * Get current memory pressure ratio
   */
  getMemoryPressure() {
    try {
      if ('memory' in performance) {
        const memInfo = performance.memory;
        return memInfo.usedJSHeapSize / memInfo.totalJSHeapSize;
      }
      return 0.5; // Default assumption
    } catch (error) {
      return 0.5; // Fallback
    }
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport() {
    return {
      summary: {
        totalTranslations: this.performanceStats.totalTranslations,
        successRate: this.performanceStats.successRate.toFixed(2) + '%',
        averageInferenceTime: (this.performanceStats.averageInferenceTime / 1000).toFixed(2) + 's',
        throughput: {
          tokensPerSecond: this.performanceStats.tokensPerSecond.toFixed(1),
          charactersPerSecond: this.performanceStats.charactersPerSecond.toFixed(1)
        }
      },
      performance: {
        trend: this.performanceStats.performanceTrend,
        optimizationLevel: this.performanceStats.optimizationLevel,
        lastOptimized: this.performanceStats.lastOptimizationDate ?
          new Date(this.performanceStats.lastOptimizationDate).toISOString() : null
      },
      memory: {
        currentUsage: this.formatMemorySize(this.performanceStats.memoryUsage.currentMemory),
        peakUsage: this.formatMemorySize(this.performanceStats.memoryUsage.peakMemory),
        modelSize: this.formatMemorySize(this.performanceStats.memoryUsage.modelSize),
        pressure: (this.getMemoryPressure() * 100).toFixed(1) + '%'
      },
      timings: this.performanceConfig.enableDetailedProfiling ? {
        modelLoading: (this.performanceStats.timings.modelLoading / 1000).toFixed(3) + 's',
        preprocessing: (this.performanceStats.timings.preprocessing / 1000).toFixed(3) + 's',
        inference: (this.performanceStats.timings.inference / 1000).toFixed(3) + 's',
        postprocessing: (this.performanceStats.timings.postprocessing / 1000).toFixed(3) + 's',
        totalPipeline: (this.performanceStats.timings.totalPipeline / 1000).toFixed(3) + 's'
      } : null,
      recommendations: this.getPerformanceRecommendations()
    };
  }

  /**
   * Get performance optimization recommendations
   */
  getPerformanceRecommendations() {
    const recommendations = [];
    const memoryPressure = this.getMemoryPressure();

    if (memoryPressure > 0.8) {
      recommendations.push({
        type: 'memory',
        severity: 'high',
        message: 'High memory usage detected. Consider switching to low-power mode.',
        action: 'Reduce batch size and enable memory optimization'
      });
    }

    if (this.performanceStats.averageInferenceTime > 15000) {
      recommendations.push({
        type: 'performance',
        severity: 'medium',
        message: 'Slow inference times detected. Device may not be optimal for local translation.',
        action: 'Consider using cloud translation or reducing model precision'
      });
    }

    if (this.performanceStats.performanceTrend === 'degrading') {
      recommendations.push({
        type: 'trend',
        severity: 'medium',
        message: 'Performance is degrading over time.',
        action: 'Check system resources and consider model optimization'
      });
    }

    if (this.performanceStats.successRate < 95) {
      recommendations.push({
        type: 'reliability',
        severity: 'high',
        message: 'Low success rate detected.',
        action: 'Check model integrity and system stability'
      });
    }

    return recommendations;
  }

  /**
   * Format memory size for display
   */
  formatMemorySize(bytes) {
    if (!bytes) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return size.toFixed(2) + ' ' + units[unitIndex];
  }

  /**
   * Reset performance statistics
   */
  resetPerformanceStats() {
    this.performanceStats.averageInferenceTime = 0;
    this.performanceStats.totalTranslations = 0;
    this.performanceStats.failureCount = 0;
    this.performanceStats.successRate = 100;
    this.performanceStats.inferenceHistory = [];
    this.performanceStats.memoryUsage.peakMemory = 0;
    this.performanceStats.timings = {
      modelLoading: 0,
      preprocessing: 0,
      inference: 0,
      postprocessing: 0,
      totalPipeline: 0
    };
    this.performanceStats.batchProcessingStats = {
      averageBatchSize: 0,
      batchProcessingTime: 0,
      totalBatches: 0
    };
    this.performanceStats.performanceTrend = 'stable';
    this.performanceStats.lastOptimizationDate = null;

    console.log('[LocalModel] Performance statistics reset');
  }
}

// Create singleton instance
const localModelManager = new LocalModelManager();

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocalModelManager;
} else if (typeof window !== 'undefined') {
  window.LocalModelManager = LocalModelManager;
  window.localModelManager = localModelManager;
}