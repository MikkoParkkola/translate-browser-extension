/**
 * Tests for localModel.js (singleton factory)
 *
 * Tests the getModelManager singleton and the LocalModelManager subclass
 * that wraps WllamaModelManager with legacy compatibility methods.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist mock constructors — vi.fn() arrow functions can't be constructors inside hoisted vi.mock factories
const {
  MockModelValidator,
  MockModelUpdater,
  MockModelPerformanceMonitor,
} = vi.hoisted(() => ({
  MockModelValidator: vi.fn(function () {
    return { validateModelIntegrity: vi.fn().mockResolvedValue({ valid: true }) };
  }),
  MockModelUpdater: vi.fn(function () {
    return {
      checkForUpdates: vi.fn().mockResolvedValue({ hasUpdate: false }),
      scheduleUpdateCheck: vi.fn(),
      getUpdateInfo: vi.fn().mockReturnValue({ hasUpdate: false }),
      destroy: vi.fn(),
    };
  }),
  MockModelPerformanceMonitor: vi.fn(function () {
    return {
      startPerformanceMonitoring: vi.fn(),
      updatePerformanceStats: vi.fn(),
      getPerformanceSummary: vi.fn().mockReturnValue({}),
      destroy: vi.fn(),
    };
  }),
}));

// Mock all lib dependencies
vi.mock('./lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./lib/standardErrorHandler.js', () => ({
  standardErrorHandler: {
    handleError: vi.fn((error: Error) => error),
  },
}));

vi.mock('./lib/ModelValidator.js', () => ({
  ModelValidator: MockModelValidator,
}));

vi.mock('./lib/ModelUpdater.js', () => ({
  ModelUpdater: MockModelUpdater,
}));

vi.mock('./lib/ModelPerformanceMonitor.js', () => ({
  ModelPerformanceMonitor: MockModelPerformanceMonitor,
}));

// Mock chrome storage
// @ts-expect-error - Mock chrome in global scope
globalThis.chrome = {
  runtime: { getURL: vi.fn((path: string) => 'chrome-extension://test/' + path) },
  storage: {
    local: {
      get: vi.fn((keys: unknown, cb: (result: Record<string, unknown>) => void) => { cb({}); }),
      set: vi.fn((data: unknown, cb: () => void) => { cb(); }),
    },
  },
};

describe('localModel singleton', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getModelManager returns a LocalModelManager instance', async () => {
    const mod = await import('./localModel.js');
    const manager = mod.getModelManager();

    expect(manager).toBeDefined();
    expect(manager.modelLoaded).toBe(false);
    expect(manager.isInitialized).toBe(false);
  });

  it('getModelManager returns the same instance (singleton)', async () => {
    const mod = await import('./localModel.js');
    const a = mod.getModelManager();
    const b = mod.getModelManager();

    expect(a).toBe(b);
  });

  it('different module loads share the same singleton via import cache', async () => {
    const mod1 = await import('./localModel.js');
    const mod2 = await import('./localModel.js');

    expect(mod1.getModelManager()).toBe(mod2.getModelManager());
  });
});

describe('LocalModelManager (subclass)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let LocalModelManagerClass: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./localModel.js');
    LocalModelManagerClass = mod.LocalModelManager;
  });

  it('can be instantiated directly', () => {
    const manager = new LocalModelManagerClass();
    expect(manager).toBeDefined();
    expect(manager.modelLoaded).toBe(false);
  });

  describe('legacy compatibility methods', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manager: any;

    beforeEach(() => {
      manager = new LocalModelManagerClass();
    });

    it('getModelInfo returns model info', async () => {
      const info = await manager.getModelInfo();

      expect(info).toHaveProperty('available');
      expect(info).toHaveProperty('ready');
      expect(info).toHaveProperty('backend', 'wllama');
      expect(info).toHaveProperty('name');
    });

    it('checkHealth delegates to performHealthCheck', async () => {
      const health = await manager.checkHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('checks');
      expect(health).toHaveProperty('timestamp');
    });

    it('isModelReady returns false when not downloaded', async () => {
      const ready = await manager.isModelReady();
      expect(ready).toBe(false);
    });

    it('getModelSize returns 0 when no stored data', async () => {
      const size = await manager.getModelSize();
      expect(size).toBe(0);
    });

    it('getPerformanceStats returns summary', () => {
      const stats = manager.getPerformanceStats();
      expect(stats).toBeDefined();
    });

    it('checkForUpdates delegates to updater', async () => {
      const result = await manager.checkForUpdates();
      expect(result).toHaveProperty('hasUpdate', false);
    });

    it('hasUpdate returns boolean', async () => {
      const result = await manager.hasUpdate();
      expect(result).toBe(false);
    });

    it('validateModel returns invalid when not downloaded', async () => {
      const result = await manager.validateModel();
      expect(result.valid).toBe(false);
      expect(result.message).toContain('not downloaded');
    });

    it('formatBytes formats correctly', () => {
      expect(manager.formatBytes(0)).toBe('0 B');
      expect(manager.formatBytes(1024)).toBe('1 KB');
      expect(manager.formatBytes(1048576)).toBe('1 MB');
      expect(manager.formatBytes(1073741824)).toBe('1 GB');
      expect(manager.formatBytes(2489909952)).toMatch(/2\.\d+ GB/);
    });
  });

  describe('inherits from WllamaModelManager', () => {
    it('has downloadModel method', () => {
      const manager = new LocalModelManagerClass();
      expect(typeof manager.downloadModel).toBe('function');
    });

    it('has translateText method', () => {
      const manager = new LocalModelManagerClass();
      expect(typeof manager.translateText).toBe('function');
    });

    it('has translate alias', () => {
      const manager = new LocalModelManagerClass();
      expect(typeof manager.translate).toBe('function');
    });

    it('has init method', () => {
      const manager = new LocalModelManagerClass();
      expect(typeof manager.init).toBe('function');
    });

    it('has destroy method', () => {
      const manager = new LocalModelManagerClass();
      expect(typeof manager.destroy).toBe('function');
    });

    it('has setModelUrls method', () => {
      const manager = new LocalModelManagerClass();
      expect(typeof manager.setModelUrls).toBe('function');
    });
  });
});
