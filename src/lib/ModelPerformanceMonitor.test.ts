import { describe, it, expect } from 'vitest';
import { ModelPerformanceMonitor } from './ModelPerformanceMonitor';

describe('ModelPerformanceMonitor', () => {
  it('constructor accepts a config object', () => {
    const monitor = new ModelPerformanceMonitor({
      enabled: true,
      sampleInterval: 100,
      maxSamples: 50,
      enableMemoryMonitoring: true,
      enableInferenceTracking: true,
      enableAdaptiveOptimization: false,
      memoryThreshold: 0.8,
    });
    expect(monitor).toBeInstanceOf(ModelPerformanceMonitor);
  });

  it('constructor works without config', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(monitor).toBeInstanceOf(ModelPerformanceMonitor);
  });

  it('startPerformanceMonitoring does not throw', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(() => monitor.startPerformanceMonitoring()).not.toThrow();
  });

  it('updatePerformanceStats does not throw with various args', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(() => monitor.updatePerformanceStats()).not.toThrow();
    expect(() => monitor.updatePerformanceStats(42)).not.toThrow();
    expect(() => monitor.updatePerformanceStats(42, true)).not.toThrow();
    expect(() => monitor.updatePerformanceStats(42, false, 100)).not.toThrow();
  });

  it('getPerformanceSummary returns an empty object', () => {
    const monitor = new ModelPerformanceMonitor();
    const summary = monitor.getPerformanceSummary();
    expect(summary).toEqual({});
  });

  it('destroy is callable and idempotent', () => {
    const monitor = new ModelPerformanceMonitor();
    expect(() => monitor.destroy()).not.toThrow();
    expect(() => monitor.destroy()).not.toThrow();
  });
});
