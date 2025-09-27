/**
 * @fileoverview Multi-tier cache manager with TTL, LRU eviction, and memory limits
 * Provides high-performance caching with persistent storage and intelligent eviction policies
 */

(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    root.qwenCoreCache = mod;
  }
}(typeof self !== 'undefined' ? self : this, function (root) {

  // Import types and logger for JSDoc
  /// <reference path="./types.js" />
  /// <reference path="./logger.js" />

  /**
   * Cache error types
   */
  const CACHE_ERRORS = {
    SERIALIZATION_ERROR: 'SERIALIZATION_ERROR',
    STORAGE_ERROR: 'STORAGE_ERROR',
    CACHE_FULL: 'CACHE_FULL',
    INVALID_KEY: 'INVALID_KEY',
    INVALID_TTL: 'INVALID_TTL'
  };

  /**
   * Default configuration values
   */
  const DEFAULT_CONFIG = {
    maxMemoryEntries: 1000,
    maxMemorySize: 5 * 1024 * 1024, // 5MB
    defaultTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
    persistentStorage: true,
    compressionEnabled: true,
    evictionBatchSize: 100,
    persistenceDebounceMs: 100
  };

  /**
   * LRU node for doubly-linked list
   * @typedef {Object} LRUNode
   * @property {string} key - Cache key
   * @property {*} value - Cache value
   * @property {number} timestamp - Creation timestamp
   * @property {number} lastAccessed - Last access timestamp
   * @property {number} accessCount - Access count
   * @property {number} ttl - Time to live
   * @property {number} size - Entry size in bytes
   * @property {LRUNode|null} prev - Previous node
   * @property {LRUNode|null} next - Next node
   */

  /**
   * Cache statistics
   * @typedef {Object} CacheStats
   * @property {number} memoryEntries - Number of entries in memory cache
   * @property {number} memorySize - Total memory cache size in bytes
   * @property {number} hits - Cache hit count
   * @property {number} misses - Cache miss count
   * @property {number} evictions - Eviction count
   * @property {number} compressionErrors - Compression error count
   * @property {number} storageErrors - Storage error count
   * @property {number} hitRate - Cache hit rate (0-1)
   */

  /**
   * Create a secure hash of the cache key to prevent enumeration
   * @param {string} key - Original key
   * @returns {string} Hashed key
   */
  function hashKey(key) {
    if (typeof key !== 'string') {
      throw new Error(`${CACHE_ERRORS.INVALID_KEY}: Key must be a string`);
    }
    
    // Simple hash function for key obfuscation
    let hash = 0;
    if (key.length === 0) return hash.toString();
    
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return `qwen_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Get LZ-String compression library
   * @returns {Object|null} LZ-String instance or null if not available
   */
  function getLZString() {
    if (typeof window !== 'undefined' && window.LZString) {
      return window.LZString;
    }
    if (typeof self !== 'undefined' && self.LZString) {
      return self.LZString;
    }
    // Node.js environments
    try {
      return require('lz-string');
    } catch {
      try {
        return require('./lz-string.min.js');
      } catch {
        return null;
      }
    }
  }

  /**
   * Calculate approximate size of an object in bytes
   * @param {*} obj - Object to measure
   * @returns {number} Approximate size in bytes
   */
  function getObjectSize(obj) {
    const seen = new WeakSet();
    
    function sizeOf(obj) {
      if (obj === null || obj === undefined) return 0;
      
      switch (typeof obj) {
        case 'boolean': return 4;
        case 'number': return 8;
        case 'string': return obj.length * 2;
        case 'object':
          if (seen.has(obj)) return 0;
          seen.add(obj);
          
          let size = 0;
          if (Array.isArray(obj)) {
            size = 16; // Array overhead
            for (let i = 0; i < obj.length; i++) {
              size += sizeOf(obj[i]);
            }
          } else {
            size = 16; // Object overhead
            for (const key in obj) {
              if (obj.hasOwnProperty(key)) {
                size += key.length * 2; // Key size
                size += sizeOf(obj[key]); // Value size
              }
            }
          }
          return size;
        default:
          return 8;
      }
    }
    
    return sizeOf(obj);
  }

  /**
   * Create cache manager instance
   * @param {Object} [config] - Cache configuration
   * @returns {Promise<Object>} Cache manager instance
   */
  async function createCacheManager(config = {}) {
    const logger = (root.qwenCoreLogger && root.qwenCoreLogger.create) 
      ? root.qwenCoreLogger.create('cache-manager') 
      : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

    const cfg = { ...DEFAULT_CONFIG, ...config };
    try {
      logger.info('Initializing cache manager', {
        maxMemoryEntries: cfg.maxMemoryEntries,
        maxMemorySize: cfg.maxMemorySize,
        persistentStorage: cfg.persistentStorage,
        compressionEnabled: cfg.compressionEnabled,
      });
    } catch {}
    const LZString = getLZString();
    
    // Memory cache (LRU doubly-linked list + HashMap)
    const cache = new Map();
    let head = null; // Most recently used
    let tail = null; // Least recently used
    let totalSize = 0;
    
    // Statistics
    let hits = 0;
    let misses = 0;
    let evictions = 0;
    let compressionErrors = 0;
    let storageErrors = 0;
    
    // Persistence management
    let persistenceTimer = null;
    let persistenceDirty = false;
    let persistenceReady = Promise.resolve();
    
    // Initialize persistent storage
    if (cfg.persistentStorage) {
      persistenceReady = initializePersistentStorage();
    }

    /**
     * Initialize persistent storage
     * @returns {Promise<void>}
     */
    async function initializePersistentStorage() {
      try {
        let storedData = {};
        
        // Try Chrome storage API first
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const result = await new Promise((resolve) => {
            chrome.storage.local.get(['qwenCache'], resolve);
          });
          storedData = result.qwenCache || {};
        } 
        // Fallback to localStorage
        else if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
          const raw = globalThis.localStorage.getItem('qwenCache');
          if (raw) {
            try {
              storedData = JSON.parse(raw);
            } catch (error) {
              logger.warn('Failed to parse localStorage cache data:', error);
              // Clear corrupted data
              globalThis.localStorage.removeItem('qwenCache');
            }
          }
        }

        // Load valid entries from persistent storage
        const now = Date.now();
        let loadedCount = 0;
        
        for (const [hashedKey, encodedValue] of Object.entries(storedData)) {
          try {
            const entry = decodeCacheValue(encodedValue);
            if (entry && isValidCacheEntry(entry, now)) {
              // Create LRU node
              const node = createLRUNode(hashedKey, entry.value, entry);
              insertAtHead(node);
              cache.set(hashedKey, node);
              totalSize += node.size;
              loadedCount++;
            }
          } catch (error) {
            logger.debug('Failed to load cache entry:', hashedKey, error);
          }
        }

        logger.info(`Loaded ${loadedCount} cache entries from persistent storage`);
        
        // Clean up memory if needed
        await enforceMemoryLimits();
        
      } catch (error) {
        logger.error('Failed to initialize persistent storage:', error);
      }
    }

    /**
     * Check if cache entry is valid
     * @param {Object} entry - Cache entry
     * @param {number} now - Current timestamp
     * @returns {boolean} True if valid
     */
    function isValidCacheEntry(entry, now) {
      return entry && 
             typeof entry.value !== 'undefined' &&
             entry.timestamp &&
             (!entry.ttl || now - entry.timestamp <= entry.ttl);
    }

    /**
     * Encode cache value with optional compression
     * @param {*} value - Value to encode
     * @returns {string} Encoded value
     */
    function encodeCacheValue(value) {
      try {
        const json = JSON.stringify(value);
        if (LZString && cfg.compressionEnabled) {
          const compressed = LZString.compressToUTF16(json);
          return compressed || json; // Fallback to uncompressed if compression fails
        }
        return json;
      } catch (error) {
        compressionErrors++;
        logger.warn('Cache value encoding failed:', error);
        // Return original value as fallback
        return typeof value === 'string' ? value : String(value);
      }
    }

    /**
     * Decode cache value with decompression
     * @param {string} encodedValue - Encoded value
     * @returns {*} Decoded value
     */
    function decodeCacheValue(encodedValue) {
      if (typeof encodedValue !== 'string') {
        return encodedValue;
      }

      try {
        // Try decompression first if LZString is available
        if (LZString && cfg.compressionEnabled) {
          try {
            const decompressed = LZString.decompressFromUTF16(encodedValue);
            if (decompressed) {
              return JSON.parse(decompressed);
            }
          } catch {
            // Fallback to direct JSON parsing
          }
        }
        
        // Try direct JSON parsing
        return JSON.parse(encodedValue);
      } catch (error) {
        compressionErrors++;
        logger.warn('Cache value decoding failed:', error);
        return null;
      }
    }

    /**
     * Create new LRU node
     * @param {string} key - Cache key
     * @param {*} value - Cache value
     * @param {Object} [metadata] - Additional metadata
     * @returns {LRUNode} New LRU node
     */
    function createLRUNode(key, value, metadata = {}) {
      const now = Date.now();
      const size = getObjectSize(value) + key.length * 2;
      
      return {
        key,
        value,
        timestamp: metadata.timestamp || now,
        lastAccessed: now,
        accessCount: metadata.accessCount || 1,
        ttl: metadata.ttl || cfg.defaultTTL,
        size,
        prev: null,
        next: null
      };
    }

    /**
     * Insert node at head of LRU list
     * @param {LRUNode} node - Node to insert
     */
    function insertAtHead(node) {
      if (!head) {
        head = tail = node;
      } else {
        node.next = head;
        head.prev = node;
        head = node;
      }
    }

    /**
     * Remove node from LRU list
     * @param {LRUNode} node - Node to remove
     */
    function removeNode(node) {
      if (node.prev) {
        node.prev.next = node.next;
      } else {
        head = node.next;
      }

      if (node.next) {
        node.next.prev = node.prev;
      } else {
        tail = node.prev;
      }
    }

    /**
     * Move node to head of LRU list
     * @param {LRUNode} node - Node to move
     */
    function moveToHead(node) {
      if (node === head) return;
      
      removeNode(node);
      insertAtHead(node);
    }

    /**
     * Enforce memory limits by evicting LRU entries
     * @returns {Promise<void>}
     */
    async function enforceMemoryLimits() {
      const evictedEntries = [];
      
      // Evict entries that exceed memory limits
      while ((cache.size > cfg.maxMemoryEntries || totalSize > cfg.maxMemorySize) && tail) {
        const node = tail;
        
        removeNode(node);
        cache.delete(node.key);
        totalSize -= node.size;
        evictions++;
        evictedEntries.push(node.key);
        
        // Stop once limits are satisfied
        if (cache.size <= cfg.maxMemoryEntries && totalSize <= cfg.maxMemorySize) {
          break;
        }
        
        // Batch evictions for performance
        if (evictedEntries.length >= cfg.evictionBatchSize) {
          break;
        }
      }

      if (evictedEntries.length > 0) {
        logger.debug(`Evicted ${evictedEntries.length} cache entries`);
        await schedulePersistence();
      }
    }

    /**
     * Schedule persistence operation with debouncing
     * @returns {Promise<void>}
     */
    async function schedulePersistence() {
      if (!cfg.persistentStorage) return;
      
      persistenceDirty = true;
      
      if (persistenceTimer) {
        clearTimeout(persistenceTimer);
      }
      
      persistenceTimer = setTimeout(async () => {
        if (persistenceDirty) {
          await persistToStorage();
          persistenceDirty = false;
        }
        persistenceTimer = null;
      }, cfg.persistenceDebounceMs);
    }

    /**
     * Persist cache to storage
     * @returns {Promise<void>}
     */
    async function persistToStorage() {
      try {
        const cacheData = {};
        
        // Serialize cache entries
        for (const [hashedKey, node] of cache) {
          try {
            const entryData = {
              value: node.value,
              timestamp: node.timestamp,
              lastAccessed: node.lastAccessed,
              accessCount: node.accessCount,
              ttl: node.ttl
            };
            cacheData[hashedKey] = encodeCacheValue(entryData);
          } catch (error) {
            logger.warn('Failed to serialize cache entry:', hashedKey, error);
          }
        }

        // Persist to storage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await new Promise((resolve, reject) => {
            chrome.storage.local.set({ qwenCache: cacheData }, () => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          });
        } 
        else if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
          globalThis.localStorage.setItem('qwenCache', JSON.stringify(cacheData));
        }

        logger.debug(`Persisted ${Object.keys(cacheData).length} cache entries`);
        
      } catch (error) {
        storageErrors++;
        logger.error('Failed to persist cache to storage:', error);
      }
    }

    /**
     * Get cache entry
     * @param {string} key - Cache key
     * @returns {*|undefined} Cached value or undefined if not found/expired
     */
    function get(key) {
      const start = performance.now ? performance.now() : Date.now();
      
      try {
        const hashedKey = hashKey(key); // This will throw if key is invalid
        const node = cache.get(hashedKey);
        
        if (!node) {
          misses++;
          return undefined;
        }

        const now = Date.now();
        
        // Check TTL
        if (node.ttl && node.ttl > 0 && now - node.timestamp > node.ttl) {
          // Expired entry
          removeNode(node);
          cache.delete(hashedKey);
          totalSize -= node.size;
          misses++;
          schedulePersistence();
          return undefined;
        }

        // Update access statistics
        node.lastAccessed = now;
        node.accessCount++;
        moveToHead(node);
        hits++;

        const duration = (performance.now ? performance.now() : Date.now()) - start;
        if (duration > 1) { // Log slow cache operations
          logger.warn(`Slow cache get operation: ${duration.toFixed(2)}ms`);
        }

        return node.value;
        
      } catch (error) {
        if (error.message && error.message.includes('INVALID_KEY')) {
          throw error; // Re-throw validation errors
        }
        logger.error('Cache get operation failed:', error);
        misses++;
        return undefined;
      }
    }

    /**
     * Set cache entry
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {number} [ttl] - Time to live in milliseconds
     * @returns {Promise<boolean>} True if set successfully
     */
    async function set(key, value, ttl) {
      const start = performance.now ? performance.now() : Date.now();
      
      try {
        if (typeof ttl === 'number' && (ttl < 0 || !isFinite(ttl))) {
          throw new Error(`${CACHE_ERRORS.INVALID_TTL}: TTL must be a positive finite number`);
        }

        const hashedKey = hashKey(key);
        const existingNode = cache.get(hashedKey);
        
        // Remove existing entry
        if (existingNode) {
          removeNode(existingNode);
          totalSize -= existingNode.size;
        }

        // Test serialization to catch circular references early
        try {
          JSON.stringify(value);
        } catch (serializationError) {
          if (serializationError.message && serializationError.message.includes('circular')) {
            logger.warn('Cannot cache value with circular references:', key);
            return false;
          }
          // Other serialization errors might be due to complex objects - continue
        }
        
        // Create new node
        const node = createLRUNode(hashedKey, value, { ttl: ttl || cfg.defaultTTL });
        
        // Check if entry is too large for the cache entirely
        if (node.size > cfg.maxMemorySize) {
          logger.warn(`Entry too large for cache: ${node.size} bytes`, { key });
          return false;
        }

        // Insert new entry
        insertAtHead(node);
        cache.set(hashedKey, node);
        totalSize += node.size;

        // Enforce memory limits after insertion (this will evict LRU entries if needed)
        await enforceMemoryLimits();

        await schedulePersistence();

        const duration = (performance.now ? performance.now() : Date.now()) - start;
        if (duration > 5) { // Log slow cache operations
          logger.warn(`Slow cache set operation: ${duration.toFixed(2)}ms`);
        }

        return true;
        
      } catch (error) {
        logger.error('Cache set operation failed:', error);
        return false;
      }
    }

    /**
     * Delete cache entry
     * @param {string} key - Cache key
     * @returns {Promise<boolean>} True if deleted successfully
     */
    async function deleteEntry(key) {
      try {
        const hashedKey = hashKey(key);
        const node = cache.get(hashedKey);
        
        if (!node) {
          return false;
        }

        removeNode(node);
        cache.delete(hashedKey);
        totalSize -= node.size;

        await schedulePersistence();
        return true;
        
      } catch (error) {
        logger.error('Cache delete operation failed:', error);
        return false;
      }
    }

    /**
     * Clear all cache entries
     * @returns {Promise<void>}
     */
    async function clear() {
      try {
        cache.clear();
        head = tail = null;
        totalSize = 0;
        hits = misses = evictions = 0;
        compressionErrors = storageErrors = 0;

        // Clear persistent storage
        if (cfg.persistentStorage) {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await new Promise((resolve) => {
              chrome.storage.local.remove('qwenCache', resolve);
            });
          } else if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
            globalThis.localStorage.removeItem('qwenCache');
          }
        }

        logger.info('Cache cleared successfully');
        
      } catch (error) {
        logger.error('Cache clear operation failed:', error);
      }
    }

    /**
     * Get cache statistics
     * @returns {CacheStats} Cache statistics
     */
    function getStats() {
      const total = hits + misses;
      return {
        memoryEntries: cache.size,
        memorySize: totalSize,
        hits,
        misses,
        evictions,
        compressionErrors,
        storageErrors,
        hitRate: total > 0 ? hits / total : 0
      };
    }

    // Clean up on environment shutdown
    function cleanup() {
      if (persistenceTimer) {
        clearTimeout(persistenceTimer);
        persistenceTimer = null;
      }
      
      // Final persistence if needed
      if (persistenceDirty && cfg.persistentStorage) {
        persistToStorage().catch(() => {}); // Best effort, ignore errors
      }
    }

    // Register cleanup handlers
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', cleanup);
    } else if (typeof process !== 'undefined') {
      process.on('exit', cleanup);
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    }

    // Wait for initialization to complete
    await persistenceReady;

    // Public API
    return {
      get,
      set,
      delete: deleteEntry,
      clear,
      getStats,
      
      // Configuration
      configure(newConfig) {
        Object.assign(cfg, newConfig);
        logger.debug('Cache configuration updated:', newConfig);
      },
      
      // Utility methods for testing
      _getInternalState() {
        return {
          cache: cache,
          head,
          tail,
          totalSize,
          config: cfg
        };
      }
    };
  }

  // Export cache manager factory and error types
  return {
    createCacheManager,
    CACHE_ERRORS,
    DEFAULT_CONFIG,
    version: '1.0.0'
  };

}));
