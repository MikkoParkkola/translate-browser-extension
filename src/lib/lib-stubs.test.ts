/**
 * Tests for lib/ stub modules:
 * - ModelPerformanceMonitor.ts
 * - ModelUpdater.ts
 * - ModelValidator.ts
 * - logger.ts
 * - standardErrorHandler.ts
 *
 * These are stub implementations used by LocalModelManager.
 */

import { describe, it, expect } from 'vitest';
import { ModelPerformanceMonitor } from './ModelPerformanceMonitor';
import { ModelUpdater } from './ModelUpdater';
import { ModelValidator } from './ModelValidator';
import { logger } from './logger';
import { standardErrorHandler, HandledError } from './standardErrorHandler';

// ============================================================================
// ModelPerformanceMonitor
// ============================================================================

describe('ModelPerformanceMonitor', () => {
  it('can be constructed with no config', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(monitor).toBeDefined();
  });

  it('can be constructed with config', () => {
    const monitor = new ModelPerformanceMonitor({ enabled: true, sampleInterval: 100, maxSamples: 50 });
    expect(monitor).toBeDefined();
  });

  it('startPerformanceMonitoring does not throw', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(() => monitor.startPerformanceMonitoring()).not.toThrow();
  });

  it('updatePerformanceStats does not throw', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(() => monitor.updatePerformanceStats({ fps: 60 })).not.toThrow();
  });

  it('updatePerformanceStats with no args does not throw', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(() => monitor.updatePerformanceStats()).not.toThrow();
  });

  it('getPerformanceSummary returns an object', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(typeof monitor.getPerformanceSummary()).toBe('object');
  });

  it('destroy does not throw', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(() => monitor.destroy()).not.toThrow();
  });
});

// ============================================================================
// ModelUpdater
// ============================================================================

describe('ModelUpdater', () => {
  it('can be constructed with no config', () => {
    const updater = new ModelUpdater();
    expect(updater).toBeDefined();
  });

  it('can be constructed with config', () => {
    const updater = new ModelUpdater({ checkInterval: 3600, autoUpdate: false });
    expect(updater).toBeDefined();
  });

  it('checkForUpdates returns hasUpdate=false', async () => {
    const updater = new ModelUpdater();
    const result = await updater.checkForUpdates();
    expect(result.hasUpdate).toBe(false);
  });

  it('scheduleUpdateCheck does not throw', () => {
    const updater = new ModelUpdater();
    expect(() => updater.scheduleUpdateCheck(1000)).not.toThrow();
  });

  it('scheduleUpdateCheck with no args does not throw', () => {
    const updater = new ModelUpdater();
    expect(() => updater.scheduleUpdateCheck()).not.toThrow();
  });

  it('getUpdateInfo returns hasUpdate=false', () => {
    const updater = new ModelUpdater();
    const info = updater.getUpdateInfo();
    expect(info.hasUpdate).toBe(false);
  });

  it('destroy does not throw', () => {
    const updater = new ModelUpdater();
    expect(() => updater.destroy()).not.toThrow();
  });
});

// ============================================================================
// ModelValidator
// ============================================================================

describe('ModelValidator', () => {
  it('can be constructed with no config', () => {
    const validator = new ModelValidator();
    expect(validator).toBeDefined();
  });

  it('can be constructed with strictMode', () => {
    const validator = new ModelValidator({ strictMode: true });
    expect(validator).toBeDefined();
  });

  it('validateModelIntegrity returns valid=true', async () => {
    const validator = new ModelValidator();
    const result = await validator.validateModelIntegrity();
    expect(result.valid).toBe(true);
  });

  it('validateModelIntegrity with path returns valid=true', async () => {
    const validator = new ModelValidator();
    const result = await validator.validateModelIntegrity('/path/to/model');
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// logger
// ============================================================================

describe('lib/logger', () => {
  it('logger.info does not throw', () => {
    expect(() => logger.info('test message')).not.toThrow();
  });

  it('logger.warn does not throw', () => {
    expect(() => logger.warn('warning')).not.toThrow();
  });

  it('logger.error does not throw', () => {
    expect(() => logger.error('error')).not.toThrow();
  });

  it('logger.debug does not throw', () => {
    expect(() => logger.debug('debug', { key: 'val' })).not.toThrow();
  });

  it('logger accepts multiple arguments', () => {
    expect(() => logger.info('msg', 1, 2, 3)).not.toThrow();
  });
});

// ============================================================================
// standardErrorHandler
// ============================================================================

describe('standardErrorHandler', () => {
  it('handleError returns a HandledError', () => {
    const err = new Error('something went wrong');
    const result = standardErrorHandler.handleError(err);
    expect(result).toBeInstanceOf(HandledError);
  });

  it('HandledError has name "HandledError"', () => {
    const err = new Error('test');
    const result = standardErrorHandler.handleError(err, { source: 'test' });
    expect(result.name).toBe('HandledError');
  });

  it('HandledError preserves original message', () => {
    const err = new Error('original message');
    const result = standardErrorHandler.handleError(err);
    expect(result.message).toBe('original message');
  });

  it('HandledError stores context', () => {
    const err = new Error('ctx');
    const result = standardErrorHandler.handleError(err, { source: 'unit-test', operation: 'testing' });
    expect(result.context.source).toBe('unit-test');
    expect(result.context.operation).toBe('testing');
  });

  it('handleError works with no context', () => {
    const err = new Error('no context');
    const result = standardErrorHandler.handleError(err);
    expect(result.context).toBeDefined();
  });

  it('handleError with empty message uses fallback', () => {
    const err = new Error('');
    // Error with empty message — standardErrorHandler uses 'handled error' fallback
    const result = standardErrorHandler.handleError(err);
    expect(result.message).toBe('handled error');
  });
});
