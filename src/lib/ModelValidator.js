/**
 * Model Validation and Integrity System
 * Handles model validation, checksum verification, and structure validation
 */

import { logger } from './logger.js';

export class ModelValidator {
  constructor(modelRegistry, validationConfig) {
    this.modelRegistry = modelRegistry;
    this.validationConfig = validationConfig || {
      enableSizeValidation: true,
      enableChecksumValidation: true,
      enableStructuralValidation: true,
      sizeTolerance: 0.01, // 1% tolerance for file size
      checksumAlgorithm: 'sha256'
    };

    // Get model checksums from registry
    this.modelChecksums = this.modelRegistry['hunyuan-mt-7b']?.versions?.['1.0.0']?.checksums || {};
  }

  /**
   * Comprehensive model integrity validation
   */
  async validateModelIntegrity(modelStatus, retrieveModelFn, progressCallback = null) {
    const validationStart = Date.now();
    const result = {
      valid: false,
      checks: {},
      duration: 0,
      details: {}
    };

    try {
      logger.info('ModelValidator', 'Starting comprehensive integrity validation');

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
          logger.debug('ModelValidator', 'Retrieving model data for validation...');
          modelData = await retrieveModelFn();
          result.checks.dataRetrieval = { passed: true, message: 'Model data retrieved successfully' };

          if (progressCallback) progressCallback({ step: 'data-retrieval', progress: 40 });
        } catch (error) {
          result.checks.dataRetrieval = { passed: false, message: `Failed to retrieve model data: ${error.message}` };
          logger.error('ModelValidator', 'Failed to retrieve model data for validation:', error);
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
        logger.info('ModelValidator', `Model integrity validation passed (${result.duration}ms)`);
      } else {
        logger.warn('ModelValidator', `Model integrity validation failed: ${failedChecks.map(c => c.message).join(', ')}`);
      }

      if (progressCallback) progressCallback({ step: 'complete', progress: 100, result });

      return result;

    } catch (error) {
      logger.error('ModelValidator', 'Integrity validation error:', error);
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
    if (!expectedSize) {
      return {
        passed: false,
        message: 'No expected size available for validation'
      };
    }

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
      logger.debug('ModelValidator', `Computing ${algorithm.toUpperCase()} checksum...`);
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
        // For large files, we need a streaming approach
        throw new Error('Large file checksum computation requires streaming implementation');
      }
    } catch (error) {
      throw new Error(`Failed to compute ${algorithm} checksum: ${error.message}`);
    }
  }

  /**
   * Compute MD5 checksum using custom implementation (placeholder)
   */
  async computeMD5Checksum(data, progressCallback = null) {
    // Simple MD5 implementation placeholder
    // In production, you'd want to use a proper MD5 library like crypto-js
    throw new Error('MD5 checksum computation not implemented - use crypto-js library');
  }

  /**
   * Validate model structure (GGUF format validation)
   */
  async validateModelStructure(modelData) {
    try {
      if (!modelData || modelData.byteLength < 12) {
        return {
          passed: false,
          message: 'Model data too small or missing'
        };
      }

      // GGUF file format validation
      // GGUF files start with magic bytes: 0x47475546 ("GGUF")
      const magic = new Uint32Array(modelData.slice(0, 4));
      const expectedMagic = 0x46554747; // "GGUF" in little-endian

      if (magic[0] !== expectedMagic) {
        return {
          passed: false,
          message: `Invalid GGUF magic bytes: expected ${expectedMagic.toString(16)}, got ${magic[0].toString(16)}`
        };
      }

      // Check GGUF version (at offset 4)
      const version = new Uint32Array(modelData.slice(4, 8))[0];
      if (version < 1 || version > 3) {
        return {
          passed: false,
          message: `Unsupported GGUF version: ${version}`
        };
      }

      return {
        passed: true,
        message: `Valid GGUF structure (version ${version})`,
        details: { version }
      };

    } catch (error) {
      return {
        passed: false,
        message: `Structure validation error: ${error.message}`
      };
    }
  }

  /**
   * Validate model metadata
   */
  async validateModelMetadata(modelStatus) {
    try {
      // Check required metadata fields
      const requiredFields = ['id', 'version', 'downloadDate', 'size'];
      const missingFields = requiredFields.filter(field => !modelStatus[field]);

      if (missingFields.length > 0) {
        return {
          passed: false,
          message: `Missing required metadata fields: ${missingFields.join(', ')}`
        };
      }

      // Check timestamp validity
      const downloadDate = new Date(modelStatus.downloadDate);
      if (isNaN(downloadDate.getTime())) {
        return {
          passed: false,
          message: 'Invalid download date timestamp'
        };
      }

      // Check if download date is reasonable (not in future, not too old)
      const now = new Date();
      if (downloadDate > now) {
        return {
          passed: false,
          message: 'Download date cannot be in the future'
        };
      }

      return {
        passed: true,
        message: 'Metadata validation passed',
        details: {
          fields: requiredFields,
          downloadDate: downloadDate.toISOString()
        }
      };

    } catch (error) {
      return {
        passed: false,
        message: `Metadata validation error: ${error.message}`
      };
    }
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

  /**
   * Update validation configuration
   */
  updateConfig(newConfig) {
    this.validationConfig = { ...this.validationConfig, ...newConfig };
    logger.debug('ModelValidator', 'Configuration updated:', this.validationConfig);
  }

  /**
   * Get validation status
   */
  getValidationConfig() {
    return { ...this.validationConfig };
  }
}