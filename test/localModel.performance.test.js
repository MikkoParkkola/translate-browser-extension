/**
 * LocalModelManager performance monitoring tests
 * Tests performance tracking, optimization, and monitoring features
 */

// Mock performance API
global.performance = {
  memory: {
    usedJSHeapSize: 1024 * 1024 * 30, // 30MB
    totalJSHeapSize: 1024 * 1024 * 100, // 100MB
    jsHeapSizeLimit: 1024 * 1024 * 200  // 200MB
  }
};

describe('LocalModelManager Performance Monitoring', () => {
  let LocalModelManager;
  let modelManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Mock timers
    jest.useFakeTimers();

    LocalModelManager = require('../src/localModel.js');
    modelManager = new LocalModelManager();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Performance Monitoring Lifecycle', () => {
    test('should start performance monitoring', () => {
      modelManager.startPerformanceMonitoring();

      expect(modelManager.memoryMonitorTimer).toBeDefined();
      expect(modelManager.performanceOptimizationTimer).toBeDefined();
      expect(console.log).toHaveBeenCalledWith('[LocalModel] Performance monitoring started');
    });

    test('should stop performance monitoring', () => {
      modelManager.startPerformanceMonitoring();
      modelManager.stopPerformanceMonitoring();

      expect(modelManager.memoryMonitorTimer).toBeNull();
      expect(modelManager.performanceOptimizationTimer).toBeNull();
      expect(console.log).toHaveBeenCalledWith('[LocalModel] Performance monitoring stopped');
    });

    test('should clear existing timers when restarting monitoring', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      modelManager.startPerformanceMonitoring();
      modelManager.startPerformanceMonitoring(); // Start again

      expect(clearIntervalSpy).toHaveBeenCalledTimes(2); // Called for both existing timers
    });

    test('should update memory usage periodically', () => {
      modelManager.updateMemoryUsage = jest.fn();
      modelManager.startPerformanceMonitoring();

      // Fast forward timer
      jest.advanceTimersByTime(5000); // 5 seconds

      expect(modelManager.updateMemoryUsage).toHaveBeenCalled();
    });

    test('should run adaptive optimization periodically', () => {
      modelManager.optimizePerformanceAdaptively = jest.fn();
      modelManager.performanceConfig.adaptiveOptimization = true;
      modelManager.startPerformanceMonitoring();

      // Fast forward timer
      jest.advanceTimersByTime(30000); // 30 seconds

      expect(modelManager.optimizePerformanceAdaptively).toHaveBeenCalled();
    });
  });

  describe('Memory Usage Monitoring', () => {
    test('should update memory usage stats', async () => {
      await modelManager.updateMemoryUsage();

      expect(modelManager.performanceStats.memoryUsage.currentMemory).toBe(1024 * 1024 * 30);
      expect(modelManager.performanceStats.memoryUsage.runtimeMemory).toBe(1024 * 1024 * 100);
      expect(modelManager.performanceStats.memoryUsage.peakMemory).toBe(1024 * 1024 * 30);
    });

    test('should track peak memory usage', async () => {
      await modelManager.updateMemoryUsage();

      // Simulate increased memory usage
      global.performance.memory.usedJSHeapSize = 1024 * 1024 * 50; // 50MB
      await modelManager.updateMemoryUsage();

      expect(modelManager.performanceStats.memoryUsage.peakMemory).toBe(1024 * 1024 * 50);
    });

    test('should handle memory pressure', async () => {
      modelManager.handleMemoryPressure = jest.fn();

      // Set high memory usage (90% of total)
      global.performance.memory.usedJSHeapSize = 1024 * 1024 * 90; // 90MB
      global.performance.memory.totalJSHeapSize = 1024 * 1024 * 100; // 100MB

      await modelManager.updateMemoryUsage();

      expect(modelManager.handleMemoryPressure).toHaveBeenCalledWith(0.9);
    });

    test('should handle missing performance.memory API', async () => {
      delete global.performance.memory;

      await modelManager.updateMemoryUsage();

      // Should not throw and should handle gracefully
      expect(console.warn).toHaveBeenCalledWith(
        '[LocalModel] Failed to update memory usage:',
        expect.any(String)
      );
    });
  });

  describe('Memory Pressure Handling', () => {
    test('should switch to low-power mode under memory pressure', async () => {
      modelManager.switchOptimizationLevel = jest.fn().mockResolvedValue();
      modelManager.performanceStats.optimizationLevel = 'balanced';

      await modelManager.handleMemoryPressure(0.85);

      expect(modelManager.switchOptimizationLevel).toHaveBeenCalledWith('low-power');
      expect(console.warn).toHaveBeenCalledWith(
        '[LocalModel] Memory pressure detected: 85.0%'
      );
    });

    test('should clear inference history under memory pressure', async () => {
      modelManager.performanceStats.inferenceHistory = new Array(50).fill(1000);
      modelManager.switchOptimizationLevel = jest.fn().mockResolvedValue();

      await modelManager.handleMemoryPressure(0.9);

      expect(modelManager.performanceStats.inferenceHistory.length).toBe(10);
    });

    test('should trigger garbage collection if available', async () => {
      global.gc = jest.fn();
      modelManager.switchOptimizationLevel = jest.fn().mockResolvedValue();

      await modelManager.handleMemoryPressure(0.85);

      expect(global.gc).toHaveBeenCalled();
    });

    test('should not switch optimization if already in low-power mode', async () => {
      modelManager.switchOptimizationLevel = jest.fn();
      modelManager.performanceStats.optimizationLevel = 'low-power';

      await modelManager.handleMemoryPressure(0.85);

      expect(modelManager.switchOptimizationLevel).not.toHaveBeenCalled();
    });
  });

  describe('Inference Performance Recording', () => {
    test('should record successful inference', () => {
      const startTime = 1000;
      const endTime = 3000;
      const inputLength = 100;
      const outputLength = 80;

      modelManager.recordInference(startTime, endTime, inputLength, outputLength, true);

      expect(modelManager.performanceStats.totalTranslations).toBe(1);
      expect(modelManager.performanceStats.failureCount).toBe(0);
      expect(modelManager.performanceStats.successRate).toBe(100);
      expect(modelManager.performanceStats.inferenceHistory).toContain(2000); // endTime - startTime
      expect(modelManager.performanceStats.averageInferenceTime).toBe(2000);
      expect(modelManager.performanceStats.charactersPerSecond).toBe(50); // 100 chars / 2 seconds
      expect(modelManager.performanceStats.tokensPerSecond).toBe(12.5); // chars/sec / 4
    });

    test('should record failed inference', () => {
      modelManager.recordInference(1000, 2000, 100, 0, false);

      expect(modelManager.performanceStats.totalTranslations).toBe(1);
      expect(modelManager.performanceStats.failureCount).toBe(1);
      expect(modelManager.performanceStats.successRate).toBe(0);
      expect(modelManager.performanceStats.inferenceHistory).toHaveLength(0);
    });

    test('should maintain inference history within limit', () => {
      modelManager.performanceConfig.historySize = 5;

      // Record 10 inferences
      for (let i = 0; i < 10; i++) {
        modelManager.recordInference(i * 1000, (i + 1) * 1000, 100, 80, true);
      }

      expect(modelManager.performanceStats.inferenceHistory).toHaveLength(5);
      expect(modelManager.performanceStats.inferenceHistory[0]).toBe(1000); // Latest 5 should start from index 5
    });

    test('should calculate average inference time correctly', () => {
      modelManager.recordInference(0, 1000, 100, 80, true); // 1000ms
      modelManager.recordInference(0, 2000, 100, 80, true); // 2000ms
      modelManager.recordInference(0, 3000, 100, 80, true); // 3000ms

      expect(modelManager.performanceStats.averageInferenceTime).toBe(2000); // (1000+2000+3000)/3
    });

    test('should update performance trend', () => {
      modelManager.updatePerformanceTrend = jest.fn();

      modelManager.recordInference(0, 1000, 100, 80, true);

      expect(modelManager.updatePerformanceTrend).toHaveBeenCalled();
    });
  });

  describe('Detailed Performance Recording', () => {
    test('should record detailed performance timings', () => {
      modelManager.performanceConfig.enableDetailedProfiling = true;
      modelManager.performanceStats.totalTranslations = 2; // Simulate existing translations

      const timings = {
        modelLoading: 500,
        preprocessing: 100,
        inference: 1000,
        postprocessing: 200,
        totalPipeline: 1800
      };

      modelManager.recordDetailedPerformance(timings);

      // Should update running averages
      expect(modelManager.performanceStats.timings.modelLoading).toBe(250); // (0 + 500) / 2
      expect(modelManager.performanceStats.timings.preprocessing).toBe(50); // (0 + 100) / 2
      expect(modelManager.performanceStats.timings.inference).toBe(500); // (0 + 1000) / 2
      expect(modelManager.performanceStats.timings.postprocessing).toBe(100); // (0 + 200) / 2
      expect(modelManager.performanceStats.timings.totalPipeline).toBe(900); // (0 + 1800) / 2
    });

    test('should skip recording when profiling is disabled', () => {
      modelManager.performanceConfig.enableDetailedProfiling = false;

      const timings = { inference: 1000 };
      modelManager.recordDetailedPerformance(timings);

      expect(modelManager.performanceStats.timings.inference).toBe(0);
    });
  });

  describe('Performance Trend Analysis', () => {
    test('should detect improving performance trend', () => {
      // Add 20 inference times: first 10 slower, last 10 faster
      const slowTimes = new Array(10).fill(3000);
      const fastTimes = new Array(10).fill(1000);
      modelManager.performanceStats.inferenceHistory = [...slowTimes, ...fastTimes];

      modelManager.updatePerformanceTrend();

      expect(modelManager.performanceStats.performanceTrend).toBe('improving');
    });

    test('should detect degrading performance trend', () => {
      // Add 20 inference times: first 10 faster, last 10 slower
      const fastTimes = new Array(10).fill(1000);
      const slowTimes = new Array(10).fill(3000);
      modelManager.performanceStats.inferenceHistory = [...fastTimes, ...slowTimes];

      modelManager.updatePerformanceTrend();

      expect(modelManager.performanceStats.performanceTrend).toBe('degrading');
    });

    test('should detect stable performance trend', () => {
      // Add 20 similar inference times
      const stableTimes = new Array(20).fill(2000);
      modelManager.performanceStats.inferenceHistory = stableTimes;

      modelManager.updatePerformanceTrend();

      expect(modelManager.performanceStats.performanceTrend).toBe('stable');
    });

    test('should not analyze trend with insufficient data', () => {
      const fewTimes = new Array(10).fill(2000);
      modelManager.performanceStats.inferenceHistory = fewTimes;

      modelManager.updatePerformanceTrend();

      // Trend should remain unchanged (default is 'stable')
      expect(modelManager.performanceStats.performanceTrend).toBe('stable');
    });
  });

  describe('Adaptive Performance Optimization', () => {
    test('should recommend low-power mode for high memory pressure', async () => {
      modelManager.getMemoryPressure = jest.fn().mockReturnValue(0.85);
      modelManager.switchOptimizationLevel = jest.fn().mockResolvedValue();
      modelManager.performanceStats.optimizationLevel = 'balanced';

      await modelManager.optimizePerformanceAdaptively();

      expect(modelManager.switchOptimizationLevel).toHaveBeenCalledWith('low-power');
    });

    test('should recommend performance mode for improving trend and low memory', async () => {
      modelManager.getMemoryPressure = jest.fn().mockReturnValue(0.5);
      modelManager.performanceStats.performanceTrend = 'improving';
      modelManager.switchOptimizationLevel = jest.fn().mockResolvedValue();
      modelManager.performanceStats.optimizationLevel = 'balanced';

      await modelManager.optimizePerformanceAdaptively();

      expect(modelManager.switchOptimizationLevel).toHaveBeenCalledWith('performance');
    });

    test('should recommend low-power mode for slow inference times', async () => {
      modelManager.getMemoryPressure = jest.fn().mockReturnValue(0.5);
      modelManager.performanceStats.averageInferenceTime = 15000; // 15 seconds
      modelManager.switchOptimizationLevel = jest.fn().mockResolvedValue();
      modelManager.performanceStats.optimizationLevel = 'balanced';

      await modelManager.optimizePerformanceAdaptively();

      expect(modelManager.switchOptimizationLevel).toHaveBeenCalledWith('low-power');
    });

    test('should recommend performance mode for fast inference times', async () => {
      modelManager.getMemoryPressure = jest.fn().mockReturnValue(0.5);
      modelManager.performanceStats.averageInferenceTime = 1500; // 1.5 seconds
      modelManager.switchOptimizationLevel = jest.fn().mockResolvedValue();
      modelManager.performanceStats.optimizationLevel = 'balanced';

      await modelManager.optimizePerformanceAdaptively();

      expect(modelManager.switchOptimizationLevel).toHaveBeenCalledWith('performance');
    });

    test('should not change optimization if already optimal', async () => {
      modelManager.getMemoryPressure = jest.fn().mockReturnValue(0.5);
      modelManager.performanceStats.averageInferenceTime = 5000; // 5 seconds (balanced)
      modelManager.switchOptimizationLevel = jest.fn();
      modelManager.performanceStats.optimizationLevel = 'balanced';

      await modelManager.optimizePerformanceAdaptively();

      expect(modelManager.switchOptimizationLevel).not.toHaveBeenCalled();
    });

    test('should handle optimization errors gracefully', async () => {
      modelManager.getMemoryPressure = jest.fn().mockThrowError(new Error('Memory API error'));

      await modelManager.optimizePerformanceAdaptively();

      expect(console.warn).toHaveBeenCalledWith(
        '[LocalModel] Adaptive optimization failed:',
        'Memory API error'
      );
    });
  });

  describe('Optimization Level Management', () => {
    test('should switch optimization levels', async () => {
      await modelManager.switchOptimizationLevel('performance');

      expect(modelManager.performanceStats.optimizationLevel).toBe('performance');
      expect(modelManager.performanceStats.lastOptimizationDate).toBeDefined();
      expect(console.log).toHaveBeenCalledWith(
        '[LocalModel] Switched to performance optimization level:',
        modelManager.performanceConfig.strategies.performance
      );
    });

    test('should throw error for unknown optimization level', async () => {
      await expect(modelManager.switchOptimizationLevel('unknown'))
        .rejects.toThrow('Unknown optimization level: unknown');
    });

    test('should apply strategy settings', async () => {
      await modelManager.switchOptimizationLevel('low-power');

      const strategy = modelManager.performanceConfig.strategies['low-power'];
      expect(strategy.batchSize).toBe(2);
      expect(strategy.threadCount).toBe(1);
      expect(strategy.enableCache).toBe(true);
      expect(strategy.reducedPrecision).toBe(true);
    });
  });

  describe('Performance Reporting', () => {
    test('should generate comprehensive performance report', () => {
      // Set up performance data
      modelManager.performanceStats.totalTranslations = 100;
      modelManager.performanceStats.successRate = 95;
      modelManager.performanceStats.averageInferenceTime = 2500; // 2.5 seconds
      modelManager.performanceStats.tokensPerSecond = 20;
      modelManager.performanceStats.charactersPerSecond = 80;
      modelManager.performanceStats.performanceTrend = 'improving';
      modelManager.performanceStats.optimizationLevel = 'balanced';
      modelManager.performanceStats.lastOptimizationDate = Date.now();

      const report = modelManager.getPerformanceReport();

      expect(report.summary.totalTranslations).toBe(100);
      expect(report.summary.successRate).toBe('95.00%');
      expect(report.summary.averageInferenceTime).toBe('2.50s');
      expect(report.summary.throughput.tokensPerSecond).toBe('20.0');
      expect(report.performance.trend).toBe('improving');
      expect(report.performance.optimizationLevel).toBe('balanced');
      expect(report.memory.pressure).toBe('30.0%'); // 30MB / 100MB
    });

    test('should include detailed timings when profiling enabled', () => {
      modelManager.performanceConfig.enableDetailedProfiling = true;
      modelManager.performanceStats.timings.inference = 1500;

      const report = modelManager.getPerformanceReport();

      expect(report.timings).toBeDefined();
      expect(report.timings.inference).toBe('1.500s');
    });

    test('should exclude detailed timings when profiling disabled', () => {
      modelManager.performanceConfig.enableDetailedProfiling = false;

      const report = modelManager.getPerformanceReport();

      expect(report.timings).toBeNull();
    });
  });

  describe('Performance Recommendations', () => {
    test('should recommend memory optimization for high memory usage', () => {
      modelManager.getMemoryPressure = jest.fn().mockReturnValue(0.85);

      const recommendations = modelManager.getPerformanceRecommendations();

      expect(recommendations).toContainEqual({
        type: 'memory',
        severity: 'high',
        message: 'High memory usage detected. Consider switching to low-power mode.',
        action: 'Reduce batch size and enable memory optimization'
      });
    });

    test('should recommend performance optimization for slow inference', () => {
      modelManager.performanceStats.averageInferenceTime = 20000; // 20 seconds

      const recommendations = modelManager.getPerformanceRecommendations();

      expect(recommendations).toContainEqual({
        type: 'performance',
        severity: 'medium',
        message: 'Slow inference times detected. Device may not be optimal for local translation.',
        action: 'Consider using cloud translation or reducing model precision'
      });
    });

    test('should recommend trend analysis for degrading performance', () => {
      modelManager.performanceStats.performanceTrend = 'degrading';

      const recommendations = modelManager.getPerformanceRecommendations();

      expect(recommendations).toContainEqual({
        type: 'trend',
        severity: 'medium',
        message: 'Performance is degrading over time.',
        action: 'Check system resources and consider model optimization'
      });
    });

    test('should recommend reliability check for low success rate', () => {
      modelManager.performanceStats.successRate = 80;

      const recommendations = modelManager.getPerformanceRecommendations();

      expect(recommendations).toContainEqual({
        type: 'reliability',
        severity: 'high',
        message: 'Low success rate detected.',
        action: 'Check model integrity and system stability'
      });
    });

    test('should return empty recommendations for optimal performance', () => {
      modelManager.getMemoryPressure = jest.fn().mockReturnValue(0.4);
      modelManager.performanceStats.averageInferenceTime = 3000;
      modelManager.performanceStats.performanceTrend = 'stable';
      modelManager.performanceStats.successRate = 98;

      const recommendations = modelManager.getPerformanceRecommendations();

      expect(recommendations).toHaveLength(0);
    });
  });

  describe('Performance Statistics Reset', () => {
    test('should reset all performance statistics', () => {
      // Set up some performance data
      modelManager.performanceStats.totalTranslations = 100;
      modelManager.performanceStats.failureCount = 5;
      modelManager.performanceStats.averageInferenceTime = 2000;
      modelManager.performanceStats.inferenceHistory = [1000, 2000, 3000];
      modelManager.performanceStats.memoryUsage.peakMemory = 1024 * 1024 * 50;

      modelManager.resetPerformanceStats();

      expect(modelManager.performanceStats.totalTranslations).toBe(0);
      expect(modelManager.performanceStats.failureCount).toBe(0);
      expect(modelManager.performanceStats.averageInferenceTime).toBe(0);
      expect(modelManager.performanceStats.successRate).toBe(100);
      expect(modelManager.performanceStats.inferenceHistory).toHaveLength(0);
      expect(modelManager.performanceStats.memoryUsage.peakMemory).toBe(0);
      expect(modelManager.performanceStats.performanceTrend).toBe('stable');
      expect(console.log).toHaveBeenCalledWith('[LocalModel] Performance statistics reset');
    });
  });
});