/**
 * Performance Benchmark Tests for Translation Extension Improvements
 * Validates performance improvements in logging, throttling, and DOM scanning
 */

// Mock browser APIs for testing
global.chrome = {
  storage: {
    local: {
      set: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue()
    },
    sync: {
      set: jest.fn().mockResolvedValue()
    }
  },
  runtime: {
    getManifest: jest.fn(() => ({ version_name: 'test' }))
  }
};

global.window = {
  location: { hostname: 'test.example.com' },
  localStorage: new Map()
};

// Performance measurement utilities
class PerformanceBenchmark {
  constructor(name) {
    this.name = name;
    this.measurements = [];
  }

  async measure(fn, iterations = 100) {
    const results = [];

    // Warmup
    for (let i = 0; i < 10; i++) {
      await fn();
    }

    // Actual measurements
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      results.push(end - start);
    }

    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    const min = Math.min(...results);
    const max = Math.max(...results);
    const p95 = results.sort((a, b) => a - b)[Math.floor(results.length * 0.95)];

    const measurement = { avg, min, max, p95, iterations };
    this.measurements.push(measurement);

    return measurement;
  }

  compare(baseline, improved) {
    const improvement = ((baseline.avg - improved.avg) / baseline.avg) * 100;
    return {
      improvement: improvement.toFixed(1) + '%',
      fasterBy: (baseline.avg / improved.avg).toFixed(2) + 'x',
      avgBaseline: baseline.avg.toFixed(2) + 'ms',
      avgImproved: improved.avg.toFixed(2) + 'ms'
    };
  }
}

