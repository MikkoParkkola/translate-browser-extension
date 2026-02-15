/**
 * Local Model Manager singleton for translation using wllama (WebGPU/WASM).
 *
 * This file maintains backward compatibility while using the new wllama-based
 * LocalModelManager. The modular architecture is preserved:
 * - ModelValidator: Handles model validation and integrity checks
 * - ModelUpdater: Manages version updates and migrations
 * - ModelPerformanceMonitor: Tracks performance metrics and optimization
 *
 * Backend: @wllama/wllama (replaces mock llama.cpp WASM)
 * Key fix: Chunked/sharded model loading (no single large ArrayBuffer)
 */

import { LocalModelManager as WllamaModelManager } from './lib/LocalModelManager.js';
import { logger } from './lib/logger.js';

class LocalModelManager extends WllamaModelManager {
  constructor() {
    super();
    logger.info('LocalModelManager', 'Using wllama backend (WebGPU/WASM)');
  }

  // Legacy method names for backward compatibility
  async getModelInfo() {
    return super.getModelInfo();
  }

  async checkHealth() {
    return this.performHealthCheck();
  }

  async isModelReady() {
    const status = await this.getModelStatus();
    return status.downloaded && !status.error;
  }

  async getModelSize() {
    const status = await this.getModelStatus();
    return status.size || 0;
  }

  getPerformanceStats() {
    return this.getPerformanceSummary();
  }

  async checkForUpdates() {
    return this.updater.checkForUpdates();
  }

  async hasUpdate() {
    const updateInfo = await this.checkForUpdates();
    return updateInfo.hasUpdate;
  }

  async validateModel() {
    const status = await this.getModelStatus();
    if (!status.downloaded) {
      return { valid: false, message: 'Model not downloaded' };
    }
    return this.validator.validateModelIntegrity(status, this.retrieveModel);
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))  } ${  sizes[i]}`;
  }
}

// Singleton instance
let globalModelManager = null;

function getModelManager() {
  if (!globalModelManager) {
    globalModelManager = new LocalModelManager();
  }
  return globalModelManager;
}

// Global access patterns
if (typeof window !== 'undefined') {
  window.LocalModelManager = LocalModelManager;
  window.getModelManager = getModelManager;
} else if (typeof self !== 'undefined') {
  self.LocalModelManager = LocalModelManager;
  self.getModelManager = getModelManager;
}

export { LocalModelManager, getModelManager };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LocalModelManager, getModelManager };
}
