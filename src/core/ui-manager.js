/**
 * UI Manager - Responsible for all UI elements in content script
 * 
 * Handles status display, progress tracking, error messages, selection bubbles,
 * and theme management for the content script.
 */

class UIManager {
  constructor(logger) {
    this.logger = logger;
    this.progressHud = null;
    this.selectionBubble = null;
    this.currentStatus = null;
    this.currentTheme = null;
    
    // Progress tracking
    this.progress = { total: 0, done: 0 };
  }

  /**
   * Ensure theme CSS is loaded
   * @param {string} style - Theme style name
   */
  ensureThemeCss(style) {
    if (this.currentTheme === style) return;
    
    this.currentTheme = style;
    const id = 'qwen-theme-css';
    let existing = document.getElementById(id);
    
    if (existing) {
      existing.remove();
    }
    
    if (style && style !== 'default') {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL(`themes/${style}.css`);
      link.onerror = () => {
        this.logger?.warn('Failed to load theme:', style);
      };
      document.head.appendChild(link);
    }
  }

  /**
   * Set status message
   * @param {string} message - Status message
   * @param {boolean} isError - Whether this is an error status
   */
  setStatus(message, isError = false) {
    this.currentStatus = { message, isError, timestamp: Date.now() };
    
    // Update progress HUD if it exists
    if (this.progressHud) {
      const statusEl = this.progressHud.querySelector('.qwen-status');
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `qwen-status ${isError ? 'error' : ''}`;
      }
    }
    
