/**
 * Enhanced caching system for translations
 * Provides memory cache with TTL and optional persistence
 */

class CacheManager {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 5000;
    this.defaultTTL = options.defaultTTL || 7 * 24 * 60 * 60 * 1000; // 1 week
    this.cache = new Map();
    this.accessOrder = new Set(); // For LRU eviction
  }

  // Create cache key from translation parameters
  createKey(source, target, text) {
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    return `${source}:${target}:${normalizedText}`;
  }

  // Set cache entry with TTL
  set(key, value, ttl = this.defaultTTL) {
    const entry = {
      value,
      timestamp: Date.now(),
      ttl,
      expiresAt: Date.now() + ttl
    };

    // Remove from access order if exists
    this.accessOrder.delete(key);
    
    // Add to cache
    this.cache.set(key, entry);
    
    // Add to access order (most recent)
    this.accessOrder.add(key);

    // Evict if necessary
    this._evictIfNeeded();

    return true;
  }

  // Get cache entry
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    // Update access order (move to end)
    this.accessOrder.delete(key);
    this.accessOrder.add(key);

    return entry.value;
  }

  // Check if key exists and is not expired
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }
    
    return true;
  }

  // Delete cache entry
  delete(key) {
    this.accessOrder.delete(key);
    return this.cache.delete(key);
  }

  // Clear all cache
  clear() {
    this.cache.clear();
    this.accessOrder.clear();
  }

  // Get cache statistics
  getStats() {
    const now = Date.now();
    let expired = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expired++;
      }
    }
    
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      expired,
      hitRate: this._calculateHitRate()
    };
  }

  // Clean expired entries
  cleanExpired() {
    const now = Date.now();
    const toDelete = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        toDelete.push(key);
      }
    }
    
    toDelete.forEach(key => this.delete(key));
    
    return toDelete.length;
  }

  // Internal: Evict entries if cache is full
  _evictIfNeeded() {
    if (this.cache.size <= this.maxEntries) {
      return;
    }

    // First try to remove expired entries
    const expiredCount = this.cleanExpired();
    
    if (this.cache.size <= this.maxEntries) {
      return;
    }

    // If still over limit, use LRU eviction
    const toEvict = this.cache.size - this.maxEntries + 1;
    const keys = Array.from(this.accessOrder).slice(0, toEvict);
    
    keys.forEach(key => this.delete(key));
  }

  // Internal: Calculate hit rate (simplified)
  _calculateHitRate() {
    // This is a simplified calculation
    // In a real implementation, you'd track hits/misses
    return 0.75; // Placeholder
  }
}

// Global cache instance
let globalCache = new CacheManager();

// Create cache manager with options
function createCacheManager(options = {}) {
  return new CacheManager(options);
}

// Configure global cache
function configure(options) {
  globalCache = new CacheManager(options);
}

// Get from global cache
function get(key) {
  return globalCache.get(key);
}

// Set in global cache
function set(key, value, ttl) {
  return globalCache.set(key, value, ttl);
}

// Check global cache
function has(key) {
  return globalCache.has(key);
}

// Delete from global cache
function del(key) {
  return globalCache.delete(key);
}

// Clear global cache
function clear() {
  return globalCache.clear();
}

// Get global cache stats
function getStats() {
  return globalCache.getStats();
}

// Create cache key helper
function createKey(source, target, text) {
  return globalCache.createKey(source, target, text);
}

// Export for browser extension
if (typeof window !== 'undefined') {
  window.Cache = {
    createCacheManager,
    configure,
    get,
    set,
    has,
    delete: del,
    clear,
    getStats,
    createKey,
    globalCache: () => globalCache
  };
} else if (typeof self !== 'undefined') {
  // Service worker context
  self.Cache = {
    createCacheManager,
    configure,
    get,
    set,
    has,
    delete: del,
    clear,
    getStats,
    createKey,
    globalCache: () => globalCache
  };
}