describe('Performance Benchmarks', () => {
  describe('Logging Performance', () => {
    let Logger;

    beforeAll(async () => {
      // Dynamic import to handle ES modules
      const loggerModule = await import('../src/lib/logger.js');
      Logger = loggerModule.Logger;
    });

    test('Logger with redaction vs console.log performance', async () => {
      const benchmark = new PerformanceBenchmark('Logging');

      // Test data with API keys to trigger redaction
      const testMessage = 'API request with apiKey="sk-1234567890abcdef" completed successfully';
      const testObject = {
        message: 'Translation completed',
        apiKey: 'sk-abcdef1234567890',
        response: { text: 'Hello world', tokens: 50 }
      };

      // Baseline: console.log
      const baselineLogging = await benchmark.measure(() => {
        console.log('[Test]', testMessage, testObject);
      }, 1000);

      // Improved: Logger with redaction
      const logger = new Logger({ enableStorage: false });
      const improvedLogging = await benchmark.measure(() => {
        logger.info('Test', testMessage, testObject);
      }, 1000);

      const comparison = benchmark.compare(baselineLogging, improvedLogging);

      console.log('Logging Performance Comparison:');
      console.log('- Baseline (console.log):', comparison.avgBaseline);
      console.log('- Improved (Logger):', comparison.avgImproved);
      console.log('- Performance change:', comparison.improvement);

      // Logger should be within 3x of console.log performance despite redaction
      expect(improvedLogging.avg / baselineLogging.avg).toBeLessThan(3);
      expect(improvedLogging.p95).toBeLessThan(5); // 95th percentile under 5ms
    });

    test('Redaction performance with various sensitive patterns', async () => {
      const Logger = (await import('../src/lib/logger.js')).Logger;
      const benchmark = new PerformanceBenchmark('Redaction');

      const logger = new Logger({ enableStorage: false, enableConsole: false });

      const sensitiveMessages = [
        'Simple message with no sensitive data',
        'API key: sk-1234567890abcdefghijklmnopqrstuvwxyz',
        'Multiple secrets: apiKey="secret123", token="bearer_xyz", password="hidden"',
        'Email user@example.com called API with key sk-abc123def456',
        'Credit card 4532-1234-5678-9012 and SSN 123-45-6789'
      ];

      for (let i = 0; i < sensitiveMessages.length; i++) {
        const message = sensitiveMessages[i];
        const result = await benchmark.measure(() => {
          logger.redactSensitiveData(message);
        }, 500);

        console.log(`Redaction test ${i + 1}: ${result.avg.toFixed(2)}ms avg`);
        expect(result.avg).toBeLessThan(2); // Should be under 2ms
      }
    });
  });

  describe('Throttling Performance', () => {
    let Throttle, OptimizedThrottle;

    beforeAll(async () => {
      Throttle = (await import('../src/lib/throttle.js')).Throttle || class Throttle {
        constructor(options = {}) {
          this.requestLimit = options.requestLimit || 60;
          this.requests = [];
          this.windowMs = options.windowMs || 60000;
        }
        canMakeRequest() {
          const now = Date.now();
          this.requests = this.requests.filter(time => now - time < this.windowMs);
          return this.requests.length < this.requestLimit;
        }
        recordUsage() {
          this.requests.push(Date.now());
        }
      };

      OptimizedThrottle = (await import('../src/lib/optimizedThrottle.js')).OptimizedThrottle;
    });

    test('Throttle capacity check performance comparison', async () => {
      const benchmark = new PerformanceBenchmark('Throttle');

      // Setup throttlers
      const baselineThrottle = new Throttle({ requestLimit: 1000 });
      const optimizedThrottle = new OptimizedThrottle({ requestLimit: 1000 });

      // Fill with test data
      for (let i = 0; i < 800; i++) {
        baselineThrottle.recordUsage(100);
        optimizedThrottle.recordUsage(100);
      }

      // Benchmark baseline
      const baselinePerf = await benchmark.measure(() => {
        baselineThrottle.canMakeRequest(50);
      }, 10000);

      // Benchmark optimized
      const optimizedPerf = await benchmark.measure(() => {
        optimizedThrottle.canMakeRequest(50);
      }, 10000);

      const comparison = benchmark.compare(baselinePerf, optimizedPerf);

      console.log('Throttling Performance Comparison:');
      console.log('- Baseline:', comparison.avgBaseline);
      console.log('- Optimized:', comparison.avgImproved);
      console.log('- Improvement:', comparison.improvement);

      // Optimized should be at least 2x faster
      expect(baselinePerf.avg / optimizedPerf.avg).toBeGreaterThan(2);
      expect(optimizedPerf.avg).toBeLessThan(0.1); // Under 0.1ms
    });

    test('High-frequency throttle operations stress test', async () => {
      const OptimizedThrottle = (await import('../src/lib/optimizedThrottle.js')).OptimizedThrottle;
      const benchmark = new PerformanceBenchmark('Throttle Stress');

      const throttle = new OptimizedThrottle({ requestLimit: 100 });

      // Stress test with rapid capacity checks and recordings
      const stressTest = await benchmark.measure(() => {
        for (let i = 0; i < 100; i++) {
          throttle.canMakeRequest(Math.random() * 1000);
          if (i % 10 === 0) {
            throttle.recordUsage(Math.random() * 500);
          }
        }
      }, 100);

      console.log('Throttle stress test:', stressTest.avg.toFixed(2), 'ms for 100 operations');
      expect(stressTest.avg).toBeLessThan(5); // Should handle 100 ops in under 5ms
    });
  });

  describe('DOM Scanning Performance', () => {
    let OptimizedContentObserver;

    beforeAll(async () => {
      // Mock DOM APIs
      global.document = {
        createTreeWalker: jest.fn((root, whatToShow, filter) => ({
          nextNode: jest.fn(() => {
            // Simulate finding text nodes
            static counter = 0;
            counter++;
            if (counter > 50) {
              counter = 0;
              return null;
            }
            return {
              nodeType: 3, // TEXT_NODE
              textContent: 'Sample text to translate',
              parentElement: { tagName: 'P', classList: { contains: () => false }, hasAttribute: () => false }
            };
          })
        })),
        body: { tagName: 'BODY' }
      };

      global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
      global.NodeFilter = {
        SHOW_TEXT: 4,
        FILTER_ACCEPT: 1,
        FILTER_REJECT: 2
      };

      global.window.getComputedStyle = jest.fn(() => ({
        display: 'block',
        visibility: 'visible'
      }));

      OptimizedContentObserver = (await import('../src/lib/optimizedContentObserver.js')).OptimizedContentObserver;
    });

    test('DOM node collection performance', async () => {
      const benchmark = new PerformanceBenchmark('DOM Collection');

      const observer = new OptimizedContentObserver(() => {}, {
        enableSmartFiltering: true,
        maxBatchSize: 100
      });

      // Mock element with text nodes
      const mockElement = {
        nodeType: 1, // ELEMENT_NODE
        tagName: 'DIV',
        classList: { contains: () => false },
        hasAttribute: () => false,
        className: ''
      };

      // Benchmark DOM node collection
      const collectionPerf = await benchmark.measure(() => {
        const collector = new Set();
        observer.collectTranslatableNodesOptimized(mockElement, collector);
      }, 1000);

      console.log('DOM collection performance:', collectionPerf.avg.toFixed(2), 'ms');
      expect(collectionPerf.avg).toBeLessThan(2); // Under 2ms per collection
      expect(collectionPerf.p95).toBeLessThan(5); // 95th percentile under 5ms
    });

    test('Text node validation performance', async () => {
      const benchmark = new PerformanceBenchmark('Text Validation');

      const observer = new OptimizedContentObserver(() => {});

      const testNodes = [
        { textContent: 'Valid text to translate', parentElement: { tagName: 'P', classList: { contains: () => false } } },
        { textContent: 'A', parentElement: { tagName: 'P', classList: { contains: () => false } } }, // Too short
        { textContent: '123456', parentElement: { tagName: 'P', classList: { contains: () => false } } }, // No letters
        { textContent: 'Script content', parentElement: { tagName: 'SCRIPT', classList: { contains: () => false } } }, // Skip element
      ];

      const validationPerf = await benchmark.measure(() => {
        testNodes.forEach(node => {
          observer.isTranslatableTextNodeOptimized(node);
        });
      }, 2000);

      console.log('Text validation performance:', validationPerf.avg.toFixed(3), 'ms for 4 nodes');
      expect(validationPerf.avg).toBeLessThan(0.1); // Under 0.1ms for 4 nodes
    });
  });

  describe('Memory Usage', () => {
    test('Logger memory footprint', async () => {
      const Logger = (await import('../src/lib/logger.js')).Logger;

      const initialMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;

      // Create loggers and generate logs
      const loggers = [];
      for (let i = 0; i < 10; i++) {
        const logger = new Logger({ enableStorage: true, maxStoredLogs: 100 });
        loggers.push(logger);

        // Generate logs
        for (let j = 0; j < 50; j++) {
          logger.info('Test', `Log message ${j} with some data`, { count: j });
        }
      }

      const afterCreationMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;

      // Cleanup
      loggers.forEach(logger => logger.clearLogs());

      if (performance.memory) {
        const memoryIncrease = afterCreationMemory - initialMemory;
        console.log('Logger memory increase:', (memoryIncrease / 1024 / 1024).toFixed(2), 'MB');
        expect(memoryIncrease / 1024 / 1024).toBeLessThan(5); // Under 5MB for 10 loggers with 50 logs each
      }
    });
  });
});

describe('Integration Performance Tests', () => {
  test('End-to-end performance simulation', async () => {
    const Logger = (await import('../src/lib/logger.js')).Logger;
    const OptimizedThrottle = (await import('../src/lib/optimizedThrottle.js')).OptimizedThrottle;

    const logger = new Logger({ component: 'PerfTest' });
    const throttle = new OptimizedThrottle({ requestLimit: 10, tokenLimit: 1000 });

    const benchmark = new PerformanceBenchmark('Integration');

    // Simulate translation request workflow
    const simulateTranslationRequest = async () => {
      logger.info('Starting translation request');

      const canProceed = throttle.canMakeRequest(100);
      if (!canProceed) {
        logger.warn('Rate limit reached');
        return null;
      }

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

      throttle.recordUsage(100);
      logger.info('Translation completed');

      return 'translated text';
    };

    const integrationPerf = await benchmark.measure(simulateTranslationRequest, 50);

    console.log('Integration test performance:', integrationPerf.avg.toFixed(2), 'ms');
    expect(integrationPerf.avg).toBeLessThan(20); // Under 20ms for simulated request
  });
});