    this.logger?.debug(`Status: ${message}${isError ? ' (error)' : ''}`);
  }

  /**
   * Clear current status
   */
  clearStatus() {
    this.currentStatus = null;
    
    if (this.progressHud) {
      const statusEl = this.progressHud.querySelector('.qwen-status');
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'qwen-status';
      }
    }
  }

  /**
   * Update progress tracking
   * @param {Object} progressData - Progress data {total, done}
   */
  updateProgress(progressData) {
    this.progress = { ...this.progress, ...progressData };
    this.updateProgressHud();
    this.updateTopProgressBar();
  }

  /**
   * Update progress HUD display
   */
  updateProgressHud() {
    if (!this.progressHud && this.progress.total > 0) {
      this.createProgressHud();
    }
    
    if (this.progressHud) {
      const progressEl = this.progressHud.querySelector('.qwen-progress');
      const statusEl = this.progressHud.querySelector('.qwen-status');
      
      if (progressEl) {
        const percent = this.progress.total > 0 ? 
          Math.round((this.progress.done / this.progress.total) * 100) : 0;
        progressEl.style.width = `${percent}%`;
        progressEl.setAttribute('aria-valuenow', percent);
      }
      
      if (statusEl && this.currentStatus) {
        statusEl.textContent = this.currentStatus.message;
      }
      
      // Hide HUD when complete
      if (this.progress.done >= this.progress.total && this.progress.total > 0) {
        setTimeout(() => this.hideProgressHud(), 2000);
      }
    }
  }

  /**
   * Create progress HUD element
   */
  createProgressHud() {
    if (this.progressHud) return;
    
    this.progressHud = document.createElement('div');
    this.progressHud.className = 'qwen-progress-hud';
    this.progressHud.innerHTML = `
      <div class="qwen-progress-container">
        <div class="qwen-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="qwen-progress"></div>
        </div>
        <div class="qwen-status"></div>
      </div>
    `;
    
    // Add styles
    this.progressHud.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      z-index: 10000;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      min-width: 200px;
      backdrop-filter: blur(5px);
    `;
    
    const progressBar = this.progressHud.querySelector('.qwen-progress-bar');
    progressBar.style.cssText = `
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 5px;
    `;
    
    const progress = this.progressHud.querySelector('.qwen-progress');
    progress.style.cssText = `
      height: 100%;
      background: #4CAF50;
      width: 0%;
      transition: width 0.3s ease;
    `;
    
    document.body.appendChild(this.progressHud);
  }

  /**
   * Hide progress HUD
   */
  hideProgressHud() {
    if (this.progressHud) {
      this.progressHud.remove();
      this.progressHud = null;
    }
  }

  /**
   * Update top progress bar
   */
  updateTopProgressBar() {
    let topBar = document.getElementById('qwen-top-progress');
    
    if (this.progress.total > 0 && this.progress.done < this.progress.total) {
      if (!topBar) {
        topBar = document.createElement('div');
        topBar.id = 'qwen-top-progress';
        topBar.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 3px;
          background: #4CAF50;
          z-index: 10001;
          transform-origin: left;
          transition: transform 0.3s ease;
        `;
        document.body.appendChild(topBar);
      }
      
      const percent = (this.progress.done / this.progress.total) * 100;
      topBar.style.transform = `scaleX(${percent / 100})`;
    } else if (topBar) {
      this.hideTopProgressBar();
    }
  }

  /**
   * Hide top progress bar
   */
  hideTopProgressBar() {
    const topBar = document.getElementById('qwen-top-progress');
    if (topBar) {
      topBar.style.transform = 'scaleX(1)';
      setTimeout(() => topBar.remove(), 300);
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message to display
   */
  showError(message) {
    this.setStatus(message, true);
    
    // Create temporary error notification
    const errorEl = document.createElement('div');
    errorEl.className = 'qwen-error-notification';
    errorEl.textContent = message;
    errorEl.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #f44336;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      z-index: 10002;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      max-width: 400px;
      text-align: center;
      backdrop-filter: blur(5px);
    `;
    
    document.body.appendChild(errorEl);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (errorEl.parentNode) {
        errorEl.remove();
      }
    }, 5000);
  }

  /**
   * Add feedback UI to translated element
   * @param {Element} el - Element that was translated
   * @param {string} original - Original text
   * @param {string} translated - Translated text
   * @param {number} confidence - Translation confidence score
   */
  addFeedbackUI(el, original, translated, confidence) {
    if (!el || el.hasAttribute('data-qwen-feedback')) return;
    
    el.setAttribute('data-qwen-feedback', 'true');
    el.style.position = 'relative';
    
    const feedbackBtn = document.createElement('span');
    feedbackBtn.className = 'qwen-feedback-btn';
    feedbackBtn.innerHTML = '👥';
    feedbackBtn.title = `Translation confidence: ${Math.round(confidence * 100)}%`;
    feedbackBtn.style.cssText = `
      position: absolute;
      top: -5px;
      right: -5px;
      width: 16px;
      height: 16px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      cursor: pointer;
      z-index: 1000;
    `;
    
    feedbackBtn.onclick = (e) => {
      e.stopPropagation();
      this.showFeedbackModal(original, translated, confidence);
    };
    
    el.appendChild(feedbackBtn);
  }

  /**
   * Show feedback modal for translation
   * @param {string} original - Original text
   * @param {string} translated - Translated text
   * @param {number} confidence - Translation confidence
   */
  showFeedbackModal(original, translated, confidence) {
    // Implementation for feedback modal
    // This could be expanded to include rating, correction suggestions, etc.
    console.log('Feedback modal:', { original, translated, confidence });
  }

  /**
   * Handle text selection and show translation bubble
   * @param {Selection} selection - Browser selection object
   */
  handleSelection(selection) {
    this.removeSelectionBubble();
    
    if (!selection.toString().trim()) return;
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    this.selectionBubble = document.createElement('div');
    this.selectionBubble.className = 'qwen-selection-bubble';
    this.selectionBubble.innerHTML = `
      <button class="qwen-translate-selection">Translate</button>
    `;
    
    this.selectionBubble.style.cssText = `
      position: fixed;
      top: ${rect.top - 40}px;
      left: ${rect.left + (rect.width / 2) - 40}px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 5px 10px;
      border-radius: 5px;
      z-index: 10003;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
    `;
    
    const translateBtn = this.selectionBubble.querySelector('.qwen-translate-selection');
    translateBtn.onclick = () => {
      const text = selection.toString();
      this.translateSelection(text);
    };
    
    document.body.appendChild(this.selectionBubble);
    
    // Auto-remove on click outside
    setTimeout(() => {
      document.addEventListener('click', this.removeSelectionBubble.bind(this), { once: true });
    }, 100);
  }

  /**
   * Remove selection bubble
   */
  removeSelectionBubble() {
    if (this.selectionBubble) {
      this.selectionBubble.remove();
      this.selectionBubble = null;
    }
  }

  /**
   * Translate selected text
   * @param {string} text - Selected text to translate
   */
  translateSelection(text) {
    // This would integrate with the translation processor
    this.logger?.debug('Translating selection:', text);
    this.removeSelectionBubble();
  }

  /**
   * Clean up UI elements
   */
  cleanup() {
    this.hideProgressHud();
    this.hideTopProgressBar();
    this.removeSelectionBubble();
    this.clearStatus();
    
    // Remove theme CSS
    const themeCSS = document.getElementById('qwen-theme-css');
    if (themeCSS) {
      themeCSS.remove();
    }
    
    // Remove feedback buttons
    document.querySelectorAll('.qwen-feedback-btn').forEach(btn => btn.remove());
    
    // Remove error notifications
    document.querySelectorAll('.qwen-error-notification').forEach(el => el.remove());
  }

  /**
   * Get UI state for debugging
   * @returns {Object} - Current UI state
   */
  getState() {
    return {
      progress: this.progress,
      currentStatus: this.currentStatus,
      currentTheme: this.currentTheme,
      hasProgressHud: !!this.progressHud,
      hasSelectionBubble: !!this.selectionBubble,
    };
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIManager;
} else {
  self.qwenUIManager = UIManager;
}