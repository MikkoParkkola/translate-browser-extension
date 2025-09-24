/**
 * @fileoverview Lazy WASM Module Loader
 * Implements dynamic loading of large WASM modules to reduce initial bundle size
 * Supports MuPDF (9.8MB) and Pdfium (5.7MB) with intelligent caching
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.wasmLoader = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * WASM Module Configuration
   * @typedef {Object} WasmModuleConfig
   * @property {string} name - Module name
   * @property {string} wasmPath - Path to WASM file
   * @property {string} jsPath - Path to JS wrapper
   * @property {number} size - Module size in bytes
   * @property {boolean} preload - Whether to preload this module
   * @property {string[]} dependencies - Dependencies to load first
   */

  /**
   * Loader State
   * @typedef {Object} LoaderState
   * @property {'idle'|'loading'|'loaded'|'error'} status - Current status
   * @property {any} module - Loaded module instance
   * @property {Promise<any>} [promise] - Loading promise
   * @property {Error} [error] - Load error if any
   * @property {number} [loadTime] - Time taken to load (ms)
   */

  const WASM_MODULES = {
    mupdf: {
      name: 'mupdf',
      wasmPath: chrome.runtime.getURL('wasm/vendor/mupdf-wasm.wasm'),
      jsPath: chrome.runtime.getURL('wasm/vendor/mupdf-wasm.js'),
      size: 9800525, // 9.8MB
      preload: false,
      dependencies: ['harfbuzz']
    },
    pdfium: {
      name: 'pdfium',
      wasmPath: chrome.runtime.getURL('wasm/vendor/pdfium.wasm'),
      jsPath: chrome.runtime.getURL('wasm/vendor/pdfium.engine.js'),
      size: 5794831, // 5.7MB
      preload: false,
      dependencies: []
    },
    harfbuzz: {
      name: 'harfbuzz',
      wasmPath: chrome.runtime.getURL('wasm/vendor/hb.wasm'),
      jsPath: chrome.runtime.getURL('wasm/vendor/hb.js'),
      size: 348258, // 340KB
      preload: true,
      dependencies: []
    },
    icu_segmenter: {
      name: 'icu_segmenter', 
      wasmPath: chrome.runtime.getURL('wasm/vendor/icu4x_segmenter.wasm'),
      jsPath: chrome.runtime.getURL('wasm/vendor/icu4x_segmenter.js'),
      size: 407642, // 400KB
      preload: true,
      dependencies: []
    }
  };

  /** @type {Map<string, LoaderState>} */
  const moduleStates = new Map();

  /** @type {Map<string, number>} */
  const usageStats = new Map();

  let logger = null;

  /**
   * Initialize logger if available
   */
  function initLogger() {
    if (typeof qwenLogger !== 'undefined') {
      logger = qwenLogger;
    }
  }

  /**
   * Log message with fallback to console
   * @param {'debug'|'info'|'warn'|'error'} level 
   * @param {string} message 
   * @param {any} data 
   */
  function log(level, message, data) {
    if (logger) {
      logger[level](message, data);
    } else if (level === 'error' || level === 'warn') {
      console[level](`[WasmLoader] ${message}`, data);
    }
  }

  /**
   * Check if module is supported in current environment
   * @param {string} moduleName 
   * @returns {boolean}
   */
  function isModuleSupported(moduleName) {
    // Check WebAssembly support
    if (typeof WebAssembly === 'undefined') {
      return false;
    }

    // Check if we're in a Chrome extension context
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return false;
    }

    // Check module exists
    return WASM_MODULES[moduleName] !== undefined;
  }

  /**
   * Get module load progress
   * @param {string} moduleName 
   * @returns {{loaded: number, total: number, percentage: number}}
   */
  function getLoadProgress(moduleName) {
    const state = moduleStates.get(moduleName);
    const config = WASM_MODULES[moduleName];
    
    if (!state || !config) {
      return { loaded: 0, total: 0, percentage: 0 };
    }

    if (state.status === 'loaded') {
      return { loaded: config.size, total: config.size, percentage: 100 };
    }

    if (state.status === 'loading') {
      // Estimate based on time elapsed (rough heuristic)
      const elapsed = Date.now() - (state.startTime || 0);
      const estimatedPercentage = Math.min(90, elapsed / 50); // 50ms per %
      const loaded = Math.floor((estimatedPercentage / 100) * config.size);
      return { loaded, total: config.size, percentage: estimatedPercentage };
    }

    return { loaded: 0, total: config.size, percentage: 0 };
  }

  /**
   * Load dependencies for a module
   * @param {string[]} dependencies 
   * @returns {Promise<any[]>}
   */
  async function loadDependencies(dependencies) {
    if (!dependencies.length) return [];
    
    log('debug', 'Loading dependencies', { dependencies });
    return Promise.all(dependencies.map(dep => loadModule(dep)));
  }

  /**
   * Load WASM module with caching and progress tracking
   * @param {string} moduleName 
   * @param {Object} [options]
   * @param {boolean} [options.force] - Force reload even if cached
   * @param {AbortSignal} [options.signal] - Abort signal for cancellation
   * @returns {Promise<any>}
   */
  async function loadModule(moduleName, options = {}) {
    initLogger();

    if (!isModuleSupported(moduleName)) {
      throw new Error(`Module ${moduleName} is not supported in this environment`);
    }

    const config = WASM_MODULES[moduleName];
    let state = moduleStates.get(moduleName);

    // Return cached module if available and not forcing reload
    if (state && state.status === 'loaded' && !options.force) {
      // Update usage stats
      usageStats.set(moduleName, (usageStats.get(moduleName) || 0) + 1);
      log('debug', 'Returning cached WASM module', { moduleName });
      return state.module;
    }

    // Return existing promise if already loading
    if (state && state.status === 'loading' && state.promise && !options.force) {
      log('debug', 'Waiting for in-progress WASM load', { moduleName });
      return state.promise;
    }

    // Initialize state
    state = {
      status: 'loading',
      startTime: Date.now(),
      module: null,
      error: null,
      loadTime: null
    };
    moduleStates.set(moduleName, state);

    log('info', 'Starting WASM module load', { 
      moduleName, 
      size: `${(config.size / 1024 / 1024).toFixed(2)}MB`,
      hasDependencies: config.dependencies.length > 0
    });

    // Create loading promise
    const loadingPromise = (async () => {
      try {
        // Load dependencies first
        await loadDependencies(config.dependencies);

        // Check abort signal
        if (options.signal?.aborted) {
          throw new Error('WASM load aborted');
        }

        // Load JS wrapper
        log('debug', 'Loading WASM JS wrapper', { jsPath: config.jsPath });
        const wasmModuleFactory = await import(config.jsPath);

        // Check abort signal again
        if (options.signal?.aborted) {
          throw new Error('WASM load aborted');
        }

        // Initialize WASM module
        const wasmModule = await wasmModuleFactory.default({
          locateFile: (path, prefix) => {
            // Override WASM file location
            if (path.endsWith('.wasm')) {
              return config.wasmPath;
            }
            return prefix + path;
          }
        });

        const loadTime = Date.now() - state.startTime;
        
        // Update state
        state.status = 'loaded';
        state.module = wasmModule;
        state.loadTime = loadTime;
        
        // Update usage stats
        usageStats.set(moduleName, (usageStats.get(moduleName) || 0) + 1);

        log('info', 'WASM module loaded successfully', { 
          moduleName, 
          loadTime: `${loadTime}ms`,
          size: `${(config.size / 1024 / 1024).toFixed(2)}MB`
        });

        return wasmModule;

      } catch (error) {
        state.status = 'error';
        state.error = error;
        state.loadTime = Date.now() - state.startTime;
        
        log('error', 'WASM module load failed', { 
          moduleName, 
          error: error.message,
          loadTime: `${state.loadTime}ms`
        });

        throw error;
      }
    })();

    state.promise = loadingPromise;
    return loadingPromise;
  }

  /**
   * Preload specified modules or small modules by default
   * @param {string[]} [moduleNames] - Specific modules to preload
   * @returns {Promise<void>}
   */
  async function preloadModules(moduleNames = []) {
    initLogger();

    // Default to preloading small modules
    const toPreload = moduleNames.length > 0 
      ? moduleNames 
      : Object.keys(WASM_MODULES).filter(name => WASM_MODULES[name].preload);

    if (toPreload.length === 0) {
      log('debug', 'No modules configured for preload');
      return;
    }

    log('info', 'Preloading WASM modules', { modules: toPreload });

    try {
      await Promise.all(toPreload.map(name => loadModule(name)));
      log('info', 'WASM module preload completed', { modules: toPreload });
    } catch (error) {
      log('warn', 'WASM module preload partially failed', { error: error.message });
    }
  }

  /**
   * Unload a module to free memory
   * @param {string} moduleName 
   */
  function unloadModule(moduleName) {
    const state = moduleStates.get(moduleName);
    if (!state || state.status !== 'loaded') {
      return;
    }

    // Call cleanup if available
    if (state.module && typeof state.module._cleanup === 'function') {
      try {
        state.module._cleanup();
      } catch (error) {
        log('warn', 'WASM module cleanup failed', { moduleName, error: error.message });
      }
    }

    // Reset state
    state.status = 'idle';
    state.module = null;
    state.promise = null;
    state.error = null;

    log('info', 'WASM module unloaded', { moduleName });
  }

  /**
   * Get loader statistics
   * @returns {Object}
   */
  function getStats() {
    const stats = {
      modules: {},
      totalSize: 0,
      loadedSize: 0,
      usageStats: Object.fromEntries(usageStats)
    };

    for (const [name, config] of Object.entries(WASM_MODULES)) {
      const state = moduleStates.get(name);
      stats.modules[name] = {
        name,
        size: config.size,
        status: state?.status || 'idle',
        loadTime: state?.loadTime || null,
        usageCount: usageStats.get(name) || 0
      };
      
      stats.totalSize += config.size;
      if (state?.status === 'loaded') {
        stats.loadedSize += config.size;
      }
    }

    return stats;
  }

  /**
   * Clear all caches and reset loader
   */
  function reset() {
    for (const moduleName of moduleStates.keys()) {
      unloadModule(moduleName);
    }
    moduleStates.clear();
    usageStats.clear();
    log('info', 'WASM loader reset completed');
  }

  // Initialize preload on first import if in extension context
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    // Delay preload to avoid blocking extension startup
    setTimeout(() => preloadModules(), 1000);
  }

  // Public API
  return {
    loadModule,
    preloadModules,
    unloadModule,
    isModuleSupported,
    getLoadProgress,
    getStats,
    reset,
    MODULES: WASM_MODULES
  };

}));