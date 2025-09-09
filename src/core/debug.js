/**
 * @fileoverview Centralized debug logging system
 * Provides controlled debug output that can be disabled in production builds
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenDebug = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Debug configuration
   */
  const DEBUG_CONFIG = {
    // Enable debug logging - can be disabled via build process
    enabled: true,
    // Debug levels
    levels: {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    },
    // Current debug level
    currentLevel: 3, // DEBUG level by default
    // Module-specific debug flags
    modules: {
      contentScript: true,
      pdfViewer: true,
      translator: true,
      background: true,
      popup: true
    }
  };

  /**
   * Check if debug is enabled for a specific module and level
   * @param {string} module - Module name
   * @param {number} level - Debug level
   * @returns {boolean} True if debug should be shown
   */
  function shouldDebug(module, level) {
    if (!DEBUG_CONFIG.enabled) return false;
    if (level > DEBUG_CONFIG.currentLevel) return false;
    if (module && DEBUG_CONFIG.modules[module] === false) return false;
    return true;
  }

  /**
   * Create a debug logger for a specific module
   * @param {string} moduleName - Name of the module
   * @returns {Object} Debug logger object
   */
  function createLogger(moduleName) {
    const prefix = `[${moduleName.toUpperCase()}]`;

    return {
      error: (...args) => {
        if (shouldDebug(moduleName, DEBUG_CONFIG.levels.ERROR)) {
          console.error(prefix, ...args);
        }
      },
      
      warn: (...args) => {
        if (shouldDebug(moduleName, DEBUG_CONFIG.levels.WARN)) {
          console.warn(prefix, ...args);
        }
      },
      
      info: (...args) => {
        if (shouldDebug(moduleName, DEBUG_CONFIG.levels.INFO)) {
          console.info(prefix, ...args);
        }
      },
      
      debug: (...args) => {
        if (shouldDebug(moduleName, DEBUG_CONFIG.levels.DEBUG)) {
          console.debug(prefix, ...args);
        }
      },

      log: (...args) => {
        if (shouldDebug(moduleName, DEBUG_CONFIG.levels.DEBUG)) {
          console.log(prefix, ...args);
        }
      }
    };
  }

  /**
   * Global debug function for backward compatibility
   * @param {string} module - Module name
   * @param {...any} args - Arguments to log
   */
  function debug(module, ...args) {
    if (shouldDebug(module, DEBUG_CONFIG.levels.DEBUG)) {
      console.debug(`[${module.toUpperCase()}]`, ...args);
    }
  }

  /**
   * Configure debug settings
   * @param {Object} config - Debug configuration
   */
  function configure(config) {
    Object.assign(DEBUG_CONFIG, config);
  }

  /**
   * Disable all debug logging (for production builds)
   */
  function disable() {
    DEBUG_CONFIG.enabled = false;
  }

  /**
   * Enable debug logging
   */
  function enable() {
    DEBUG_CONFIG.enabled = true;
  }

  // Public API
  return {
    createLogger,
    debug,
    configure,
    disable,
    enable,
    config: DEBUG_CONFIG
  };

}));