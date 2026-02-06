/**
 * Centralized logging system with environment-based levels and security redaction
 * Replaces scattered console.* calls throughout the extension
 */

class Logger {
  constructor(options = {}) {
    // Initialize levels first
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      NONE: 4
    };

    // Now we can safely call detectLogLevel which uses this.levels
    this.level = this.detectLogLevel();
    this.component = options.component || 'Extension';
    this.enableConsole = options.enableConsole !== false;
    this.enableStorage = options.enableStorage || false;
    this.maxStoredLogs = options.maxStoredLogs || 100;

    // API key patterns for redaction
    this.sensitivePatterns = [
      /(['"]\w*[Aa]pi[Kk]ey['"]?\s*[:=]\s*['"])[^'"]{8,}(['"])/g,
      /(['"]\w*[Tt]oken['"]?\s*[:=]\s*['"])[^'"]{8,}(['"])/g,
      /(['"]\w*[Ss]ecret['"]?\s*[:=]\s*['"])[^'"]{8,}(['"])/g,
      /(['"]\w*[Aa]uth['"]?\s*[:=]\s*['"])[^'"]{8,}(['"])/g,
      /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g,
      /(sk-[a-zA-Z0-9]{32,})/g, // OpenAI-style keys
      /(sk_[a-zA-Z0-9_]{32,})/g, // Alternative format
    ];

    this.storedLogs = [];
    this.init();
  }

  detectLogLevel() {
    // Check multiple environment indicators
    const isDevelopment =
      // Chrome extension context
      (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest &&
       chrome.runtime.getManifest().version_name &&
       chrome.runtime.getManifest().version_name.includes('dev')) ||
      // General development indicators
      window.location?.hostname === 'localhost' ||
      window.location?.protocol === 'moz-extension:' ||
      // Explicit debug flag
      localStorage.getItem('debug') === 'true' ||
      // URL parameter
      new URLSearchParams(window.location?.search || '').has('debug');

    return isDevelopment ? this.levels.DEBUG : this.levels.INFO;
  }

  init() {
    // Override global console in development for debugging
    if (this.level === this.levels.DEBUG && typeof window !== 'undefined') {
      window.originalConsole = { ...console };
      // Don't override console in development - keep original behavior
    }
  }

  shouldLog(level) {
    return this.levels[level] >= this.level;
  }

  redactSensitiveData(message) {
    if (typeof message !== 'string') {
      try {
        message = JSON.stringify(message, null, 2);
      } catch {
        message = String(message);
      }
    }

    let redacted = message;

    // Apply each pattern
    for (const pattern of this.sensitivePatterns) {
      redacted = redacted.replace(pattern, (match, prefix, suffix) => {
        if (suffix) {
          // Pattern has both prefix and suffix (key-value pairs)
          return `${prefix}***REDACTED***${suffix}`;
        } else {
          // Pattern is just the sensitive part (tokens)
          return '***REDACTED***';
        }
      });
    }

    // Additional PII patterns
    redacted = redacted.replace(/(\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b)/g, '***CARD***');
    redacted = redacted.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '***EMAIL***');

    return redacted;
  }

  formatMessage(level, component, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${component}]`;

    // Redact sensitive data from all arguments
    const redactedArgs = args.map(arg => this.redactSensitiveData(arg));

    return { prefix, args: redactedArgs, timestamp, level, component };
  }

  storeLog(logData) {
    if (!this.enableStorage) return;

    this.storedLogs.push({
      ...logData,
      id: Date.now() + Math.random()
    });

    // Keep only recent logs
    if (this.storedLogs.length > this.maxStoredLogs) {
      this.storedLogs = this.storedLogs.slice(-this.maxStoredLogs);
    }

    // Persist to chrome.storage in background context
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({
        'extension_logs': this.storedLogs.slice(-50) // Keep last 50 in storage
      }).catch(() => {}); // Fail silently if storage unavailable
    }
  }

  log(level, component, ...args) {
    if (!this.shouldLog(level)) return;

    const logData = this.formatMessage(level, component || this.component, ...args);

    // Store log entry
    this.storeLog(logData);

    // Output to console if enabled
    if (this.enableConsole) {
      const consoleMethod = level.toLowerCase() === 'debug' ? 'log' : level.toLowerCase();
      if (console[consoleMethod]) {
        console[consoleMethod](logData.prefix, ...logData.args);
      } else {
        console.log(logData.prefix, ...logData.args);
      }
    }
  }

  debug(component, ...args) {
    if (typeof component === 'string') {
      this.log('DEBUG', component, ...args);
    } else {
      this.log('DEBUG', this.component, component, ...args);
    }
  }

  info(component, ...args) {
    if (typeof component === 'string') {
      this.log('INFO', component, ...args);
    } else {
      this.log('INFO', this.component, component, ...args);
    }
  }

  warn(component, ...args) {
    if (typeof component === 'string') {
      this.log('WARN', component, ...args);
    } else {
      this.log('WARN', this.component, component, ...args);
    }
  }

  error(component, ...args) {
    if (typeof component === 'string') {
      this.log('ERROR', component, ...args);
    } else {
      this.log('ERROR', this.component, component, ...args);
    }
  }

  // Utility methods
  setLevel(level) {
    if (typeof level === 'string' && this.levels[level.toUpperCase()] !== undefined) {
      this.level = this.levels[level.toUpperCase()];
    } else if (typeof level === 'number') {
      this.level = level;
    }
  }

  getStoredLogs() {
    return this.storedLogs;
  }

  clearLogs() {
    this.storedLogs = [];
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove('extension_logs').catch(() => {});
    }
  }

  // Create component-specific loggers
  createComponentLogger(componentName) {
    return new Logger({
      component: componentName,
      enableConsole: this.enableConsole,
      enableStorage: this.enableStorage
    });
  }
}

// Create default logger instance
const logger = new Logger();

// Export both class and instance
export { Logger, logger };

// For CommonJS compatibility (browser extension context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Logger, logger };
}

// Global registration for easy access
if (typeof window !== 'undefined') {
  window.ExtensionLogger = logger;
}