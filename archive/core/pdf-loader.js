/**
 * @fileoverview Dynamic PDF Module Loader
 * Lazy loads PDF processing modules to reduce initial bundle size
 * Integrates with WASM loader for efficient resource management
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.pdfLoader = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * PDF Engine Configuration
   * @typedef {Object} PdfEngineConfig
   * @property {string} name - Engine name
   * @property {string[]} wasmDeps - Required WASM modules
   * @property {string[]} jsDeps - Required JS dependencies
   * @property {number} priority - Load priority (lower = higher priority)
   * @property {string[]} supportedFeatures - Features this engine supports
   */

  const PDF_ENGINES = {
    mupdf: {
      name: 'mupdf',
      wasmDeps: ['mupdf', 'harfbuzz'],
      jsDeps: ['wasm/pdfgen.js'],
      priority: 1,
      supportedFeatures: ['render', 'text-extract', 'annotations', 'forms']
    },
    pdfium: {
      name: 'pdfium',
      wasmDeps: ['pdfium'],
      jsDeps: ['wasm/vendor/pdfium.engine.js'],
      priority: 2,
      supportedFeatures: ['render', 'text-extract', 'forms']
    },
    pdfjs: {
      name: 'pdfjs',
      wasmDeps: [],
      jsDeps: ['pdf.min.js'],
      priority: 3,
      supportedFeatures: ['render', 'text-extract', 'annotations']
    }
  };

  /** @type {Map<string, any>} */
  const engineInstances = new Map();
  
  /** @type {Map<string, Promise<any>>} */
  const loadingPromises = new Map();

  let wasmLoader = null;
  let logger = null;

  /**
   * Initialize dependencies
   */
  function initDependencies() {
    if (typeof wasmLoader === 'undefined' && typeof root.wasmLoader !== 'undefined') {
      wasmLoader = root.wasmLoader;
    }
    
    if (typeof qwenLogger !== 'undefined') {
      logger = qwenLogger;
    }
  }

  /**
   * Log message with fallback
   * @param {'debug'|'info'|'warn'|'error'} level 
   * @param {string} message 
   * @param {any} data 
   */
  function log(level, message, data) {
    if (logger) {
      logger[level](message, data);
    } else if (level === 'error' || level === 'warn') {
      console[level](`[PdfLoader] ${message}`, data);
    }
  }

  /**
   * Check if PDF engine is available
   * @param {string} engineName 
   * @returns {boolean}
   */
  function isEngineAvailable(engineName) {
    const config = PDF_ENGINES[engineName];
    if (!config) return false;

    // Check WASM dependencies
    if (wasmLoader) {
      for (const wasmDep of config.wasmDeps) {
        if (!wasmLoader.isModuleSupported(wasmDep)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get best available PDF engine for required features
   * @param {string[]} requiredFeatures 
   * @returns {string|null}
   */
  function getBestEngine(requiredFeatures = []) {
    const candidates = Object.entries(PDF_ENGINES)
      .filter(([name, config]) => {
        // Check availability
        if (!isEngineAvailable(name)) return false;
        
        // Check feature support
        if (requiredFeatures.length > 0) {
          return requiredFeatures.every(feature => 
            config.supportedFeatures.includes(feature)
          );
        }
        
        return true;
      })
      .sort(([, a], [, b]) => a.priority - b.priority);

    return candidates.length > 0 ? candidates[0][0] : null;
  }

  /**
   * Load PDF engine with dependencies
   * @param {string} engineName 
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<any>}
   */
  async function loadEngine(engineName, options = {}) {
    initDependencies();

    if (!isEngineAvailable(engineName)) {
      throw new Error(`PDF engine ${engineName} is not available`);
    }

    // Return cached instance
    if (engineInstances.has(engineName)) {
      log('debug', 'Returning cached PDF engine', { engineName });
      return engineInstances.get(engineName);
    }

    // Return existing loading promise
    if (loadingPromises.has(engineName)) {
      log('debug', 'Waiting for PDF engine load in progress', { engineName });
      return loadingPromises.get(engineName);
    }

    const config = PDF_ENGINES[engineName];
    log('info', 'Loading PDF engine', { engineName, config });

    const loadingPromise = (async () => {
      try {
        // Load WASM dependencies
        if (wasmLoader && config.wasmDeps.length > 0) {
          log('debug', 'Loading WASM dependencies for PDF engine', { 
            engineName, 
            deps: config.wasmDeps 
          });
          
          await Promise.all(
            config.wasmDeps.map(dep => wasmLoader.loadModule(dep, { signal: options.signal }))
          );
        }

        // Check abort signal
        if (options.signal?.aborted) {
          throw new Error('PDF engine load aborted');
        }

        // Load JavaScript dependencies
        const jsModules = {};
        for (const jsDep of config.jsDeps) {
          log('debug', 'Loading JS dependency', { engineName, dep: jsDep });
          
          const modulePath = chrome.runtime.getURL(jsDep);
          const module = await import(modulePath);
          jsModules[jsDep] = module;
        }

        // Check abort signal again
        if (options.signal?.aborted) {
          throw new Error('PDF engine load aborted');
        }

        // Initialize engine based on type
        let engineInstance;
        
        switch (engineName) {
          case 'mupdf':
            engineInstance = await initMuPdfEngine(jsModules);
            break;
          case 'pdfium':
            engineInstance = await initPdfiumEngine(jsModules);
            break;
          case 'pdfjs':
            engineInstance = await initPdfJsEngine(jsModules);
            break;
          default:
            throw new Error(`Unknown PDF engine: ${engineName}`);
        }

        // Cache instance
        engineInstances.set(engineName, engineInstance);
        loadingPromises.delete(engineName);

        log('info', 'PDF engine loaded successfully', { engineName });
        return engineInstance;

      } catch (error) {
        loadingPromises.delete(engineName);
        log('error', 'PDF engine load failed', { engineName, error: error.message });
        throw error;
      }
    })();

    loadingPromises.set(engineName, loadingPromise);
    return loadingPromise;
  }

  /**
   * Initialize MuPDF engine
   * @param {Object} jsModules 
   * @returns {Promise<any>}
   */
  async function initMuPdfEngine(jsModules) {
    const pdfgenModule = jsModules['wasm/pdfgen.js'];
    
    if (!pdfgenModule || !pdfgenModule.default) {
      throw new Error('MuPDF pdfgen module not found');
    }

    // Initialize with WASM module
    const mupdfWasm = wasmLoader ? await wasmLoader.loadModule('mupdf') : null;
    return pdfgenModule.default.init(mupdfWasm);
  }

  /**
   * Initialize Pdfium engine
   * @param {Object} jsModules 
   * @returns {Promise<any>}
   */
  async function initPdfiumEngine(jsModules) {
    const pdfiumModule = jsModules['wasm/vendor/pdfium.engine.js'];
    
    if (!pdfiumModule || !pdfiumModule.default) {
      throw new Error('Pdfium engine module not found');
    }

    // Initialize with WASM module
    const pdfiumWasm = wasmLoader ? await wasmLoader.loadModule('pdfium') : null;
    return pdfiumModule.default.init(pdfiumWasm);
  }

  /**
   * Initialize PDF.js engine
   * @param {Object} jsModules 
   * @returns {Promise<any>}
   */
  async function initPdfJsEngine(jsModules) {
    const pdfjsModule = jsModules['pdf.min.js'];
    
    if (!pdfjsModule) {
      throw new Error('PDF.js module not found');
    }

    // Configure worker
    const workerUrl = chrome.runtime.getURL('pdf.worker.min.js');
    pdfjsModule.GlobalWorkerOptions.workerSrc = workerUrl;

    return pdfjsModule;
  }

  /**
   * Load best PDF engine for features
   * @param {string[]} requiredFeatures 
   * @param {Object} [options]
   * @returns {Promise<{engine: any, name: string}>}
   */
  async function loadBestEngine(requiredFeatures = [], options = {}) {
    const bestEngine = getBestEngine(requiredFeatures);
    
    if (!bestEngine) {
      throw new Error(`No PDF engine available for features: ${requiredFeatures.join(', ')}`);
    }

    const engine = await loadEngine(bestEngine, options);
    return { engine, name: bestEngine };
  }

  /**
   * Preload PDF engines
   * @param {string[]} [engineNames] - Specific engines to preload
   * @returns {Promise<void>}
   */
  async function preloadEngines(engineNames = ['pdfjs']) {
    log('info', 'Preloading PDF engines', { engines: engineNames });

    try {
      await Promise.all(engineNames.map(name => loadEngine(name)));
      log('info', 'PDF engine preload completed', { engines: engineNames });
    } catch (error) {
      log('warn', 'PDF engine preload partially failed', { error: error.message });
    }
  }

  /**
   * Unload PDF engine
   * @param {string} engineName 
   */
  function unloadEngine(engineName) {
    const instance = engineInstances.get(engineName);
    
    if (instance && typeof instance.cleanup === 'function') {
      try {
        instance.cleanup();
      } catch (error) {
        log('warn', 'PDF engine cleanup failed', { engineName, error: error.message });
      }
    }

    engineInstances.delete(engineName);
    loadingPromises.delete(engineName);
    log('info', 'PDF engine unloaded', { engineName });
  }

  /**
   * Get loader statistics
   * @returns {Object}
   */
  function getStats() {
    return {
      engines: Object.keys(PDF_ENGINES).map(name => ({
        name,
        available: isEngineAvailable(name),
        loaded: engineInstances.has(name),
        loading: loadingPromises.has(name),
        features: PDF_ENGINES[name].supportedFeatures
      }))
    };
  }

  /**
   * Reset all engines
   */
  function reset() {
    for (const engineName of engineInstances.keys()) {
      unloadEngine(engineName);
    }
  }

  // Public API
  return {
    loadEngine,
    loadBestEngine,
    preloadEngines,
    unloadEngine,
    isEngineAvailable,
    getBestEngine,
    getStats,
    reset,
    ENGINES: PDF_ENGINES
  };

}));