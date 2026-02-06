/**
 * Elegant Translation Progress Indicator
 * Shows real-time translation status, progress, and time estimates
 */

import { logger } from './logger.js';

// Avoid redeclaration errors in Brave Browser
if (typeof window !== 'undefined' && window.TranslationProgressIndicator) {
  logger.debug('ProgressIndicator', 'Class already exists, skipping redeclaration');
} else {

class TranslationProgressIndicator {
  constructor() {
    this.container = null;
    this.progressCard = null;
    this.isVisible = false;
    this.isMinimized = false;
    this.startTime = null;
    this.totalBatches = 0;
    this.completedBatches = 0;
    this.currentStatus = 'scanning';
    this.estimatedTimeRemaining = null;
    this.throughputHistory = [];
    this.cancelCallback = null;

    this.createProgressIndicator();
    this.loadStyles();
  }

  /**
   * Load the progress indicator CSS styles
   */
  loadStyles() {
    if (document.getElementById('translation-progress-styles')) {
      return; // Already loaded
    }

    const link = document.createElement('link');
    link.id = 'translation-progress-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/translation-progress.css');
    document.head.appendChild(link);
  }

  /**
   * Create the progress indicator HTML structure
   */
  createProgressIndicator() {
    this.container = document.createElement('div');
    this.container.className = 'translation-progress-float';

    this.container.innerHTML = `
      <div class="progress-card">
        <div class="progress-header">
          <div class="progress-title">
            <span class="progress-icon">🌐</span>
            Translating Page
          </div>
          <div class="progress-controls">
            <button class="control-btn minimize" title="Minimize" aria-label="Minimize progress indicator">−</button>
            <button class="control-btn cancel" title="Cancel" aria-label="Cancel translation">×</button>
          </div>
        </div>

        <div class="progress-status scanning">
          <span class="status-spinner"></span>
          Scanning page for translatable content...
        </div>

        <div class="progress-bar-section">
          <div class="progress-bar-container">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: 0%"></div>
            </div>
            <span class="progress-percentage">0%</span>
          </div>
          <div class="progress-details">
            <span class="batch-info">Batch 0 of 0</span>
            <span class="time-estimate">Calculating...</span>
          </div>
        </div>

        <div class="batch-progress" style="display: none;">
          <div class="batch-current">Processing batch 1</div>
          <div class="throughput">~ texts/sec</div>
        </div>

        <div class="rate-limit-indicator" style="display: none;">
          <span class="waiting-icon">⏳</span>
          Waiting for rate limit...
        </div>

        <div class="progress-error" style="display: none;">
          <div class="error-message"></div>
          <div class="error-actions">
            <button class="error-action-btn">Retry</button>
            <button class="error-action-btn secondary">Cancel</button>
          </div>
        </div>

        <div class="completion-summary" style="display: none;">
          <span class="completion-stats">0 texts translated</span>
          <span class="completion-time">in 0s</span>
        </div>
      </div>
    `;

    // Add event listeners
    this.setupEventListeners();

    // Don't add to DOM yet - will be added when show() is called
  }

  /**
   * Setup event listeners for controls
   */
  setupEventListeners() {
    const minimizeBtn = this.container.querySelector('.minimize');
    const cancelBtn = this.container.querySelector('.cancel');
    const retryBtn = this.container.querySelector('.error-action-btn:not(.secondary)');
    const errorCancelBtn = this.container.querySelector('.error-action-btn.secondary');

    minimizeBtn.addEventListener('click', () => this.toggleMinimize());
    cancelBtn.addEventListener('click', () => this.cancel());
    retryBtn.addEventListener('click', () => this.retry());
    errorCancelBtn.addEventListener('click', () => this.cancel());
  }

  /**
   * Show the progress indicator
   */
  show() {
    if (this.isVisible) return;

    this.startTime = Date.now();
    document.body.appendChild(this.container);

    // Trigger animation
    requestAnimationFrame(() => {
      this.container.classList.add('visible');
    });

    this.isVisible = true;
  }

  /**
   * Hide the progress indicator
   */
  hide() {
    if (!this.isVisible) return;

    this.container.classList.add('hiding');

    setTimeout(() => {
      if (this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
      this.container.classList.remove('visible', 'hiding');
      this.isVisible = false;
    }, 300);
  }

  /**
   * Update progress status
   */
  updateStatus(status, message = null) {
    this.currentStatus = status;
    const statusElement = this.container.querySelector('.progress-status');
    const messages = {
      scanning: 'Scanning page for translatable content...',
      translating: 'Translating content...',
      waiting: 'Waiting due to rate limit...',
      caching: 'Caching translations...',
      complete: 'Translation completed!',
      error: 'Translation error occurred'
    };

    statusElement.className = `progress-status ${status}`;

    if (status === 'translating' || status === 'waiting') {
      statusElement.innerHTML = `<span class="status-spinner"></span>${message || messages[status]}`;
    } else {
      statusElement.innerHTML = message || messages[status];
    }

    // Show/hide rate limit indicator
    const rateLimitIndicator = this.container.querySelector('.rate-limit-indicator');
    rateLimitIndicator.style.display = status === 'waiting' ? 'flex' : 'none';
  }

  /**
   * Update progress bar and batch information
   */
  updateProgress(completed, total, currentBatch = null) {
    this.completedBatches = completed;
    this.totalBatches = total;

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const progressFill = this.container.querySelector('.progress-bar-fill');
    const progressPercentage = this.container.querySelector('.progress-percentage');
    const batchInfo = this.container.querySelector('.batch-info');

    progressFill.style.width = `${percentage}%`;
    progressPercentage.textContent = `${percentage}%`;
    batchInfo.textContent = `Batch ${completed} of ${total}`;

    // Update progress bar color based on status
    progressFill.className = `progress-bar-fill ${this.currentStatus}`;

    // Calculate and update time estimate
    this.updateTimeEstimate();

    // Update batch progress section
    if (currentBatch !== null) {
      const batchProgress = this.container.querySelector('.batch-progress');
      const batchCurrent = this.container.querySelector('.batch-current');
      batchCurrent.textContent = `Processing batch ${currentBatch}`;
      batchProgress.style.display = 'flex';
    }
  }

  /**
   * Calculate and update time estimate
   */
  updateTimeEstimate() {
    const timeEstimate = this.container.querySelector('.time-estimate');

    if (this.completedBatches === 0 || !this.startTime) {
      timeEstimate.textContent = 'Calculating...';
      return;
    }

    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = this.completedBatches / elapsed;
    const remaining = this.totalBatches - this.completedBatches;

    if (remaining === 0) {
      timeEstimate.textContent = `Completed in ${elapsed.toFixed(1)}s`;
      timeEstimate.className = 'time-estimate';
      return;
    }

    const estimatedSeconds = remaining / rate;

    if (estimatedSeconds < 60) {
      timeEstimate.textContent = `~${Math.round(estimatedSeconds)}s remaining`;
    } else {
      const minutes = Math.floor(estimatedSeconds / 60);
      const seconds = Math.round(estimatedSeconds % 60);
      timeEstimate.textContent = `~${minutes}m ${seconds}s remaining`;
    }

    // Add urgency class if taking too long
    timeEstimate.className = estimatedSeconds > 120 ? 'time-estimate urgent' : 'time-estimate';

    // Update throughput
    this.updateThroughput(rate);
  }

  /**
   * Update throughput display
   */
  updateThroughput(rate) {
    const throughput = this.container.querySelector('.throughput');
    if (rate > 0) {
      throughput.textContent = `${rate.toFixed(1)} batches/sec`;
    }
  }

  /**
   * Show completion state
   */
  showCompletion(totalTexts, totalTime) {
    this.updateStatus('complete');
    this.updateProgress(this.totalBatches, this.totalBatches);

    const progressCard = this.container.querySelector('.progress-card');
    progressCard.classList.add('completed');

    const completionSummary = this.container.querySelector('.completion-summary');
    const completionStats = this.container.querySelector('.completion-stats');
    const completionTime = this.container.querySelector('.completion-time');

    completionStats.textContent = `${totalTexts} texts translated`;
    completionTime.textContent = `in ${(totalTime / 1000).toFixed(1)}s`;
    completionSummary.style.display = 'flex';

    // Auto-hide after 3 seconds
    setTimeout(() => {
      this.hide();
    }, 3000);
  }

  /**
   * Show error state
   */
  showError(errorMessage) {
    this.updateStatus('error');

    const errorSection = this.container.querySelector('.progress-error');
    const errorMessageElement = this.container.querySelector('.error-message');

    errorMessageElement.textContent = errorMessage;
    errorSection.style.display = 'block';
  }

  /**
   * Toggle minimize state
   */
  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    const progressCard = this.container.querySelector('.progress-card');
    const minimizeBtn = this.container.querySelector('.minimize');

    if (this.isMinimized) {
      progressCard.classList.add('minimized');
      minimizeBtn.textContent = '+';
      minimizeBtn.title = 'Expand';
    } else {
      progressCard.classList.remove('minimized');
      minimizeBtn.textContent = '−';
      minimizeBtn.title = 'Minimize';
    }
  }

  /**
   * Cancel translation
   */
  cancel() {
    if (this.cancelCallback) {
      this.cancelCallback();
    }
    this.hide();
  }

  /**
   * Retry translation
   */
  retry() {
    const errorSection = this.container.querySelector('.progress-error');
    errorSection.style.display = 'none';

    // Reset progress
    this.completedBatches = 0;
    this.updateProgress(0, this.totalBatches);
    this.updateStatus('scanning');

    if (this.cancelCallback) {
      this.cancelCallback('retry');
    }
  }

  /**
   * Set cancel callback
   */
  setCancelCallback(callback) {
    this.cancelCallback = callback;
  }

  /**
   * Reset the progress indicator
   */
  reset() {
    this.completedBatches = 0;
    this.totalBatches = 0;
    this.startTime = null;
    this.currentStatus = 'scanning';
    this.isMinimized = false;

    const progressCard = this.container.querySelector('.progress-card');
    progressCard.classList.remove('completed', 'minimized');

    this.updateProgress(0, 0);
    this.updateStatus('scanning');

    // Hide optional sections
    this.container.querySelector('.batch-progress').style.display = 'none';
    this.container.querySelector('.rate-limit-indicator').style.display = 'none';
    this.container.querySelector('.progress-error').style.display = 'none';
    this.container.querySelector('.completion-summary').style.display = 'none';
  }
}

// Export for use in content script
if (typeof window !== 'undefined') {
  window.TranslationProgressIndicator = TranslationProgressIndicator;
}

} // End of redeclaration protection