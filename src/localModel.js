/**
 * Local Model Manager for Hunyuan-MT-7B using llama.cpp
 * Now uses modular architecture with focused modules for better maintainability
 *
 * This file maintains backward compatibility while using the new modular design:
 * - ModelValidator: Handles model validation and integrity checks
 * - ModelUpdater: Manages version updates and migrations
 * - ModelPerformanceMonitor: Tracks performance metrics and optimization
 */

import { LocalModelManager as ModularLocalModelManager } from './lib/LocalModelManager.js';
import { logger } from './lib/logger.js';

// Re-export the modular implementation
class LocalModelManager extends ModularLocalModelManager {
  constructor() {
    super();
    logger.info('LocalModelManager', 'Using new modular architecture');
  }

  // Add any legacy methods or compatibility layers here if needed
  // The ModularLocalModelManager handles all the core functionality

  // Legacy method names for backward compatibility (if any were different)
  async getModelInfo() {
    return this.getModelStatus();
  }

  async checkHealth() {
    return this.performHealthCheck();
  }

  // Additional convenience methods
  async isModelReady() {
    const status = await this.getModelStatus();
    return status.downloaded && !status.error;
  }

  async getModelSize() {
    const status = await this.getModelStatus();
    return status.size || 0;
  }

  // Performance shortcuts
  getPerformanceStats() {
    return this.getPerformanceSummary();
  }

  // Update shortcuts
  async checkForUpdates() {
    return this.updater.checkForUpdates();
  }

  async hasUpdate() {
    const updateInfo = await this.checkForUpdates();
    return updateInfo.hasUpdate;
  }

  // Validation shortcuts
  async validateModel() {
    const status = await this.getModelStatus();
    if (!status.downloaded) {
      return { valid: false, message: 'Model not downloaded' };
    }

    return this.validator.validateModelIntegrity(status, this.retrieveModel);
  }

  // Format utilities (if needed for compatibility)
  formatBytes(bytes) {
    return this.validator.formatBytes(bytes);
  }
}

// Create singleton instance for global access
let globalModelManager = null;

// Factory function to get/create the singleton instance
function getModelManager() {
  if (!globalModelManager) {
    globalModelManager = new LocalModelManager();
  }
  return globalModelManager;
}

// Legacy global access patterns (if they were used)
if (typeof window !== 'undefined') {
  window.LocalModelManager = LocalModelManager;
  window.getModelManager = getModelManager;
} else if (typeof self !== 'undefined') {
  // Service worker context
  self.LocalModelManager = LocalModelManager;
  self.getModelManager = getModelManager;
}

// Export for ES modules
export { LocalModelManager, getModelManager };

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LocalModelManager, getModelManager };
}