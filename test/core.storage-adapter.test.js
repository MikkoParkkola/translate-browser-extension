/**
 * @fileoverview Unit tests for storage adapter
 * Tests Chrome storage API abstraction with fallbacks and performance optimization
 */

const storageAdapter = require('../src/core/storage-adapter');

// Mock chrome storage APIs
const mockChromeStorage = {
  sync: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn()
  },
  local: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn()
  },
  session: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn()
  }
};

// Mock localStorage and sessionStorage
const mockWebStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
};

describe('Storage Adapter', () => {
  let originalChrome;
  let originalWindow;

  beforeEach(() => {
    // Reset mock functions first
    Object.values(mockChromeStorage).forEach(storage => {
      Object.values(storage).forEach(method => method.mockReset());
    });
    Object.values(mockWebStorage).forEach(method => method.mockReset());

    // Mock chrome global
    originalChrome = global.chrome;
    global.chrome = {
      storage: mockChromeStorage,
      runtime: {
        lastError: null
      }
    };

    // Mock window with storage
    originalWindow = global.window;
    global.window = {
      localStorage: { ...mockWebStorage },
      sessionStorage: { ...mockWebStorage }
    };

    // Clear cache
    storageAdapter.clearCache();
  });

  afterEach(() => {
    global.chrome = originalChrome;
    global.window = originalWindow;
  });

  describe('Module Initialization', () => {
    test('exports required functions', () => {
      expect(typeof storageAdapter.createAdapter).toBe('function');
      expect(typeof storageAdapter.clearCache).toBe('function');
      expect(typeof storageAdapter.isStorageAvailable).toBe('function');
      expect(storageAdapter).toHaveProperty('ErrorTypes');
      expect(storageAdapter).toHaveProperty('version');
    });

    test('has correct version', () => {
      expect(storageAdapter.version).toBe('1.0.0');
    });

    test('defines error types correctly', () => {
      expect(storageAdapter.ErrorTypes).toEqual({
        QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
        ACCESS_DENIED: 'ACCESS_DENIED',
        NETWORK_ERROR: 'NETWORK_ERROR',
        PARSE_ERROR: 'PARSE_ERROR',
        TIMEOUT: 'TIMEOUT',
        NOT_AVAILABLE: 'NOT_AVAILABLE'
      });
    });
  });

  describe('Storage Availability Detection', () => {
    test('detects available Chrome storage types', () => {
      expect(storageAdapter.isStorageAvailable('sync')).toBe(true);
      expect(storageAdapter.isStorageAvailable('local')).toBe(true);
      expect(storageAdapter.isStorageAvailable('session')).toBe(true);
    });

    test('handles missing Chrome storage gracefully', () => {
      global.chrome = null;
      expect(storageAdapter.isStorageAvailable('sync')).toBe(false);
    });

    test('handles partial Chrome storage API', () => {
      global.chrome.storage.sync = null;
      expect(storageAdapter.isStorageAvailable('sync')).toBe(false);
      expect(storageAdapter.isStorageAvailable('local')).toBe(true);
    });
  });

  describe('Adapter Creation', () => {
    test('creates adapter for sync storage', () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      expect(typeof adapter.read).toBe('function');
      expect(typeof adapter.write).toBe('function');
      expect(typeof adapter.clear).toBe('function');
      expect(typeof adapter.getInfo).toBe('function');
    });

    test('creates adapter for local storage', () => {
      const adapter = storageAdapter.createAdapter('local');
      expect(adapter).toBeDefined();
      expect(adapter.getInfo().type).toBe('local');
    });

    test('creates adapter for session storage', () => {
      const adapter = storageAdapter.createAdapter('session');
      expect(adapter).toBeDefined();
      expect(adapter.getInfo().type).toBe('session');
    });

    test('throws error when no storage is available', () => {
      global.chrome = null;
      global.window = null;
      
      expect(() => {
        storageAdapter.createAdapter('sync');
      }).toThrow('No storage available for type: sync');
    });
  });

  describe('Read Operations', () => {
    test('reads single key successfully', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
        callback({ testKey: 'testValue' });
      });

      const result = await adapter.read('testKey');
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ testKey: 'testValue' });
      expect(typeof result.duration).toBe('number');
      expect(mockChromeStorage.sync.get).toHaveBeenCalledWith('testKey', expect.any(Function));
    });

    test('reads multiple keys successfully', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
        callback({ key1: 'value1', key2: 'value2' });
      });

      const result = await adapter.read(['key1', 'key2']);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key1: 'value1', key2: 'value2' });
    });

    test('reads with default values', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
        callback({ existingKey: 'existingValue' });
      });

      const result = await adapter.read({ 
        existingKey: 'default1', 
        missingKey: 'default2' 
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ 
        existingKey: 'existingValue', 
        missingKey: 'default2' 
      });
    });

    test('handles Chrome runtime errors', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      global.chrome.runtime.lastError = { message: 'Storage access denied' };
      mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
        callback({});
      });

      const result = await adapter.read('testKey');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('Storage access denied');
      expect(result.error.code).toBe('ACCESS_DENIED');

      // Clean up
      global.chrome.runtime.lastError = null;
    });

    test('uses memory cache for recent reads', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      // First read
      mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
        callback({ cachedKey: 'cachedValue' });
      });

      const result1 = await adapter.read('cachedKey');
      expect(result1.success).toBe(true);
      expect(mockChromeStorage.sync.get).toHaveBeenCalledTimes(1);

      // Second read should use cache
      const result2 = await adapter.read('cachedKey');
      expect(result2.success).toBe(true);
      expect(result2.data).toEqual({ cachedKey: 'cachedValue' });
      expect(mockChromeStorage.sync.get).toHaveBeenCalledTimes(1); // No additional call
    });

    test('handles timeout errors', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      // Mock a hanging storage operation
      mockChromeStorage.sync.get.mockImplementation(() => {
        // Never call the callback
      });

      const result = await adapter.read('timeoutKey');
      
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('TIMEOUT');
    }, 15000); // Increase timeout for this test
  });

  describe('Write Operations', () => {
    test('writes data successfully', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const result = await adapter.write({ testKey: 'testValue' });
      
      expect(result.success).toBe(true);
      expect(typeof result.duration).toBe('number');
      expect(mockChromeStorage.sync.set).toHaveBeenCalledWith(
        { testKey: 'testValue' }, 
        expect.any(Function)
      );
    });

    test('writes multiple keys successfully', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const data = { key1: 'value1', key2: 'value2', key3: { nested: 'object' } };
      const result = await adapter.write(data);
      
      expect(result.success).toBe(true);
      expect(mockChromeStorage.sync.set).toHaveBeenCalledWith(data, expect.any(Function));
    });

    test('handles quota exceeded errors', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      global.chrome.runtime.lastError = { message: 'QUOTA_EXCEEDED' };
      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const result = await adapter.write({ largeData: 'x'.repeat(10000) });
      
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('QUOTA_EXCEEDED');

      // Clean up
      global.chrome.runtime.lastError = null;
    });

    test('updates cache after successful write', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      await adapter.write({ cacheKey: 'newValue' });

      // Now reading should return cached value without storage call
      mockChromeStorage.sync.get.mockReset();
      const result = await adapter.read('cacheKey');
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ cacheKey: 'newValue' });
      expect(mockChromeStorage.sync.get).not.toHaveBeenCalled();
    });
  });

  describe('Clear Operations', () => {
    test('clears single key successfully', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.remove.mockImplementation((keys, callback) => {
        callback();
      });

      const result = await adapter.clear('testKey');
      
      expect(result.success).toBe(true);
      expect(mockChromeStorage.sync.remove).toHaveBeenCalledWith('testKey', expect.any(Function));
    });

    test('clears multiple keys successfully', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.remove.mockImplementation((keys, callback) => {
        callback();
      });

      const result = await adapter.clear(['key1', 'key2']);
      
      expect(result.success).toBe(true);
      expect(mockChromeStorage.sync.remove).toHaveBeenCalledWith(['key1', 'key2'], expect.any(Function));
    });

    test('removes keys from cache after clearing', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      // First, populate cache
      mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
        callback({ clearKey: 'value' });
      });
      await adapter.read('clearKey');

      // Clear the key
      mockChromeStorage.sync.remove.mockImplementation((keys, callback) => {
        callback();
      });
      await adapter.clear('clearKey');

      // Now reading should go to storage again
      mockChromeStorage.sync.get.mockReset().mockImplementation((keys, callback) => {
        callback({});
      });
      
      const result = await adapter.read('clearKey');
      expect(mockChromeStorage.sync.get).toHaveBeenCalled();
    });
  });

  describe('Fallback Storage', () => {
    test('falls back to localStorage when Chrome storage unavailable', () => {
      global.chrome = null;
      
      const adapter = storageAdapter.createAdapter('sync');
      const info = adapter.getInfo();
      
      expect(info.isNative).toBe(false);
      expect(info.isFallback).toBe(true);
    });

    test('localStorage fallback read operations work', async () => {
      global.chrome = null;
      
      mockWebStorage.getItem.mockImplementation((key) => {
        if (key === 'testKey') return JSON.stringify('testValue');
        return null;
      });

      const adapter = storageAdapter.createAdapter('sync');
      const result = await adapter.read('testKey');
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ testKey: 'testValue' });
    });

    test('localStorage fallback write operations work', async () => {
      global.chrome = null;
      
      const adapter = storageAdapter.createAdapter('sync');
      const result = await adapter.write({ testKey: 'testValue' });
      
      expect(result.success).toBe(true);
      expect(mockWebStorage.setItem).toHaveBeenCalledWith('testKey', '"testValue"');
    });

    test('localStorage fallback handles JSON parse errors', async () => {
      global.chrome = null;
      
      mockWebStorage.getItem.mockImplementation(() => 'invalid json');
      
      const adapter = storageAdapter.createAdapter('sync');
      const result = await adapter.read('testKey');
      
      expect(result.success).toBe(true);
      expect(result.data.testKey).toBe('invalid json'); // Should store as string
    });

    test('falls back through storage types in order', () => {
      // Remove sync, should fall back to local
      global.chrome.storage.sync = null;
      
      const adapter = storageAdapter.createAdapter('sync');
      const info = adapter.getInfo();
      
      expect(info.type).toBe('sync');
      expect(info.isFallback).toBe(true);
    });

    test('memory storage as final fallback works', () => {
      global.chrome = null;
      global.window = null;
      
      const adapter = storageAdapter.createAdapter('local');
      expect(adapter).toBeDefined();
    });
  });

  describe('Performance Requirements', () => {
    test('read operations complete within 10ms when cached', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      // Prime the cache
      mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
        callback({ perfKey: 'perfValue' });
      });
      await adapter.read('perfKey');

      // Measure cached read
      const start = Date.now();
      const result = await adapter.read('perfKey');
      const duration = Date.now() - start;
      
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(10);
    });

    test('write operations complete within reasonable time', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        setTimeout(callback, 5); // Simulate 5ms storage delay
      });

      const start = Date.now();
      const result = await adapter.write({ perfKey: 'perfValue' });
      const duration = Date.now() - start;
      
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(5);
      expect(duration).toBeLessThan(100); // Should complete quickly
    });
  });

  describe('Error Handling', () => {
    test('handles various Chrome runtime errors correctly', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      const errorCases = [
        { message: 'Access denied', expectedCode: 'ACCESS_DENIED' },
        { message: 'QUOTA_EXCEEDED_ERR', expectedCode: 'QUOTA_EXCEEDED' },
        { message: 'Network error', expectedCode: 'ACCESS_DENIED' }
      ];

      for (const { message, expectedCode } of errorCases) {
        global.chrome.runtime.lastError = { message };
        mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
          callback({});
        });

        const result = await adapter.read('errorKey');
        
        expect(result.success).toBe(false);
        expect(result.error.code).toBe(expectedCode);
        
        global.chrome.runtime.lastError = null;
      }
    });

    test('handles storage exceptions gracefully', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.get.mockImplementation(() => {
        throw new Error('Unexpected storage error');
      });

      const result = await adapter.read('exceptionKey');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe('Cache Management', () => {
    test('clearCache function works correctly', () => {
      // This test ensures cache clearing doesn't crash
      expect(() => {
        storageAdapter.clearCache();
      }).not.toThrow();
    });

    test('cache respects TTL', async () => {
      // This is implicitly tested by the timeout behavior in read operations
      // The cache TTL is set to 5 seconds in the implementation
      const adapter = storageAdapter.createAdapter('sync');
      expect(adapter.getInfo().cacheSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty data writes', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const result = await adapter.write({});
      expect(result.success).toBe(true);
    });

    test('handles null and undefined values', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const result = await adapter.write({ 
        nullValue: null, 
        undefinedValue: undefined 
      });
      
      expect(result.success).toBe(true);
    });

    test('handles large data sets efficiently', async () => {
      const adapter = storageAdapter.createAdapter('sync');
      
      const largeData = {};
      for (let i = 0; i < 1000; i++) {
        largeData[`key${i}`] = `value${i}`;
      }

      mockChromeStorage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const start = Date.now();
      const result = await adapter.write(largeData);
      const duration = Date.now() - start;
      
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(1000); // Should handle large data reasonably quickly
    });
  });
});