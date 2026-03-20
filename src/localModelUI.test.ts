/**
 * LocalModelUI unit tests
 *
 * Tests the DOM-based UI class for local model management:
 * initialization, status rendering, download progress, validation,
 * health check, performance monitoring, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import after DOM setup
let LocalModelUI: typeof import('./localModelUI').LocalModelUI;

// Mock model manager
function createMockModelManager(overrides: Record<string, unknown> = {}) {
  return {
    getModelInfo: vi.fn().mockReturnValue({
      available: false,
      ready: false,
      downloading: false,
      backend: 'wllama',
      performanceStats: undefined,
    }),
    downloadModel: vi.fn().mockResolvedValue(undefined),
    getDownloadProgress: vi.fn().mockReturnValue({ isDownloading: false, progress: 0 }),
    validateModel: vi.fn().mockResolvedValue({
      valid: true,
      duration: 500,
      checks: { size: { passed: true, message: 'OK' } },
    }),
    deleteModel: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockResolvedValue({ text: 'Hola', inferenceTime: 150 }),
    healthCheck: vi.fn().mockResolvedValue({
      status: 'healthy',
      timestamp: Date.now(),
      summary: 'All checks passed',
      checks: { model: { passed: true, status: 'ok', message: 'Loaded' } },
    }),
    cancelModelDownload: vi.fn(),
    resetPerformanceStats: vi.fn().mockResolvedValue(undefined),
    stopPerformanceMonitoring: vi.fn().mockResolvedValue(undefined),
    startPerformanceMonitoring: vi.fn().mockResolvedValue(undefined),
    switchOptimizationLevel: vi.fn().mockResolvedValue(undefined),
    getPerformanceReport: vi.fn().mockResolvedValue({
      summary: {
        totalTranslations: 42,
        successRate: '98%',
        averageInferenceTime: '150ms',
        throughput: { tokensPerSecond: 25 },
      },
      performance: { trend: 'stable', optimizationLevel: 'balanced', lastOptimized: null },
      memory: { currentUsage: '512 MB', peakUsage: '768 MB', pressure: '45%' },
      recommendations: [],
    }),
    performanceStats: { inferenceHistory: [100, 120, 110, 130, 115] },
    ...overrides,
  };
}

describe('LocalModelUI', () => {
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="local-model-container"></div>';

    // Set up global window.localModelManager before importing
    (window as Record<string, unknown>).localModelManager = createMockModelManager();

    const mod = await import('./localModelUI');
    LocalModelUI = mod.LocalModelUI;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as Record<string, unknown>).localModelManager;
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('creates UI when container exists', () => {
      const ui = new LocalModelUI('local-model-container');
      expect(document.querySelector('.local-model-panel')).not.toBeNull();
      ui.destroy();
    });

    it('logs error when container not found', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Don't call destroy() — UI was never initialized (container missing),
      // and destroy() would NPE on DOM elements that don't exist.
      new LocalModelUI('nonexistent-container');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Container element not found'));
    });

    it('creates expected buttons', () => {
      const ui = new LocalModelUI('local-model-container');
      expect(document.getElementById('download-model')).not.toBeNull();
      expect(document.getElementById('validate-model')).not.toBeNull();
      expect(document.getElementById('delete-model')).not.toBeNull();
      expect(document.getElementById('test-model')).not.toBeNull();
      expect(document.getElementById('view-health')).not.toBeNull();
      ui.destroy();
    });

    it('creates status indicators', () => {
      const ui = new LocalModelUI('local-model-container');
      expect(document.getElementById('local-model-status-indicator')).not.toBeNull();
      expect(document.getElementById('local-model-status-text')).not.toBeNull();
      ui.destroy();
    });
  });

  describe('updateStatus', () => {
    it('renders unavailable status when model not downloaded', async () => {
      const ui = new LocalModelUI('local-model-container');
      await ui.updateStatus();

      const statusIndicator = document.getElementById('local-model-status-indicator');
      expect(statusIndicator!.className).toContain('unavailable');
      const statusText = document.getElementById('local-model-status-text');
      expect(statusText!.textContent).toBe('Not Downloaded');
      ui.destroy();
    });

    it('renders ready status when model is ready', async () => {
      (window as Record<string, unknown>).localModelManager = createMockModelManager({
        getModelInfo: vi.fn().mockReturnValue({
          available: true,
          ready: true,
          downloading: false,
          backend: 'wllama',
          performanceStats: { totalTranslations: 10, successRate: 100, averageInferenceTime: 200 },
        }),
      });

      const ui = new LocalModelUI('local-model-container');
      await ui.updateStatus();

      const statusIndicator = document.getElementById('local-model-status-indicator');
      expect(statusIndicator!.className).toContain('ready');
      const statusText = document.getElementById('local-model-status-text');
      expect(statusText!.textContent).toContain('Ready');
      ui.destroy();
    });

    it('renders available status when model downloaded but not loaded', async () => {
      (window as Record<string, unknown>).localModelManager = createMockModelManager({
        getModelInfo: vi.fn().mockReturnValue({
          available: true,
          ready: false,
          downloading: false,
          backend: 'wllama',
          performanceStats: { totalTranslations: 5, successRate: 80, averageInferenceTime: 300 },
        }),
      });

      const ui = new LocalModelUI('local-model-container');
      await ui.updateStatus();

      const statusIndicator = document.getElementById('local-model-status-indicator');
      expect(statusIndicator!.className).toContain('available');
      ui.destroy();
    });

    it('renders downloading status when model is downloading', async () => {
      (window as Record<string, unknown>).localModelManager = createMockModelManager({
        getModelInfo: vi.fn().mockReturnValue({
          available: false,
          ready: false,
          downloading: true,
          backend: 'wllama',
        }),
      });

      const ui = new LocalModelUI('local-model-container');
      await ui.updateStatus();

      const statusIndicator = document.getElementById('local-model-status-indicator');
      expect(statusIndicator!.className).toContain('downloading');
      ui.destroy();
    });

    it('shows error from performanceStats.lastError', async () => {
      (window as Record<string, unknown>).localModelManager = createMockModelManager({
        getModelInfo: vi.fn().mockReturnValue({
          available: true,
          ready: false,
          downloading: false,
          performanceStats: { totalTranslations: 0, successRate: 0, averageInferenceTime: 0, lastError: { message: 'OOM' } },
        }),
      });

      const ui = new LocalModelUI('local-model-container');
      await ui.updateStatus();

      const errorPanel = document.getElementById('local-model-error');
      expect(errorPanel!.style.display).toBe('block');
      ui.destroy();
    });

    it('handles status update error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (window as Record<string, unknown>).localModelManager = createMockModelManager({
        getModelInfo: vi.fn().mockImplementation(() => { throw new Error('Network error'); }),
      });

      const ui = new LocalModelUI('local-model-container');
      await ui.updateStatus();

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Status update failed'), expect.any(Error));
      ui.destroy();
    });

    it('skips when localModelManager is not set', async () => {
      delete (window as Record<string, unknown>).localModelManager;
      const ui = new LocalModelUI('local-model-container');
      // Should not throw
      await ui.updateStatus();
      ui.destroy();
    });
  });

  describe('download flow', () => {
    it('calls downloadModel on button click', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const downloadBtn = document.getElementById('download-model') as HTMLButtonElement;
      downloadBtn.click();

      await vi.waitFor(() => {
        expect(mockManager.downloadModel).toHaveBeenCalled();
      });
      ui.destroy();
    });

    it('shows and hides progress panel', () => {
      const ui = new LocalModelUI('local-model-container');
      const progressPanel = document.getElementById('local-model-progress');

      // Initially hidden
      expect(progressPanel!.style.display).toBe('none');
      ui.destroy();
    });

    it('cancels download on cancel button click', () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const cancelBtn = document.getElementById('cancel-download') as HTMLButtonElement;
      cancelBtn.click();

      expect(mockManager.cancelModelDownload).toHaveBeenCalled();
      ui.destroy();
    });
  });

  describe('validation', () => {
    it('calls validateModel on button click', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const validateBtn = document.getElementById('validate-model') as HTMLButtonElement;
      validateBtn.click();

      await vi.waitFor(() => {
        expect(mockManager.validateModel).toHaveBeenCalled();
      });
      ui.destroy();
    });

    it('handles validation failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockManager = createMockModelManager({
        validateModel: vi.fn().mockRejectedValue(new Error('Corrupt model')),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const validateBtn = document.getElementById('validate-model') as HTMLButtonElement;
      validateBtn.click();

      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('Validation failed'), expect.any(Error));
      });
      ui.destroy();
    });
  });

  describe('test translation', () => {
    it('calls translate on test button click', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const testBtn = document.getElementById('test-model') as HTMLButtonElement;
      testBtn.click();

      await vi.waitFor(() => {
        expect(mockManager.translate).toHaveBeenCalledWith(
          'Hello, this is a test translation.',
          'en',
          'es',
        );
      });
      ui.destroy();
    });

    it('handles translation test failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockManager = createMockModelManager({
        translate: vi.fn().mockRejectedValue(new Error('Inference error')),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const testBtn = document.getElementById('test-model') as HTMLButtonElement;
      testBtn.click();

      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('Test failed'), expect.any(Error));
      });
      ui.destroy();
    });
  });

  describe('health check', () => {
    it('calls healthCheck on button click and renders results', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const healthBtn = document.getElementById('view-health') as HTMLButtonElement;
      healthBtn.click();

      await vi.waitFor(() => {
        expect(mockManager.healthCheck).toHaveBeenCalled();
        const healthPanel = document.getElementById('local-model-health');
        expect(healthPanel!.style.display).toBe('block');
      });
      ui.destroy();
    });

    it('shows error status in health panel', async () => {
      const mockManager = createMockModelManager({
        healthCheck: vi.fn().mockResolvedValue({
          status: 'degraded',
          timestamp: Date.now(),
          summary: 'Issues found',
          checks: { model: { passed: false, status: 'fail', message: 'Not loaded' } },
          error: 'Model file missing',
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const healthBtn = document.getElementById('view-health') as HTMLButtonElement;
      healthBtn.click();

      await vi.waitFor(() => {
        const healthResults = document.getElementById('health-results');
        expect(healthResults!.innerHTML).toContain('degraded');
        expect(healthResults!.innerHTML).toContain('Model file missing');
      });
      ui.destroy();
    });

    it('handles health check error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockManager = createMockModelManager({
        healthCheck: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const healthBtn = document.getElementById('view-health') as HTMLButtonElement;
      healthBtn.click();

      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('Health check failed'), expect.any(Error));
      });
      ui.destroy();
    });
  });

  describe('delete model', () => {
    it('shows confirmation dialog on delete click', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const deleteBtn = document.getElementById('delete-model') as HTMLButtonElement;
      deleteBtn.click();

      // Confirmation overlay should appear
      await vi.waitFor(() => {
        const overlay = document.querySelector('.local-model-confirm-overlay');
        expect(overlay).not.toBeNull();
      });
      ui.destroy();
    });

    it('calls deleteModel when confirmed', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const deleteBtn = document.getElementById('delete-model') as HTMLButtonElement;
      deleteBtn.click();

      await vi.waitFor(() => {
        const overlay = document.querySelector('.local-model-confirm-overlay');
        expect(overlay).not.toBeNull();
      });

      // Click confirm button
      const confirmBtn = document.querySelector('.local-model-confirm-overlay button:last-child') as HTMLButtonElement;
      confirmBtn.click();

      await vi.waitFor(() => {
        expect(mockManager.deleteModel).toHaveBeenCalled();
      });
      ui.destroy();
    });

    it('does not delete when cancelled', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const deleteBtn = document.getElementById('delete-model') as HTMLButtonElement;
      deleteBtn.click();

      await vi.waitFor(() => {
        const overlay = document.querySelector('.local-model-confirm-overlay');
        expect(overlay).not.toBeNull();
      });

      // Click cancel button
      const cancelBtn = document.querySelector('.local-model-confirm-overlay button:first-child') as HTMLButtonElement;
      cancelBtn.click();

      // Wait a tick then verify
      await new Promise(r => setTimeout(r, 10));
      expect(mockManager.deleteModel).not.toHaveBeenCalled();
      ui.destroy();
    });
  });

  describe('retry', () => {
    it('retries by updating status and hiding error', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const retryBtn = document.getElementById('retry-action') as HTMLButtonElement;
      retryBtn.click();

      await vi.waitFor(() => {
        expect(mockManager.getModelInfo).toHaveBeenCalled();
      });
      ui.destroy();
    });
  });

  describe('status updates', () => {
    it('startStatusUpdates sets an interval', () => {
      const ui = new LocalModelUI('local-model-container');
      ui.startStatusUpdates();
      // Calling again should be idempotent
      ui.startStatusUpdates();
      ui.destroy();
    });

    it('stopStatusUpdates clears the interval', () => {
      const ui = new LocalModelUI('local-model-container');
      ui.startStatusUpdates();
      ui.stopStatusUpdates();
      // Calling again should be safe
      ui.stopStatusUpdates();
      ui.destroy();
    });
  });

  describe('performance panel', () => {
    it('shows performance panel', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      ui.showPerformancePanel();

      const perfPanel = document.querySelector('.performance-panel') as HTMLElement;
      expect(perfPanel).not.toBeNull();
      expect(perfPanel.style.display).not.toBe('none');
      ui.destroy();
    });

    it('hides performance panel', () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      ui.showPerformancePanel();
      ui.hidePerformancePanel();

      const perfPanel = document.querySelector('.performance-panel') as HTMLElement;
      expect(perfPanel.style.display).toBe('none');
      ui.destroy();
    });

    it('shows existing panel instead of creating new one', () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      ui.showPerformancePanel();
      ui.hidePerformancePanel();
      ui.showPerformancePanel();

      const panels = document.querySelectorAll('.performance-panel');
      expect(panels.length).toBe(1);
      ui.destroy();
    });

    it('updates performance display with report data', async () => {
      const mockManager = createMockModelManager();
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      ui.showPerformancePanel();

      await vi.waitFor(() => {
        const totalEl = document.getElementById('perf-total-translations');
        expect(totalEl!.textContent).toBe('42');
      });
      ui.destroy();
    });

    it('renders high memory pressure', async () => {
      const mockManager = createMockModelManager({
        getPerformanceReport: vi.fn().mockResolvedValue({
          summary: {
            totalTranslations: 10,
            successRate: '90%',
            averageInferenceTime: '200ms',
            throughput: { tokensPerSecond: 15 },
          },
          performance: { trend: 'improving', optimizationLevel: 'performance', lastOptimized: new Date().toISOString() },
          memory: { currentUsage: '2048 MB', peakUsage: '2560 MB', pressure: '85%' },
          recommendations: [{ type: 'memory', severity: 'warning', message: 'High memory usage', action: 'Consider low-power mode' }],
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      ui.showPerformancePanel();

      await vi.waitFor(() => {
        const memPressure = document.getElementById('memory-pressure');
        expect(memPressure!.textContent).toBe('High');
      });
      ui.destroy();
    });

    it('renders medium memory pressure', async () => {
      const mockManager = createMockModelManager({
        getPerformanceReport: vi.fn().mockResolvedValue({
          summary: { totalTranslations: 5, successRate: '100%', averageInferenceTime: '100ms', throughput: { tokensPerSecond: 30 } },
          performance: { trend: 'stable', optimizationLevel: 'balanced', lastOptimized: null },
          memory: { currentUsage: '1024 MB', peakUsage: '1536 MB', pressure: '65%' },
          recommendations: [],
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      ui.showPerformancePanel();

      await vi.waitFor(() => {
        const memPressure = document.getElementById('memory-pressure');
        expect(memPressure!.textContent).toBe('Medium');
      });
      ui.destroy();
    });

    it('renders recommendations when present', async () => {
      const mockManager = createMockModelManager({
        getPerformanceReport: vi.fn().mockResolvedValue({
          summary: { totalTranslations: 0, successRate: '0', averageInferenceTime: '0', throughput: { tokensPerSecond: 0 } },
          performance: { trend: 'declining', optimizationLevel: 'low-power', lastOptimized: null },
          memory: { currentUsage: '0', peakUsage: '0', pressure: '10%' },
          recommendations: [
            { type: 'performance', severity: 'info', message: 'Try balanced mode', action: 'Switch to balanced' },
          ],
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      ui.showPerformancePanel();

      await vi.waitFor(() => {
        const recsPanel = document.getElementById('performance-recommendations');
        expect(recsPanel!.style.display).toBe('block');
      });
      ui.destroy();
    });
  });

  describe('showMessage', () => {
    it('logs message to console', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const ui = new LocalModelUI('local-model-container');
      ui.showMessage('Test message', 'info');
      expect(spy).toHaveBeenCalledWith('[LocalModelUI] info: Test message');
      ui.destroy();
    });
  });

  describe('getValidationStepText', () => {
    it('returns correct text for known steps', async () => {
      const mockManager = createMockModelManager({
        validateModel: vi.fn().mockImplementation(async (onProgress: (info: { progress?: number; step?: string }) => void) => {
          onProgress({ progress: 25, step: 'size' });
          onProgress({ progress: 50, step: 'data-retrieval' });
          onProgress({ progress: 75, step: 'checksum' });
          onProgress({ progress: 100, step: 'complete' });
          return { valid: true, duration: 200, checks: {} };
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const validateBtn = document.getElementById('validate-model') as HTMLButtonElement;
      validateBtn.click();

      await vi.waitFor(() => {
        const steps = document.querySelectorAll('#validation-steps .validation-step');
        expect(steps.length).toBe(4);
      });
      ui.destroy();
    });

    it('handles unknown step names', async () => {
      const mockManager = createMockModelManager({
        validateModel: vi.fn().mockImplementation(async (onProgress: (info: { progress?: number; step?: string }) => void) => {
          onProgress({ progress: 50, step: 'custom-step' });
          return { valid: true, duration: 100, checks: {} };
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const validateBtn = document.getElementById('validate-model') as HTMLButtonElement;
      validateBtn.click();

      await vi.waitFor(() => {
        const steps = document.querySelectorAll('#validation-steps .validation-step');
        expect(steps.length).toBe(1);
      });
      ui.destroy();
    });
  });

  describe('updateProgressUI', () => {
    it('shows shard info and speed during download', async () => {
      const mockManager = createMockModelManager({
        downloadModel: vi.fn().mockImplementation(async (onProgress: (info: Record<string, unknown>) => void) => {
          onProgress({ progress: 30, loaded: 750 * 1024 * 1024, total: 2500 * 1024 * 1024, status: 'Downloading...', shardIndex: 1, shardCount: 5 });
          onProgress({ progress: 100, loaded: 2500 * 1024 * 1024, total: 2500 * 1024 * 1024, complete: true });
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const downloadBtn = document.getElementById('download-model') as HTMLButtonElement;
      downloadBtn.click();

      await vi.waitFor(() => {
        const shardInfo = document.getElementById('progress-shard-info');
        expect(shardInfo!.style.display).toBe('block');
      });
      ui.destroy();
    });
  });

  describe('destroy', () => {
    it('cleans up status updates and progress', () => {
      const ui = new LocalModelUI('local-model-container');
      ui.startStatusUpdates();
      ui.destroy();
      // Should not throw on double destroy
      ui.destroy();
    });
  });

  describe('validation results display', () => {
    it('shows failed validation correctly', async () => {
      const mockManager = createMockModelManager({
        validateModel: vi.fn().mockResolvedValue({
          valid: false,
          duration: 300,
          checks: {
            size: { passed: true, message: 'Size OK' },
            checksum: { passed: false, message: 'Checksum mismatch', details: { expected: 'abc', actual: 'def' } },
          },
          details: { version: '1.0', format: 'GGUF' },
        }),
      });
      (window as Record<string, unknown>).localModelManager = mockManager;

      const ui = new LocalModelUI('local-model-container');
      const validateBtn = document.getElementById('validate-model') as HTMLButtonElement;
      validateBtn.click();

      await vi.waitFor(() => {
        const summary = document.getElementById('validation-summary');
        expect(summary!.innerHTML).toContain('FAIL');
        const details = document.getElementById('validation-details');
        expect(details!.innerHTML).toContain('Checksum mismatch');
      });
      ui.destroy();
    });
  });

  describe('performance update stats', () => {
    it('updates performance stats when translations > 0', async () => {
      (window as Record<string, unknown>).localModelManager = createMockModelManager({
        getModelInfo: vi.fn().mockReturnValue({
          available: true,
          ready: true,
          downloading: false,
          backend: 'wllama',
          performanceStats: { totalTranslations: 25, successRate: 96, averageInferenceTime: 180 },
        }),
      });

      const ui = new LocalModelUI('local-model-container');
      await ui.updateStatus();

      const perfElement = document.getElementById('performance-stats');
      expect(perfElement!.style.display).toBe('block');
      const perfText = document.getElementById('performance-text');
      expect(perfText!.textContent).toContain('25 translations');
      ui.destroy();
    });
  });
});
