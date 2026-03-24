/**
 * Legacy experimental local-model manager surface backed by wllama (WebGPU/WASM).
 *
 * The shipped extension currently routes local translation through
 * `src/offscreen/offscreen.ts` (OPUS-MT) and `src/offscreen/translategemma.ts`.
 * This file remains for older/manual surfaces and focused unit tests while using
 * the wllama-based LocalModelManager underneath. The modular architecture is preserved:
 * - ModelValidator: Handles model validation and integrity checks
 * - ModelUpdater: Manages version updates and migrations
 * - ModelPerformanceMonitor: Tracks performance metrics and optimization
 *
 * Backend: @wllama/wllama (replaces the old mock llama.cpp WASM)
 * Key fix: Chunked/sharded model loading (no single large ArrayBuffer)
 */

import {
  LocalModelManager as WllamaModelManager,
  type ModelStatus,
  type HealthCheckResult,
  type PerformanceSummary,
  type ModelInfo,
} from './lib/LocalModelManager.js';
import type { ValidationResult } from './lib/ModelValidator.js';
import { logger } from './lib/logger';

// Re-export core types for consumers
export type {
  ModelStatus,
  HealthCheckResult,
  PerformanceSummary,
  TranslationResult,
  ModelInfo,
  DownloadProgressInfo,
  ModelConfig,
} from './lib/LocalModelManager.js';

// Augment global scope for backward compatibility
declare global {
  interface Window {
    LocalModelManager: typeof LocalModelManager;
    getModelManager: typeof getModelManager;
  }
}

class LocalModelManager extends WllamaModelManager {
  constructor() {
    super();
    logger.info('LocalModelManager', 'Using wllama backend (WebGPU/WASM)');
  }

  // Legacy method names for backward compatibility
  getModelInfo(): ModelInfo {
    return super.getModelInfo();
  }

  async checkHealth(): Promise<HealthCheckResult> {
    return this.performHealthCheck();
  }

  async isModelReady(): Promise<boolean> {
    const status: ModelStatus = await this.getModelStatus();
    return status.downloaded && !status.error;
  }

  async getModelSize(): Promise<number> {
    const status: ModelStatus = await this.getModelStatus();
    return status.size || 0;
  }

  getPerformanceStats(): PerformanceSummary {
    return this.getPerformanceSummary();
  }

  async checkForUpdates(): Promise<{ hasUpdate: boolean; version?: string; url?: string }> {
    return this.updater.checkForUpdates();
  }

  async hasUpdate(): Promise<boolean> {
    const updateInfo = await this.checkForUpdates();
    return updateInfo.hasUpdate;
  }

  async validateModel(): Promise<ValidationResult | { valid: false; message: string }> {
    const status: ModelStatus = await this.getModelStatus();
    if (!status.downloaded) {
      return { valid: false, message: 'Model not downloaded' };
    }
    return this.validator.validateModelIntegrity(status, this.retrieveModel);
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

// Singleton instance
let globalModelManager: LocalModelManager | null = null;

function getModelManager(): LocalModelManager {
  if (!globalModelManager) {
    globalModelManager = new LocalModelManager();
  }
  return globalModelManager;
}

// Global access patterns
if (typeof window !== 'undefined') {
  window.LocalModelManager = LocalModelManager;
  window.getModelManager = getModelManager;
/* v8 ignore start */
} else if (typeof self !== 'undefined') {
  (self as unknown as Window).LocalModelManager = LocalModelManager;
  (self as unknown as Window).getModelManager = getModelManager;
}
/* v8 ignore stop */

export { LocalModelManager, getModelManager };
