/**
 * @fileoverview Centralized logging system with context awareness and sensitive data sanitization
 * Provides performance-optimized logging with buffered output and configurable levels
 */

(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    root.qwenCoreLogger = mod;
  }
}(typeof self !== 'undefined' ? self : this, function (root) {

  // Import types for JSDoc
  /// <reference path="./types.js" />

  /** @type {Object.<string, number>} */
  const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
  
  /** @type {string[]} */
  const LEVEL_NAMES = ['error', 'warn', 'info', 'debug'];

  /** @type {Set<Function>} */
  const collectors = new Set();

  /** @type {Array<{timestamp: number, level: string, namespace: string, args: any[]}>} */
  let logBuffer = [];
  
  /** @type {number} */
  const MAX_BUFFER_SIZE = 100;
  
  /** @type {number} */
  const FLUSH_INTERVAL = 1000; // 1 second
  
  /** @type {number|null} */
  let flushTimer = null;

  /**
   * Parse log level from various formats
   * @param {string|number} level - Log level to parse
   * @returns {number} Numeric log level (0-3)
   */
  function parseLevel(level) {
    if (typeof level === 'number') {
      return Math.max(0, Math.min(3, Math.floor(level)));
    }
    const str = String(level || '').toLowerCase();
    return LEVELS[str] ?? 1; // Default to warn
  }

  /**
   * Check if a key contains sensitive information
   * @param {string} key - Key to check
   * @returns {boolean} True if key is sensitive
   */
  function isSecretKey(key) {
    return /^authorization$/i.test(key) || 
           /^api[-_\s]?key$/i.test(key) || 
           /token/i.test(key) ||
           /password/i.test(key) ||
           /secret/i.test(key) ||
           /credential/i.test(key);
  }

  /**
   * Redact sensitive values from logs
   * @param {any} value - Value to redact
   * @param {WeakSet} [seen] - Track seen objects to prevent circular references
   * @returns {any} Redacted value
   */
  function redactValue(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
      return value
        .replace(/(api[-_\s]?key\s*[:=]\s*).*/ig, '$1<redacted>')
        .replace(/(authorization\s*[:=]\s*).*/ig, '$1<redacted>')
        .replace(/(token\s*[:=]\s*).*/ig, '$1<redacted>')
        .replace(/(password\s*[:=]\s*).*/ig, '$1<redacted>')
        .replace(/(secret\s*[:=]\s*).*/ig, '$1<redacted>');
    }
    
    if (value instanceof Error) {
      const sanitized = {
        name: value.name,
        message: redactValue(value.message, seen),
        stack: value.stack ? redactValue(value.stack, seen) : undefined
      };
      
      // Copy other enumerable properties
      for (const key of Object.getOwnPropertyNames(value)) {
        if (!['name', 'message', 'stack'].includes(key)) {
          sanitized[key] = isSecretKey(key) ? '<redacted>' : redactValue(value[key], seen);
        }
      }
      return sanitized;
    }
    
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      const result = value.map(v => redactValue(v, seen));
      seen.delete(value);
      return result;
    }
    
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      
      try {
        seen.add(value);
        const sanitized = {};
        for (const [key, val] of Object.entries(value)) {
          sanitized[key] = isSecretKey(key) ? '<redacted>' : redactValue(val, seen);
        }
        seen.delete(value);
        return sanitized;
      } catch (error) {
        seen.delete(value);
        return '[Object]';
      }
    }
    
    return value;
  }

  /**
   * Sanitize arguments array
   * @param {any[]} args - Arguments to sanitize
   * @returns {any[]} Sanitized arguments
   */
  function sanitizeArgs(args) {
    return args.map(redactValue);
  }

  /**
   * Format log message with namespace
   * @param {string} namespace - Logger namespace
   * @param {any[]} sanitizedArgs - Sanitized arguments
   * @returns {any[]} Formatted arguments
   */
  function formatMessage(namespace, sanitizedArgs) {
    if (!sanitizedArgs.length) {
      return [`[${namespace}]`];
    }
    
    const [first, ...rest] = sanitizedArgs;
    if (typeof first === 'string') {
      return [`[${namespace}] ${first}`, ...rest];
    }
    
    return [`[${namespace}]`, first, ...rest];
  }

  /**
   * Get global log level from configuration
   * @returns {number} Global log level
   */
  function getGlobalLevel() {
    try {
      // Check extension config
      if (root.qwenConfig && typeof root.qwenConfig.debug === 'boolean') {
        return root.qwenConfig.debug ? 3 : 1; // debug or warn
      }
      
      if (root.qwenConfig && root.qwenConfig.logLevel) {
        return parseLevel(root.qwenConfig.logLevel);
      }
      
      // Check environment variable (Node.js)
      if (typeof process !== 'undefined' && process.env && process.env.QWEN_LOG_LEVEL) {
        return parseLevel(process.env.QWEN_LOG_LEVEL);
      }
      
      // Check URL parameters (browser)
      if (typeof window !== 'undefined' && window.location) {
        const params = new URLSearchParams(window.location.search);
        if (params.has('debug')) return 3;
        if (params.has('loglevel')) return parseLevel(params.get('loglevel'));
      }
    } catch (error) {
      // Ignore configuration errors
    }
    
    return 1; // Default to warn level
  }

  /**
   * Emit log entry to collectors
   * @param {string} level - Log level
   * @param {string} namespace - Logger namespace
   * @param {any[]} sanitizedArgs - Sanitized arguments
   */
  function emit(level, namespace, sanitizedArgs) {
    const entry = {
      timestamp: Date.now(),
      level,
      namespace,
      args: sanitizedArgs
    };
    
    // Add to buffer for batch processing
    logBuffer.push(entry);
    
    // Flush buffer if it's getting full
    if (logBuffer.length >= MAX_BUFFER_SIZE) {
      flushBuffer();
    } else if (flushTimer === null) {
      // Start flush timer for batched output
      flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL);
    }
    
    // Emit to collectors immediately
    collectors.forEach(collector => {
      try {
        collector(entry);
      } catch (error) {
        // Ignore collector errors to prevent logging loops
      }
    });
  }

  /**
   * Flush buffered log entries
   */
  function flushBuffer() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    
    if (logBuffer.length === 0) return;
    
    // Process buffered entries (implementation can be extended for persistence)
    logBuffer.length = 0; // Clear buffer
  }

  /**
   * Add log entry collector
   * @param {Function} collector - Collector function
   * @returns {Function} Removal function
   */
  function addCollector(collector) {
    if (typeof collector === 'function') {
      collectors.add(collector);
      return () => collectors.delete(collector);
    }
    return () => {};
  }

  /**
   * Create logger instance with context
   * @param {string} namespace - Logger namespace
   * @returns {Object} Logger instance
   */
  function create(namespace) {
    const baseConsole = root.console || console;
    let currentLevel = getGlobalLevel();
    
    /** @type {number} Performance optimization: cache start time */
    let perfStart = 0;

    const logger = {
      /**
       * Set log level for this logger instance
       * @param {string|number} level - Log level
       */
      setLevel(level) {
        currentLevel = parseLevel(level);
      },

      /**
       * Get current log level
       * @returns {number} Current log level
       */
      level() {
        return currentLevel;
      },

      /**
       * Get current log level name
       * @returns {string} Current log level name
       */
      levelName() {
        return LEVEL_NAMES[currentLevel] || 'unknown';
      },

      /**
       * Create child logger with extended namespace
       * @param {string} childNamespace - Child namespace
       * @returns {Object} Child logger instance
       */
      create(childNamespace) {
        return create(namespace ? `${namespace}:${childNamespace}` : childNamespace);
      },

      /**
       * Log debug message
       * @param {...any} args - Arguments to log
       */
      debug(...args) {
        if (currentLevel >= 3) {
          const sanitized = sanitizeArgs(args);
          const formatted = formatMessage(namespace, sanitized);
          baseConsole.debug(...formatted);
          emit('debug', namespace, sanitized);
        }
      },

      /**
       * Log info message
       * @param {...any} args - Arguments to log
       */
      info(...args) {
        if (currentLevel >= 2) {
          const sanitized = sanitizeArgs(args);
          const formatted = formatMessage(namespace, sanitized);
          baseConsole.info(...formatted);
          emit('info', namespace, sanitized);
        }
      },

      /**
       * Log warning message
       * @param {...any} args - Arguments to log
       */
      warn(...args) {
        if (currentLevel >= 1) {
          const sanitized = sanitizeArgs(args);
          const formatted = formatMessage(namespace, sanitized);
          baseConsole.warn(...formatted);
          emit('warn', namespace, sanitized);
        }
      },

      /**
       * Log error message (always logged regardless of level)
       * @param {...any} args - Arguments to log
       */
      error(...args) {
        const sanitized = sanitizeArgs(args);
        const formatted = formatMessage(namespace, sanitized);
        baseConsole.error(...formatted);
        emit('error', namespace, sanitized);
      },

      /**
       * Log batch processing time
       * @param {number} ms - Time in milliseconds
       */
      logBatchTime(ms) {
        if (currentLevel >= 2) {
          this.info('Batch processed', { batchTimeMs: ms });
        }
      },

      /**
       * Log queue latency
       * @param {number} ms - Latency in milliseconds
       */
      logQueueLatency(ms) {
        if (currentLevel >= 2) {
          this.info('Queue latency', { queueLatencyMs: ms });
        }
      },

      /**
       * Time an async operation
       * @param {Function} fn - Async function to time
       * @returns {Promise<{result: any, ms: number}>} Result with timing
       */
      async time(fn) {
        const start = Date.now();
        try {
          const result = await fn();
          const ms = Date.now() - start;
          
          if (currentLevel >= 3) {
            emit('debug', namespace, [{ operation: 'completed', latencyMs: ms }]);
          }
          
          return { result, ms };
        } catch (error) {
          const ms = Date.now() - start;
          
          if (currentLevel >= 3) {
            emit('debug', namespace, [{ operation: 'failed', latencyMs: ms, error: error.message }]);
          }
          
          // Attach timing info to error
          if (error && typeof error === 'object') {
            error.latencyMs = ms;
          }
          
          throw error;
        }
      },

      /**
       * Start performance measurement
       * @param {string} [label] - Optional label for measurement
       */
      perfStart(label) {
        perfStart = performance.now ? performance.now() : Date.now();
        if (currentLevel >= 3 && label) {
          this.debug(`Performance start: ${label}`);
        }
      },

      /**
       * End performance measurement
       * @param {string} [label] - Optional label for measurement
       * @returns {number} Elapsed time in milliseconds
       */
      perfEnd(label) {
        const now = performance.now ? performance.now() : Date.now();
        const elapsed = now - perfStart;
        
        if (currentLevel >= 3 && label) {
          this.debug(`Performance end: ${label}`, { elapsedMs: elapsed });
        }
        
        return elapsed;
      }
    };

    return logger;
  }

  /**
   * Set global log level
   * @param {string|number} level - Log level
   */
  function setLevel(level) {
    // This would typically update global configuration
    if (root.qwenConfig) {
      root.qwenConfig.logLevel = parseLevel(level);
    }
  }

  // Clean up on environment shutdown
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushBuffer);
  } else if (typeof process !== 'undefined') {
    process.on('exit', flushBuffer);
  }

  // Public API
  return {
    create,
    setLevel,
    addCollector,
    parseLevel,
    LEVELS,
    version: '1.0.0'
  };

}));