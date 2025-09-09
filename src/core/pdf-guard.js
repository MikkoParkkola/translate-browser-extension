/**
 * PDF Engine Guard
 * Prevents PDF functionality from loading if user has disabled PDF engines
 * Provides graceful fallback when PDF features are not available
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.pdfGuard = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  let pdfEngineConfig = null;
  let configLoaded = false;

  /**
   * Load PDF engine configuration
   * @returns {Promise<string>}
   */
  async function loadPdfEngineConfig() {
    if (configLoaded && pdfEngineConfig !== null) {
      return pdfEngineConfig;
    }

    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get({ pdfEngine: 'none' }, resolve);
      });
      
      pdfEngineConfig = result.pdfEngine || 'none';
      configLoaded = true;
      return pdfEngineConfig;
    } catch (error) {
      console.warn('Failed to load PDF engine config, defaulting to none:', error);
      pdfEngineConfig = 'none';
      configLoaded = true;
      return 'none';
    }
  }

  /**
   * Check if PDF functionality is enabled
   * @returns {Promise<boolean>}
   */
  async function isPdfEnabled() {
    const engine = await loadPdfEngineConfig();
    return engine !== 'none';
  }

  /**
   * Get current PDF engine
   * @returns {Promise<string>}
   */
  async function getCurrentEngine() {
    return await loadPdfEngineConfig();
  }

  /**
   * Check if specific PDF engine is available
   * @param {string} engineName 
   * @returns {Promise<boolean>}
   */
  async function isEngineAvailable(engineName) {
    const currentEngine = await loadPdfEngineConfig();
    return currentEngine === engineName;
  }

  /**
   * Guard function for PDF operations
   * Prevents execution if PDF is disabled
   * @param {Function} pdfFunction 
   * @param {Function} fallbackFunction 
   * @returns {Promise<any>}
   */
  async function guardPdfOperation(pdfFunction, fallbackFunction = null) {
    const enabled = await isPdfEnabled();
    
    if (!enabled) {
      console.info('PDF functionality disabled by user configuration');
      
      if (fallbackFunction) {
        return await fallbackFunction();
      }
      
      // Default fallback: return disabled status
      return { 
        disabled: true, 
        reason: 'PDF engine disabled in settings',
        message: 'PDF translation is disabled. Enable it in extension settings to use this feature.'
      };
    }

    try {
      return await pdfFunction();
    } catch (error) {
      console.error('PDF operation failed:', error);
      
      if (fallbackFunction) {
        return await fallbackFunction();
      }
      
      throw error;
    }
  }

  /**
   * Show PDF disabled message to user
   * @param {HTMLElement} container 
   */
  function showPdfDisabledMessage(container) {
    if (!container) return;
    
    const message = document.createElement('div');
    message.className = 'pdf-disabled-message';
    message.innerHTML = `
      <div class="pdf-disabled-content">
        <div class="pdf-disabled-icon">📄</div>
        <h3>PDF Translation Disabled</h3>
        <p>PDF translation is currently disabled to reduce bundle size.</p>
        <p>To enable PDF translation:</p>
        <ol>
          <li>Open extension settings</li>
          <li>Go to Advanced tab</li>
          <li>Select a PDF engine</li>
          <li>Reload this page</li>
        </ol>
        <button id="open-pdf-settings" class="btn-primary">Open Settings</button>
      </div>
    `;
    
    // Style the message
    message.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      background: var(--color-gray-50, #f9fafb);
      border: 2px dashed var(--color-gray-300, #d1d5db);
      border-radius: 8px;
      margin: 20px;
    `;
    
    const content = message.querySelector('.pdf-disabled-content');
    content.style.cssText = `
      text-align: center;
      max-width: 400px;
      padding: 40px;
    `;
    
    const icon = message.querySelector('.pdf-disabled-icon');
    icon.style.cssText = `
      font-size: 48px;
      margin-bottom: 16px;
    `;
    
    // Add settings button handler
    message.querySelector('#open-pdf-settings')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    container.innerHTML = '';
    container.appendChild(message);
  }

  /**
   * Redirect PDF URL to browser's native viewer
   * @param {string} pdfUrl 
   */
  function redirectToNativePdf(pdfUrl) {
    console.info('Redirecting to native PDF viewer due to disabled PDF engine');
    window.location.href = pdfUrl;
  }

  /**
   * Block PDF viewer initialization if disabled
   * @param {Function} initFunction 
   * @returns {Promise<void>}
   */
  async function guardPdfViewer(initFunction) {
    const enabled = await isPdfEnabled();
    
    if (!enabled) {
      // Show disabled message instead of initializing viewer
      const container = document.body || document.documentElement;
      showPdfDisabledMessage(container);
      return;
    }

    // PDF enabled, proceed with initialization
    try {
      await initFunction();
    } catch (error) {
      console.error('PDF viewer initialization failed:', error);
      
      // Show error message
      const container = document.body || document.documentElement;
      const errorMessage = document.createElement('div');
      errorMessage.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <h3>PDF Viewer Error</h3>
          <p>Failed to initialize PDF viewer: ${error.message}</p>
          <button onclick="location.reload()">Retry</button>
        </div>
      `;
      container.innerHTML = '';
      container.appendChild(errorMessage);
    }
  }

  /**
   * Get configuration for UI display
   * @returns {Promise<Object>}
   */
  async function getConfigUI() {
    const engine = await loadPdfEngineConfig();
    const enabled = engine !== 'none';
    
    const engineNames = {
      none: 'Disabled',
      pdfjs: 'PDF.js',
      pdfium: 'PDFium',
      mupdf: 'MuPDF'
    };
    
    return {
      enabled,
      engine,
      engineName: engineNames[engine] || 'Unknown',
      message: enabled 
        ? `PDF translation enabled with ${engineNames[engine]}`
        : 'PDF translation disabled for reduced bundle size'
    };
  }

  /**
   * Reset configuration cache (for testing/debugging)
   */
  function resetCache() {
    configLoaded = false;
    pdfEngineConfig = null;
  }

  // Public API
  return {
    isPdfEnabled,
    getCurrentEngine,
    isEngineAvailable,
    guardPdfOperation,
    guardPdfViewer,
    showPdfDisabledMessage,
    redirectToNativePdf,
    getConfigUI,
    resetCache
  };

}));