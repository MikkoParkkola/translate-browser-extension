/**
 * @jest-environment jsdom
 */

// Mock Chrome storage API
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  },
  runtime: {
    lastError: null
  }
};

// Mock TextEncoder/TextDecoder
global.TextEncoder = class {
  encode(str) {
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }
};

global.TextDecoder = class {
  decode(buffer) {
    return Buffer.from(buffer).toString('utf8');
  }
};

// Mock crypto API - must be defined before any requires
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      generateKey: jest.fn(),
      exportKey: jest.fn(),
      importKey: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn()
    },
    getRandomValues: jest.fn((arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    })
  },
  writable: true
});

// Mock the security dependency
jest.mock('../../src/core/security.js', () => ({
  sanitizeInput: jest.fn(input => input),
  validateApiKey: jest.fn(() => true),
  sanitizeApiKey: jest.fn(key => key),
  sanitizeApiConfig: jest.fn(config => config),
  logSecurityEvent: jest.fn(),
  qwenSecurity: {
    sanitizeInput: jest.fn(input => input),
    validateApiKey: jest.fn(() => true),
    sanitizeApiKey: jest.fn(key => key),
    sanitizeApiConfig: jest.fn(config => config),
    logSecurityEvent: jest.fn()
  }
}));

const qwenSecureStorage = require('../../src/core/secure-storage.js');

describe('SecureStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock crypto operations
    global.crypto.subtle.generateKey.mockResolvedValue({});
    global.crypto.subtle.exportKey.mockResolvedValue(new ArrayBuffer(32));
    global.crypto.subtle.importKey.mockResolvedValue({});
    global.crypto.subtle.encrypt.mockResolvedValue(new ArrayBuffer(48));
    global.crypto.subtle.decrypt.mockResolvedValue(new TextEncoder().encode(JSON.stringify('test-value')));
    global.crypto.getRandomValues.mockReturnValue(new Uint8Array(12).fill(1));
    
    // Mock Chrome storage
    global.chrome.storage.local.get.mockImplementation((keys, callback) => {
      if (typeof callback === 'function') {
        callback({});
      }
    });
    global.chrome.storage.local.set.mockImplementation((data, callback) => {
      if (typeof callback === 'function') {
        callback();
      }
    });
    global.chrome.storage.local.remove.mockImplementation((keys, callback) => {
      if (typeof callback === 'function') {
        callback();
      }
    });
  });

  test('setSecure encrypts and stores data', async () => {
    await qwenSecureStorage.secureStorage.setSecure('testKey', 'testValue');
    
    expect(global.crypto.subtle.encrypt).toHaveBeenCalled();
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        '_secure_testKey': expect.any(Object),
        '_secure_testKey_meta': expect.objectContaining({
          encrypted: true,
          created: expect.any(Number)
        })
      }),
      expect.any(Function)
    );
  });

  test('getSecure retrieves and decrypts data', async () => {
    // Mock stored encrypted data
    global.chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({
        '_secure_testKey': {
          iv: Array.from(new Uint8Array(12).fill(1)),
          data: Array.from(new Uint8Array(32).fill(2)),
          keyId: 'default'
        },
        '_secure_testKey_meta': {
          encrypted: true,
          created: Date.now(),
          lastAccessed: Date.now()
        }
      });
    });

    const result = await qwenSecureStorage.secureStorage.getSecure('testKey');
    
    expect(global.crypto.subtle.decrypt).toHaveBeenCalled();
    expect(result).toBe('test-value');
  });

  test('getSecure returns null for non-existent key', async () => {
    global.chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({ '_secure_testKey': null });
    });

    const result = await qwenSecureStorage.secureStorage.getSecure('testKey');
    expect(result).toBeNull();
  });

  test('removeSecure deletes encrypted data and metadata', async () => {
    await qwenSecureStorage.secureStorage.removeSecure('testKey');
    
    expect(global.chrome.storage.local.remove).toHaveBeenCalledWith(
      ['_secure_testKey', '_secure_testKey_meta'],
      expect.any(Function)
    );
  });

  test('migrateSensitiveData moves plaintext keys to secure storage', async () => {
    // Mock existing plaintext data
    global.chrome.storage.sync = {
      get: jest.fn((keys, callback) => {
        callback({ apiKey: 'test-api-key' });
      }),
      remove: jest.fn((keys) => {})
    };

    await qwenSecureStorage.secureStorage.migrateSensitiveData();
    
    expect(global.crypto.subtle.encrypt).toHaveBeenCalled();
    expect(global.chrome.storage.local.set).toHaveBeenCalled();
  });

  test('legacy getSecureApiKey function works with migration', async () => {
    // Mock no secure storage data initially
    let mockStorageData = {};
    global.chrome.storage.local.get.mockImplementation((keys, callback) => {
      const result = {};
      Object.keys(keys).forEach(key => {
        result[key] = mockStorageData[key] || keys[key];
      });
      callback(result);
    });

    // Mock sync storage with legacy API key
    global.chrome.storage.sync = {
      get: jest.fn((keys, callback) => {
        callback({ apiKey: 'legacy-api-key' });
      }),
      remove: jest.fn()
    };

    // Mock the setSecure method to update our mock storage
    global.chrome.storage.local.set.mockImplementation((data, callback) => {
      Object.assign(mockStorageData, data);
      callback();
    });

    const result = await qwenSecureStorage.getSecureApiKey();
    
    expect(result).toBe('legacy-api-key');
    expect(global.chrome.storage.local.set).toHaveBeenCalled();
    expect(global.chrome.storage.sync.remove).toHaveBeenCalledWith(['apiKey']);
  });
});