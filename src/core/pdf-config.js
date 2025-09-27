/**
 * PDF Engine Configuration Manager
 * Manages user-selectable PDF processing engines to reduce bundle size
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.pdfConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Available PDF engine configurations
   */
  const AVAILABLE_ENGINES = {
    none: {
      name: 'Disabled',
      description: 'PDF translation disabled (smallest bundle)',
      size: '0MB',
      wasmFiles: [],
      jsFiles: [],
      features: []
    },
    pdfjs: {
      name: 'PDF.js (Recommended)',
      description: 'Mozilla PDF.js - Good balance of features and size',
      size: '1.3MB',
      wasmFiles: [],
      jsFiles: ['pdf.min.js', 'pdf.worker.min.js'],
      features: ['render', 'text-extract', 'annotations']
    },
    mupdf: {
      name: 'MuPDF (Advanced)',
      description: 'Advanced PDF processing with full feature support',
      size: '9.3MB',
      wasmFiles: ['wasm/vendor/mupdf-wasm.wasm', 'wasm/vendor/hb.wasm'],
      jsFiles: ['wasm/vendor/mupdf-wasm.js', 'wasm/pdfgen.js'],
      features: ['render', 'text-extract', 'annotations', 'forms', 'editing']
    },
    pdfium: {
      name: 'PDFium (Chrome)',
      description: 'Google Chrome PDF engine - fast and reliable',
      size: '5.5MB',
      wasmFiles: ['wasm/vendor/pdfium.wasm'],
      jsFiles: ['wasm/vendor/pdfium.js'],
      features: ['render', 'text-extract', 'forms']
    }
  };

  const DEFAULT_ENGINE = 'none'; // Minimize bundle by default

  let currentConfig = {
    selectedEngine: DEFAULT_ENGINE,
    autoDetect: false,
    fallbackEngine: 'pdfjs'
  };

  /**
   * Load user PDF configuration
   * @returns {Promise<Object>}
   */
  async function loadConfig() {
    try {
      const stored = await new Promise(resolve => {
        chrome.storage.sync.get({
          pdfEngine: DEFAULT_ENGINE,
          pdfAutoDetect: false,
          pdfFallback: 'pdfjs'
        }, resolve);
      });

      currentConfig = {
        selectedEngine: stored.pdfEngine || DEFAULT_ENGINE,
        autoDetect: stored.pdfAutoDetect || false,
        fallbackEngine: stored.pdfFallback || 'pdfjs'
      };

      return currentConfig;
    } catch (error) {
      console.warn('Failed to load PDF config, using defaults:', error);
      return currentConfig;
    }
  }

  /**
   * Save PDF configuration
   * @param {Object} config 
   * @returns {Promise<void>}
   */
  async function saveConfig(config) {
    try {
      await new Promise(resolve => {
        chrome.storage.sync.set({
          pdfEngine: config.selectedEngine,
          pdfAutoDetect: config.autoDetect,
          pdfFallback: config.fallbackEngine
        }, resolve);
      });

      currentConfig = { ...config };
    } catch (error) {
      console.error('Failed to save PDF config:', error);
      throw error;
    }
  }

  /**
   * Get current engine configuration
   * @returns {Object}
   */
  function getCurrentEngine() {
    return {
      ...AVAILABLE_ENGINES[currentConfig.selectedEngine],
      selected: currentConfig.selectedEngine
    };
  }

  /**
   * Check if PDF functionality is enabled
   * @returns {boolean}
   */
  function isPdfEnabled() {
    return currentConfig.selectedEngine !== 'none';
  }

  /**
   * Get files that need to be loaded for current engine
   * @returns {Object}
   */
  function getRequiredFiles() {
    if (!isPdfEnabled()) {
      return { wasmFiles: [], jsFiles: [] };
    }

    const engine = AVAILABLE_ENGINES[currentConfig.selectedEngine];
    return {
      wasmFiles: engine.wasmFiles || [],
      jsFiles: engine.jsFiles || []
    };
  }

  /**
   * Get configuration UI data
   * @returns {Object}
   */
  function getConfigUI() {
    const totalSize = Object.values(AVAILABLE_ENGINES).reduce((sum, engine) => {
      if (engine.size === '0MB') return sum;
      const size = parseFloat(engine.size);
      return sum + size;
    }, 0);

    return {
      engines: Object.entries(AVAILABLE_ENGINES).map(([key, engine]) => ({
        key,
        ...engine,
        selected: key === currentConfig.selectedEngine
      })),
      currentConfig,
      stats: {
        totalAvailableSize: `${totalSize.toFixed(1)}MB`,
        currentSize: AVAILABLE_ENGINES[currentConfig.selectedEngine].size,
        savings: currentConfig.selectedEngine === 'none' ? `${totalSize.toFixed(1)}MB` : '0MB'
      }
    };
  }

  /**
   * Validate engine selection
   * @param {string} engineKey 
   * @returns {boolean}
   */
  function isValidEngine(engineKey) {
    return engineKey in AVAILABLE_ENGINES;
  }

  /**
   * Get recommended engine based on usage
   * @param {Object} usage 
   * @returns {string}
   */
  function getRecommendedEngine(usage = {}) {
    const { translatesPdfs = false, needsAdvanced = false, sizeConstraint = false } = usage;

    if (!translatesPdfs) return 'none';
    if (sizeConstraint) return 'pdfjs';
    if (needsAdvanced) return 'mupdf';
    return 'pdfjs'; // Default recommendation
  }

  /**
   * Update manifest web accessible resources based on selection
   * @returns {Array}
   */
  function getWebAccessibleResources() {
    const required = getRequiredFiles();
    const baseResources = [
      "translator.js",
      "config.js", 
      "throttle.js",
      "core/security.js",
      "styles/contentScript.css"
    ];

    if (isPdfEnabled()) {
      baseResources.push("pdfViewer.html", "pdfViewer.js");
      baseResources.push(...required.jsFiles);
    }

    return [
      {
        "resources": baseResources,
        "matches": ["<all_urls>"]
      },
      {
        "resources": required.wasmFiles,
        "matches": ["file://*/*"]
      }
    ].filter(resource => resource.resources.length > 0);
  }

  // Initialize on load
  if (typeof chrome !== 'undefined' && chrome.storage) {
    loadConfig().catch(console.warn);
  }

  // Public API
  return {
    AVAILABLE_ENGINES,
    loadConfig,
    saveConfig,
    getCurrentEngine,
    isPdfEnabled,
    getRequiredFiles,
    getConfigUI,
    isValidEngine,
    getRecommendedEngine,
    getWebAccessibleResources,
    get config() { return currentConfig; }
  };

}));