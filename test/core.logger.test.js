/**
 * @fileoverview Unit tests for core logger system
 * Tests centralized logging with context awareness and sensitive data sanitization
 */

const logger = require('../src/core/logger');

describe('Core Logger', () => {
  let consoleSpies;
  let mockCollector;
  let removeCollector;

  beforeEach(() => {
    // Spy on console methods
    consoleSpies = {
      debug: jest.spyOn(console, 'debug').mockImplementation(),
      info: jest.spyOn(console, 'info').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };

    // Set up collector
    mockCollector = jest.fn();
    removeCollector = logger.addCollector(mockCollector);
  });

  afterEach(() => {
    // Clean up spies
    Object.values(consoleSpies).forEach(spy => spy.mockRestore());
    
    // Remove collector
    if (removeCollector) removeCollector();
  });

  describe('Module Initialization', () => {
    test('exports required functions', () => {
      expect(typeof logger.create).toBe('function');
      expect(typeof logger.setLevel).toBe('function');
      expect(typeof logger.addCollector).toBe('function');
      expect(typeof logger.parseLevel).toBe('function');
      expect(logger).toHaveProperty('LEVELS');
      expect(logger).toHaveProperty('version');
    });

    test('has correct version', () => {
      expect(logger.version).toBe('1.0.0');
    });

    test('defines log levels correctly', () => {
      expect(logger.LEVELS).toEqual({
        error: 0,
        warn: 1,
        info: 2,
        debug: 3
      });
    });
  });

  describe('Logger Creation', () => {
    test('creates logger with namespace', () => {
      const testLogger = logger.create('test');
      
      expect(typeof testLogger.debug).toBe('function');
      expect(typeof testLogger.info).toBe('function');
      expect(typeof testLogger.warn).toBe('function');
      expect(typeof testLogger.error).toBe('function');
      expect(typeof testLogger.setLevel).toBe('function');
      expect(typeof testLogger.level).toBe('function');
      expect(typeof testLogger.create).toBe('function');
    });

    test('creates child logger with extended namespace', () => {
      const parentLogger = logger.create('parent');
      const childLogger = parentLogger.create('child');
      
      // Set log level to info so messages are output
      parentLogger.setLevel('info');
      childLogger.setLevel('info');
      
      // Test that child namespace is properly formed
      childLogger.info('test message');
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[parent:child] test message');
    });

    test('handles empty namespace gracefully', () => {
      const testLogger = logger.create('');
      
      // Set log level to info so messages are output
      testLogger.setLevel('info');
      
      testLogger.info('test');
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[] test');
    });
  });

  describe('Log Level Parsing', () => {
    test('parses string levels correctly', () => {
      expect(logger.parseLevel('error')).toBe(0);
      expect(logger.parseLevel('warn')).toBe(1);
      expect(logger.parseLevel('info')).toBe(2);
      expect(logger.parseLevel('debug')).toBe(3);
    });

    test('parses numeric levels correctly', () => {
      expect(logger.parseLevel(0)).toBe(0);
      expect(logger.parseLevel(1)).toBe(1);
      expect(logger.parseLevel(2)).toBe(2);
      expect(logger.parseLevel(3)).toBe(3);
    });

    test('handles invalid levels with default', () => {
      expect(logger.parseLevel('invalid')).toBe(1); // warn
      expect(logger.parseLevel(-1)).toBe(0); // clamps to error
      expect(logger.parseLevel(10)).toBe(3); // clamps to debug
      expect(logger.parseLevel(null)).toBe(1); // warn
      expect(logger.parseLevel(undefined)).toBe(1); // warn
    });

    test('handles case insensitive string levels', () => {
      expect(logger.parseLevel('ERROR')).toBe(0);
      expect(logger.parseLevel('Warn')).toBe(1);
      expect(logger.parseLevel('INFO')).toBe(2);
      expect(logger.parseLevel('Debug')).toBe(3);
    });
  });

  describe('Log Level Filtering', () => {
    test('respects log levels for filtering', () => {
      const testLogger = logger.create('test');
      
      // Set to warn level (1)
      testLogger.setLevel(1);
      
      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');
      
      // Only warn and error should be logged
      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.warn).toHaveBeenCalledWith('[test] warn message');
      expect(consoleSpies.error).toHaveBeenCalledWith('[test] error message');
    });

    test('error messages are always logged regardless of level', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(0); // error only
      
      testLogger.error('critical error');
      expect(consoleSpies.error).toHaveBeenCalledWith('[test] critical error');
    });

    test('debug level logs everything', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3); // debug
      
      testLogger.debug('debug');
      testLogger.info('info');
      testLogger.warn('warn');
      testLogger.error('error');
      
      expect(consoleSpies.debug).toHaveBeenCalledWith('[test] debug');
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] info');
      expect(consoleSpies.warn).toHaveBeenCalledWith('[test] warn');
      expect(consoleSpies.error).toHaveBeenCalledWith('[test] error');
    });
  });

  describe('Sensitive Data Sanitization', () => {
    test('redacts API keys from strings', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const sensitiveData = 'apiKey: sk-1234567890abcdef';
      testLogger.info(sensitiveData);
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] apiKey: <redacted>');
    });

    test('redacts various sensitive key patterns', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const patterns = [
        'api-key: secret123',
        'authorization: Bearer token123',
        'token: xyz789',
        'password: mypassword',
        'secret: topsecret'
      ];
      
      patterns.forEach(pattern => {
        testLogger.info(pattern);
      });
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] api-key: <redacted>');
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] authorization: <redacted>');
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] token: <redacted>');
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] password: <redacted>');
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] secret: <redacted>');
    });

    test('redacts sensitive properties from objects', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const sensitiveObj = {
        apiKey: 'secret123',
        username: 'user',
        token: 'token123',
        data: 'safe data'
      };
      
      testLogger.info(sensitiveObj);
      
      const loggedArgs = consoleSpies.info.mock.calls[0];
      expect(loggedArgs[0]).toBe('[test]');
      expect(loggedArgs[1]).toEqual({
        apiKey: '<redacted>',
        username: 'user',
        token: '<redacted>',
        data: 'safe data'
      });
    });

    test('redacts sensitive data from errors', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const error = new Error('API failed');
      error.apiKey = 'secret123';
      error.details = 'safe details';
      
      testLogger.error(error);
      
      const loggedArgs = consoleSpies.error.mock.calls[0];
      expect(loggedArgs[1]).toMatchObject({
        name: 'Error',
        message: 'API failed',
        apiKey: '<redacted>',
        details: 'safe details'
      });
    });

    test('handles nested objects with sensitive data', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const nestedObj = {
        config: {
          apiKey: 'secret',
          endpoint: 'https://api.example.com'
        },
        metadata: {
          version: '1.0'
        }
      };
      
      testLogger.info(nestedObj);
      
      const loggedArgs = consoleSpies.info.mock.calls[0];
      expect(loggedArgs[1]).toEqual({
        config: {
          apiKey: '<redacted>',
          endpoint: 'https://api.example.com'
        },
        metadata: {
          version: '1.0'
        }
      });
    });
  });

  describe('Message Formatting', () => {
    test('formats string messages with namespace', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      testLogger.info('Hello world');
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] Hello world');
    });

    test('formats object messages with namespace', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const obj = { key: 'value' };
      testLogger.info(obj);
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[test]', obj);
    });

    test('formats mixed arguments correctly', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      testLogger.info('Message:', { data: 'test' }, 'extra');
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] Message:', { data: 'test' }, 'extra');
    });

    test('handles empty message lists', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      testLogger.info();
      expect(consoleSpies.info).toHaveBeenCalledWith('[test]');
    });
  });

  describe('Performance Timing', () => {
    test('time method measures async operations', async () => {
      const testLogger = logger.create('test');
      
      const result = await testLogger.time(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      });
      
      expect(result.result).toBe('success');
      expect(typeof result.ms).toBe('number');
      expect(result.ms).toBeGreaterThan(0);
    });

    test('time method handles errors and preserves timing', async () => {
      const testLogger = logger.create('test');
      
      try {
        await testLogger.time(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error('Test error');
        });
      } catch (error) {
        expect(error.message).toBe('Test error');
        expect(typeof error.latencyMs).toBe('number');
        expect(error.latencyMs).toBeGreaterThan(0);
      }
    });

    test('perfStart and perfEnd methods work correctly', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      testLogger.perfStart('test operation');
      const elapsed = testLogger.perfEnd('test operation');
      
      expect(typeof elapsed).toBe('number');
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Collector System', () => {
    test('emits log entries to collectors', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      testLogger.info('test message');
      
      expect(mockCollector).toHaveBeenCalledWith({
        timestamp: expect.any(Number),
        level: 'info',
        namespace: 'test',
        args: ['test message']
      });
    });

    test('collector removal works correctly', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      // Remove collector
      removeCollector();
      
      testLogger.info('test message');
      
      // Should not have been called after removal
      expect(mockCollector).not.toHaveBeenCalled();
    });

    test('handles collector errors gracefully', () => {
      const faultyCollector = jest.fn(() => {
        throw new Error('Collector error');
      });
      
      const removeFaulty = logger.addCollector(faultyCollector);
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      // Should not throw despite collector error
      expect(() => {
        testLogger.info('test message');
      }).not.toThrow();
      
      removeFaulty();
    });
  });

  describe('Specialized Logging Methods', () => {
    test('logBatchTime method works correctly', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(2); // info level
      
      testLogger.logBatchTime(150);
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] Batch processed', { batchTimeMs: 150 });
    });

    test('logQueueLatency method works correctly', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(2); // info level
      
      testLogger.logQueueLatency(75);
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] Queue latency', { queueLatencyMs: 75 });
    });

    test('batch and queue logging respects level', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(1); // warn level (below info)
      
      testLogger.logBatchTime(150);
      testLogger.logQueueLatency(75);
      
      expect(consoleSpies.info).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    test('handles circular references in objects', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const circular = { name: 'test' };
      circular.self = circular;
      
      // Should not crash on circular reference
      expect(() => {
        testLogger.info(circular);
      }).not.toThrow();
      
      // Should have logged with circular reference handled
      const loggedArgs = consoleSpies.info.mock.calls[0];
      expect(loggedArgs[1]).toHaveProperty('name', 'test');
      expect(loggedArgs[1]).toHaveProperty('self', '[Circular]');
    });

    test('handles null and undefined values', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      testLogger.info(null);
      testLogger.info(undefined);
      testLogger.info('message', null, undefined);
      
      expect(consoleSpies.info).toHaveBeenCalledWith('[test]', null);
      expect(consoleSpies.info).toHaveBeenCalledWith('[test]', undefined);
      expect(consoleSpies.info).toHaveBeenCalledWith('[test] message', null, undefined);
    });

    test('handles very large objects efficiently', () => {
      const testLogger = logger.create('test');
      testLogger.setLevel(3);
      
      const largeObj = {};
      for (let i = 0; i < 1000; i++) {
        largeObj[`key${i}`] = `value${i}`;
      }
      
      const start = Date.now();
      testLogger.info(largeObj);
      const duration = Date.now() - start;
      
      // Should complete quickly (< 100ms for performance requirement)
      expect(duration).toBeLessThan(100);
    });
  });
});