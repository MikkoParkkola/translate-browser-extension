/**
 * @fileoverview Legacy adapter for backward compatibility
 * Provides the same API as the original cache.js and throttle.js for existing code
 */

(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    root.qwenLegacyAdapter = mod;
  }
}(typeof self !== 'undefined' ? self : this, function (root) {

  // Import core modules
  const cacheManager = root.qwenCoreCache || (typeof require !== 'undefined' ? require('./cache-manager') : null);
  const throttleManager = root.qwenCoreThrottle || (typeof require !== 'undefined' ? require('./throttle-manager') : null);

  let globalCache = null;
  let globalThrottle = null;

  /**
   * Initialize legacy cache adapter with original cache.js API
   * @returns {Promise<Object>} Legacy cache API
   */
  async function initializeLegacyCache() {
    if (!globalCache && cacheManager) {
      globalCache = await cacheManager.createCacheManager({
        maxMemoryEntries: 1000,
        maxMemorySize: 5 * 1024 * 1024, // 5MB
        defaultTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
        persistentStorage: true
      });
    }

    // Legacy API compatibility layer
    const legacyAPI = {
      // Original cache functions
      getCache(key) {
        return globalCache ? globalCache.get(key) : undefined;
      },
      
      setCache(key, value, origin) {
        if (globalCache) {
          const entry = { ...value, origin: origin || value.domain, ts: Date.now() };
          return globalCache.set(key, entry);
        }
        return Promise.resolve(false);
      },
      
      removeCache(key) {
        return globalCache ? globalCache.delete(key) : Promise.resolve(false);
      },
      
      qwenClearCache() {
        return globalCache ? globalCache.clear() : Promise.resolve();
      },
      
      qwenGetCacheSize() {
        if (globalCache) {
          const stats = globalCache.getStats();
          return stats.memoryEntries;
        }
        return 0;
      },
      
      qwenGetCompressionErrors() {
        if (globalCache) {
          const stats = globalCache.getStats();
          return stats.compressionErrors;
        }
        return 0;
      },
      
      qwenGetCacheStats() {
        if (globalCache) {
          const stats = globalCache.getStats();
          return {
            hits: stats.hits,
            misses: stats.misses,
            hitRate: stats.hitRate
          };
        }
        return { hits: 0, misses: 0, hitRate: 0 };
      },
      
      qwenGetDomainCounts() {
        // This would require tracking domains in the new cache system
        // For now, return empty object for compatibility
        return {};
      },
      
      qwenClearCacheDomain(domain) {
        // Would need to be implemented with metadata filtering
        return Promise.resolve();
      },
      
      qwenClearCacheLangPair(source, target) {
        // Would need to be implemented with key pattern matching
        return Promise.resolve();
      },
      
      qwenSetCacheLimit(n) {
        if (globalCache) {
          globalCache.configure({ maxMemoryEntries: n });
        }
      },
      
      qwenSetCacheTTL(ms) {
        if (globalCache) {
          globalCache.configure({ defaultTTL: ms });
        }
      },
      
      qwenResetCacheStats() {
        // Would need to be implemented in the core cache manager
        // For now, no-op for compatibility
      },
      
      // Promise for initialization
      cacheReady: Promise.resolve()
    };

    return legacyAPI;
  }

  /**
   * Initialize legacy throttle adapter with original throttle.js API
   * @returns {Object} Legacy throttle API
   */
  function initializeLegacyThrottle() {
    if (!globalThrottle && throttleManager) {
      globalThrottle = throttleManager.createThrottleManager();
      
      // Configure default provider for backward compatibility
      globalThrottle.configure('default', {
        requestLimit: 60,
        tokenLimit: 100000,
        windowMs: 60000
      });
    }

    // Legacy API compatibility layer
    const legacyAPI = {
      runWithRateLimit(fn, text, opts = {}) {
        if (!globalThrottle) {
          return Promise.resolve(fn());
        }
        
        const tokens = typeof text === 'number' ? text : throttleManager.approximateTokens(text);
        
        return globalThrottle.requestPermission('default', tokens)
          .then(() => fn())
          .catch(error => {
            if (opts.immediate) {
              throw error;
            }
            // Retry logic would go here for legacy compatibility
            return fn();
          });
      },
      
      runWithRetry(fn, text, attempts = 6, debug = false) {
        const tokens = typeof text === 'number' ? text : throttleManager.approximateTokens(text);
        let retries = 0;
        
        const tryRequest = async () => {
          try {
            if (globalThrottle) {
              await globalThrottle.requestPermission('default', tokens);
            }
            return await fn();
          } catch (error) {
            if (retries < attempts - 1) {
              retries++;
              const delay = Math.min(500 * Math.pow(2, retries), 60000);
              await new Promise(resolve => setTimeout(resolve, delay));
              return tryRequest();
            }
            throw error;
          }
        };
        
        return tryRequest();
      },
      
      configure(opts = {}) {
        if (globalThrottle) {
          globalThrottle.configure('default', {
            requestLimit: opts.requestLimit || 60,
            tokenLimit: opts.tokenLimit || 100000,
            windowMs: opts.windowMs || 60000
          });
        }
      },
      
      getUsage() {
        if (globalThrottle) {
          const usage = globalThrottle.getUsage('default');
          return {
            requests: usage.requests,
            tokens: usage.tokens,
            requestLimit: usage.requestLimit,
            tokenLimit: usage.tokenLimit,
            totalRequests: usage.totalRequests,
            totalTokens: usage.totalTokens,
            queue: usage.queueSize
          };
        }
        return {
          requests: 0,
          tokens: 0,
          requestLimit: 60,
          tokenLimit: 100000,
          totalRequests: 0,
          totalTokens: 0,
          queue: 0
        };
      },
      
      reset() {
        if (globalThrottle) {
          globalThrottle.resetUsage('default');
        }
      },
      
      approxTokens: throttleManager ? throttleManager.approximateTokens : (text) => Math.ceil((text || '').length / 4),
      
      // Factory function for creating additional throttles
      createThrottle(opts = {}) {
        if (!throttleManager) {
          return this; // Fallback to global throttle
        }
        
        const newThrottle = throttleManager.createThrottleManager();
        const providerId = `throttle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        newThrottle.configure(providerId, {
          requestLimit: opts.requestLimit || 60,
          tokenLimit: opts.tokenLimit || 100000,
          windowMs: opts.windowMs || 60000
        });
        
        return {
          runWithRateLimit: (fn, text, options = {}) => {
            const tokens = typeof text === 'number' ? text : throttleManager.approximateTokens(text);
            return newThrottle.requestPermission(providerId, tokens).then(() => fn());
          },
          getUsage: () => newThrottle.getUsage(providerId),
          configure: (newOpts) => newThrottle.configure(providerId, newOpts),
          reset: () => newThrottle.resetUsage(providerId)
        };
      }
    };

    return legacyAPI;
  }

  // Initialize and export legacy adapters
  return {
    initializeLegacyCache,
    initializeLegacyThrottle,
    version: '1.0.0'
  };

}));