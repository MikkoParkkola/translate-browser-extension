/**
 * Local Model UI Components
 * Provides progress tracking and status UI for local model operations.
 *
 * Updated for wllama backend:
 * - Sharded download progress (shows per-shard progress)
 * - WebGPU/WASM backend indicator
 * - No more single ArrayBuffer size warnings
 */

class LocalModelUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.progressInterval = null;
    this.isInitialized = false;

    this.init();
  }

  init() {
    if (!this.container) {
      console.error('[LocalModelUI] Container element not found');
      return;
    }

    this.createUI();
    this.bindEvents();
    this.isInitialized = true;

    // Initial status update
    this.updateStatus();
  }

  createUI() {
    this.container.innerHTML = `
      <div class="local-model-panel">
        <div class="local-model-header">
          <h3>Local Translation Model</h3>
          <div class="local-model-status">
            <span id="local-model-status-indicator" class="status-indicator"></span>
            <span id="local-model-status-text">Checking...</span>
          </div>
        </div>

        <div class="local-model-info" id="local-model-info" style="display: none;">
          <div class="model-details">
            <div class="detail-item">
              <label>Model:</label>
              <span id="local-model-name">TranslateGemma Q4</span>
            </div>
            <div class="detail-item">
              <label>Backend:</label>
              <span id="local-model-backend">wllama (WebGPU/WASM)</span>
            </div>
            <div class="detail-item">
              <label>Size:</label>
              <span>~2.5 GB (sharded)</span>
            </div>
            <div class="detail-item" id="performance-stats" style="display: none;">
              <label>Performance:</label>
              <span id="performance-text">Loading...</span>
            </div>
          </div>
        </div>

        <div class="local-model-progress" id="local-model-progress" style="display: none;">
          <div class="progress-header">
            <span id="progress-status">Downloading model shards...</span>
            <span id="progress-percentage">0%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
          <div class="progress-details">
            <span id="progress-speed"></span>
            <span id="progress-eta"></span>
          </div>
          <div class="progress-shard-info" id="progress-shard-info" style="display: none;">
            <span id="progress-shard-text">Shard 1 of 5</span>
          </div>
          <button id="cancel-download" class="btn-secondary">Cancel</button>
        </div>

        <div class="local-model-validation" id="local-model-validation" style="display: none;">
          <div class="validation-header">
            <h4>Model Validation</h4>
            <span id="validation-status">Starting validation...</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="validation-progress-fill"></div>
          </div>
          <div class="validation-steps" id="validation-steps"></div>
          <div class="validation-results" id="validation-results" style="display: none;">
            <div class="validation-summary" id="validation-summary"></div>
            <div class="validation-details" id="validation-details"></div>
          </div>
        </div>

        <div class="local-model-actions">
          <button id="download-model" class="btn-primary" style="display: none;">
            Download Model
          </button>
          <button id="validate-model" class="btn-secondary" style="display: none;">
            Validate Model
          </button>
          <button id="delete-model" class="btn-secondary" style="display: none;">
            Delete Model
          </button>
          <button id="test-model" class="btn-secondary" style="display: none;">
            Test Translation
          </button>
          <button id="view-health" class="btn-secondary">
            View Health Status
          </button>
        </div>

        <div class="local-model-health" id="local-model-health" style="display: none;">
          <div class="health-header">
            <h4>Health Check Results</h4>
            <span id="health-timestamp"></span>
          </div>
          <div id="health-results"></div>
        </div>

        <div class="local-model-error" id="local-model-error" style="display: none;">
          <div class="error-header">
            <span class="error-icon">Warning</span>
            <span>Error Details</span>
          </div>
          <div id="error-message"></div>
          <button id="retry-action" class="btn-primary">Retry</button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const downloadBtn = document.getElementById('download-model');
    const validateBtn = document.getElementById('validate-model');
    const deleteBtn = document.getElementById('delete-model');
    const testBtn = document.getElementById('test-model');
    const healthBtn = document.getElementById('view-health');
    const cancelBtn = document.getElementById('cancel-download');
    const retryBtn = document.getElementById('retry-action');

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this.startDownload());
    }

    if (validateBtn) {
      validateBtn.addEventListener('click', () => this.startValidation());
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deleteModel());
    }

    if (testBtn) {
      testBtn.addEventListener('click', () => this.testTranslation());
    }

    if (healthBtn) {
      healthBtn.addEventListener('click', () => this.showHealthCheck());
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelDownload());
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.retryLastAction());
    }
  }

  async updateStatus() {
    if (!this.isInitialized || !window.localModelManager) return;

    try {
      const modelInfo = window.localModelManager.getModelInfo();
      this.renderStatus(modelInfo);

      if (modelInfo.available) {
        this.updatePerformanceStats(modelInfo.performanceStats);
      }

    } catch (error) {
      console.error('[LocalModelUI] Status update failed:', error);
      this.showError('Failed to update status', error.message);
    }
  }

  renderStatus(modelInfo) {
    const statusIndicator = document.getElementById('local-model-status-indicator');
    const statusText = document.getElementById('local-model-status-text');
    const downloadBtn = document.getElementById('download-model');
    const validateBtn = document.getElementById('validate-model');
    const deleteBtn = document.getElementById('delete-model');
    const testBtn = document.getElementById('test-model');
    const infoPanel = document.getElementById('local-model-info');
    const progressPanel = document.getElementById('local-model-progress');
    const validationPanel = document.getElementById('local-model-validation');

    if (modelInfo.downloading) {
      statusIndicator.className = 'status-indicator downloading';
      statusText.textContent = 'Downloading shards...';
      this.showProgress();
      validationPanel.style.display = 'none';
    } else if (modelInfo.ready) {
      statusIndicator.className = 'status-indicator ready';
      statusText.textContent = `Ready (${  modelInfo.backend || 'wllama'  })`;
      infoPanel.style.display = 'block';
      progressPanel.style.display = 'none';
      validationPanel.style.display = 'none';
    } else if (modelInfo.available) {
      statusIndicator.className = 'status-indicator available';
      statusText.textContent = 'Available (Not Loaded)';
      infoPanel.style.display = 'block';
      progressPanel.style.display = 'none';
      validationPanel.style.display = 'none';
    } else {
      statusIndicator.className = 'status-indicator unavailable';
      statusText.textContent = 'Not Downloaded';
      infoPanel.style.display = 'none';
      progressPanel.style.display = 'none';
      validationPanel.style.display = 'none';
    }

    downloadBtn.style.display = modelInfo.available ? 'none' : 'inline-block';
    validateBtn.style.display = modelInfo.available ? 'inline-block' : 'none';
    deleteBtn.style.display = modelInfo.available ? 'inline-block' : 'none';
    testBtn.style.display = modelInfo.ready ? 'inline-block' : 'none';

    if (modelInfo.performanceStats && modelInfo.performanceStats.lastError) {
      this.showError('Recent Error', modelInfo.performanceStats.lastError.message);
    } else {
      this.hideError();
    }
  }

  updatePerformanceStats(stats) {
    const perfElement = document.getElementById('performance-stats');
    const perfText = document.getElementById('performance-text');

    if (stats && stats.totalTranslations > 0) {
      perfElement.style.display = 'block';
      perfText.textContent = `${stats.totalTranslations} translations, ${stats.successRate}% success rate, ~${Math.round(stats.averageInferenceTime)}ms avg`;
    }
  }

  async startDownload() {
    if (!window.localModelManager) return;

    try {
      this.showProgress();
      this._downloadStartTime = Date.now();
      this._lastProgressLoaded = 0;

      await window.localModelManager.downloadModel((progressInfo) => {
        this.updateProgressUI(progressInfo);
      });

      this.updateStatus();
    } catch (error) {
      console.error('[LocalModelUI] Download failed:', error);
      this.showError('Download Failed', error.message);
      this.hideProgress();
    }
  }

  showProgress() {
    const progressPanel = document.getElementById('local-model-progress');
    progressPanel.style.display = 'block';

    if (!this.progressInterval) {
      this.progressInterval = setInterval(() => {
        if (window.localModelManager) {
          const progress = window.localModelManager.getDownloadProgress();
          if (!progress.isDownloading) {
            this.hideProgress();
          }
        }
      }, 1000);
    }
  }

  hideProgress() {
    const progressPanel = document.getElementById('local-model-progress');
    progressPanel.style.display = 'none';

    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  updateProgressUI(progressInfo) {
    const progressFill = document.getElementById('progress-fill');
    const progressPercentage = document.getElementById('progress-percentage');
    const progressSpeed = document.getElementById('progress-speed');
    const progressETA = document.getElementById('progress-eta');
    const progressStatus = document.getElementById('progress-status');
    const shardInfo = document.getElementById('progress-shard-info');
    const shardText = document.getElementById('progress-shard-text');

    if (progressInfo.progress !== undefined) {
      progressFill.style.width = `${progressInfo.progress}%`;
      progressPercentage.textContent = `${Math.round(progressInfo.progress)}%`;
    }

    // Calculate speed
    if (progressInfo.loaded && this._downloadStartTime) {
      const elapsed = (Date.now() - this._downloadStartTime) / 1000;
      if (elapsed > 0) {
        const speed = progressInfo.loaded / elapsed;
        const speedMBps = (speed / (1024 * 1024)).toFixed(1);
        progressSpeed.textContent = `${speedMBps} MB/s`;

        // Calculate ETA
        if (progressInfo.total > 0) {
          const remaining = progressInfo.total - progressInfo.loaded;
          const eta = Math.round(remaining / speed);
          if (eta > 60) {
            progressETA.textContent = `ETA: ${Math.round(eta / 60)}m ${eta % 60}s`;
          } else {
            progressETA.textContent = `ETA: ${eta}s`;
          }
        }
      }
    }

    if (progressInfo.status) {
      progressStatus.textContent = progressInfo.status;
    }

    // Show shard info if available
    if (progressInfo.shardIndex !== undefined && progressInfo.shardCount !== undefined) {
      shardInfo.style.display = 'block';
      shardText.textContent = `Shard ${progressInfo.shardIndex + 1} of ${progressInfo.shardCount}`;
    }

    if (progressInfo.complete) {
      progressStatus.textContent = 'Download complete! Loading model...';
    }
  }

  async deleteModel() {
    if (!window.localModelManager) return;

    const confirmed = confirm(
      'Are you sure you want to delete the local model? ' +
      'This will clear all cached shards (~2.5 GB) and you will need to download them again.',
    );

    if (!confirmed) return;

    try {
      await window.localModelManager.deleteModel();
      this.updateStatus();
    } catch (error) {
      console.error('[LocalModelUI] Delete failed:', error);
      this.showError('Delete Failed', error.message);
    }
  }

  async startValidation() {
    if (!window.localModelManager) return;

    try {
      this.showValidation();

      const validationResult = await window.localModelManager.validateModel((progressInfo) => {
        this.updateValidationProgress(progressInfo);
      });

      this.showValidationResults(validationResult);
    } catch (error) {
      console.error('[LocalModelUI] Validation failed:', error);
      this.showError('Model Validation Failed', error.message);
      this.hideValidation();
    }
  }

  showValidation() {
    const validationPanel = document.getElementById('local-model-validation');
    const validationResults = document.getElementById('validation-results');

    validationPanel.style.display = 'block';
    validationResults.style.display = 'none';

    const progressFill = document.getElementById('validation-progress-fill');
    progressFill.style.width = '0%';

    const validationSteps = document.getElementById('validation-steps');
    validationSteps.innerHTML = '';
  }

  hideValidation() {
    const validationPanel = document.getElementById('local-model-validation');
    validationPanel.style.display = 'none';
  }

  updateValidationProgress(progressInfo) {
    const progressFill = document.getElementById('validation-progress-fill');
    const validationStatus = document.getElementById('validation-status');
    const validationSteps = document.getElementById('validation-steps');

    if (progressInfo.progress !== undefined) {
      progressFill.style.width = `${progressInfo.progress}%`;
    }

    if (progressInfo.step) {
      validationStatus.textContent = this.getValidationStepText(progressInfo.step);

      const stepElement = document.createElement('div');
      stepElement.className = 'validation-step';
      stepElement.innerHTML = `
        <span class="step-icon">...</span>
        <span class="step-text">${this.getValidationStepText(progressInfo.step)}</span>
      `;
      validationSteps.appendChild(stepElement);
    }
  }

  getValidationStepText(step) {
    const stepTexts = {
      'size': 'Validating shard sizes...',
      'data-retrieval': 'Checking cached shards...',
      'checksum': 'Verifying shard integrity...',
      'structural': 'Validating GGUF structure...',
      'complete': 'Validation complete',
    };
    return stepTexts[step] || `Validating ${step}...`;
  }

  showValidationResults(result) {
    const validationResults = document.getElementById('validation-results');
    const validationSummary = document.getElementById('validation-summary');
    const validationDetails = document.getElementById('validation-details');

    validationResults.style.display = 'block';

    const statusClass = result.valid ? 'validation-success' : 'validation-failure';
    validationSummary.className = `validation-summary ${statusClass}`;
    validationSummary.innerHTML = `
      <div class="summary-status">
        <span class="summary-icon">${result.valid ? 'PASS' : 'FAIL'}</span>
        <span class="summary-text">
          ${result.valid ? 'Model validation passed' : 'Model validation failed'}
        </span>
      </div>
      <div class="summary-duration">Duration: ${result.duration}ms</div>
    `;

    let detailsHTML = '<div class="validation-checks">';

    Object.entries(result.checks).forEach(([checkName, check]) => {
      const checkClass = check.passed ? 'check-passed' : 'check-failed';
      detailsHTML += `
        <div class="validation-check ${checkClass}">
          <span class="check-icon">${check.passed ? 'OK' : 'FAIL'}</span>
          <div class="check-content">
            <span class="check-name">${checkName}:</span>
            <span class="check-message">${check.message}</span>
            ${check.details ? `<div class="check-details">${JSON.stringify(check.details, null, 2)}</div>` : ''}
          </div>
        </div>
      `;
    });

    detailsHTML += '</div>';

    if (result.details && Object.keys(result.details).length > 0) {
      detailsHTML += `
        <div class="validation-metadata">
          <h5>Additional Details</h5>
          <pre>${JSON.stringify(result.details, null, 2)}</pre>
        </div>
      `;
    }

    validationDetails.innerHTML = detailsHTML;

    const stepElements = document.querySelectorAll('#validation-steps .validation-step');
    stepElements.forEach(step => {
      const icon = step.querySelector('.step-icon');
      icon.textContent = 'OK';
      step.classList.add('step-complete');
    });

    const validationStatus = document.getElementById('validation-status');
    validationStatus.textContent = result.valid
      ? 'Validation completed successfully'
      : 'Validation completed with errors';
  }

  async testTranslation() {
    if (!window.localModelManager) return;

    try {
      const testText = 'Hello, this is a test translation.';
      const result = await window.localModelManager.translate(testText, 'en', 'es');

      alert(
        `Test Translation Success!\n\n` +
        `Original: ${testText}\n` +
        `Translated: ${result.text}\n` +
        `Time: ${result.inferenceTime || 'N/A'}ms\n` +
        `Backend: wllama`,
      );
    } catch (error) {
      console.error('[LocalModelUI] Test failed:', error);
      this.showError('Translation Test Failed', error.message);
    }
  }

  async showHealthCheck() {
    if (!window.localModelManager) return;

    try {
      const health = await window.localModelManager.healthCheck();
      this.renderHealthCheck(health);
    } catch (error) {
      console.error('[LocalModelUI] Health check failed:', error);
      this.showError('Health Check Failed', error.message);
    }
  }

  renderHealthCheck(health) {
    const healthPanel = document.getElementById('local-model-health');
    const healthTimestamp = document.getElementById('health-timestamp');
    const healthResults = document.getElementById('health-results');

    healthPanel.style.display = 'block';
    healthTimestamp.textContent = new Date(health.timestamp).toLocaleString();

    let resultsHTML = `
      <div class="health-summary ${health.status}">
        <strong>Status:</strong> ${health.status.toUpperCase()}
        ${health.summary ? `<br><strong>Summary:</strong> ${health.summary}` : ''}
      </div>
      <div class="health-checks">
    `;

    Object.entries(health.checks).forEach(([checkName, check]) => {
      resultsHTML += `
        <div class="health-check-item ${check.status || (check.passed ? 'ok' : 'fail')}">
          <span class="check-name">${checkName}:</span>
          <span class="check-status">${check.status || (check.passed ? 'OK' : 'FAIL')}</span>
          <span class="check-message">${check.message}</span>
        </div>
      `;
    });

    resultsHTML += '</div>';

    if (health.error) {
      resultsHTML += `<div class="health-error">Error: ${health.error}</div>`;
    }

    healthResults.innerHTML = resultsHTML;
  }

  cancelDownload() {
    if (window.localModelManager) {
      window.localModelManager.cancelModelDownload();
      this.hideProgress();
    }
  }

  retryLastAction() {
    this.updateStatus();
    this.hideError();
  }

  showError(title, message) {
    const errorPanel = document.getElementById('local-model-error');
    const errorMessage = document.getElementById('error-message');

    errorPanel.style.display = 'block';
    errorMessage.innerHTML = `<strong>${title}:</strong> ${message}`;
  }

  hideError() {
    const errorPanel = document.getElementById('local-model-error');
    errorPanel.style.display = 'none';
  }

  startStatusUpdates() {
    if (this.statusInterval) return;

    this.statusInterval = setInterval(() => {
      this.updateStatus();
    }, 5000);
  }

  stopStatusUpdates() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  // ================================
  // Performance Monitoring UI
  // ================================

  showPerformancePanel() {
    const existingPanel = this.container.querySelector('.performance-panel');
    if (existingPanel) {
      existingPanel.style.display = 'block';
      return;
    }

    const performancePanel = document.createElement('div');
    performancePanel.className = 'performance-panel';
    performancePanel.innerHTML = `
      <div class="performance-header">
        <h4>Performance Monitoring</h4>
        <div class="performance-controls">
          <button id="refresh-performance" class="btn-secondary">Refresh</button>
          <button id="reset-stats" class="btn-secondary">Reset Stats</button>
          <button id="toggle-monitoring" class="btn-secondary">Stop Monitoring</button>
        </div>
      </div>

      <div class="performance-content">
        <div class="performance-summary">
          <div class="perf-metric">
            <label>Total Translations:</label>
            <span id="perf-total-translations">0</span>
          </div>
          <div class="perf-metric">
            <label>Success Rate:</label>
            <span id="perf-success-rate">100%</span>
          </div>
          <div class="perf-metric">
            <label>Avg. Inference Time:</label>
            <span id="perf-avg-time">0.00s</span>
          </div>
          <div class="perf-metric">
            <label>Throughput:</label>
            <span id="perf-throughput">0 tokens/sec</span>
          </div>
          <div class="perf-metric">
            <label>Backend:</label>
            <span id="perf-backend">wllama</span>
          </div>
        </div>

        <div class="performance-trend">
          <div class="trend-header">
            <h5>Performance Trend</h5>
            <span id="trend-indicator" class="trend-stable">Stable</span>
          </div>
          <div class="trend-chart">
            <canvas id="performance-chart" width="300" height="100"></canvas>
          </div>
        </div>

        <div class="memory-usage">
          <div class="memory-header">
            <h5>Memory Usage</h5>
            <span id="memory-pressure" class="memory-normal">Normal</span>
          </div>
          <div class="memory-details">
            <div class="memory-item">
              <label>Current:</label>
              <span id="memory-current">0 MB</span>
            </div>
            <div class="memory-item">
              <label>Peak:</label>
              <span id="memory-peak">0 MB</span>
            </div>
            <div class="memory-item">
              <label>Model Size:</label>
              <span id="memory-model">~2.5 GB (sharded)</span>
            </div>
          </div>
          <div class="memory-bar">
            <div id="memory-bar-fill" class="memory-bar-fill" style="width: 0%;"></div>
          </div>
        </div>

        <div class="optimization-level">
          <div class="optimization-header">
            <h5>Optimization Level</h5>
            <select id="optimization-selector" class="optimization-select">
              <option value="low-power">Low Power</option>
              <option value="balanced" selected>Balanced</option>
              <option value="performance">Performance</option>
            </select>
          </div>
          <div class="optimization-details">
            <div class="optimization-item">
              <label>Current Level:</label>
              <span id="current-optimization">Balanced</span>
            </div>
            <div class="optimization-item">
              <label>Last Optimized:</label>
              <span id="last-optimized">Never</span>
            </div>
          </div>
        </div>

        <div class="performance-recommendations" id="performance-recommendations" style="display: none;">
          <h5>Recommendations</h5>
          <div id="recommendations-list"></div>
        </div>
      </div>
    `;

    this.container.appendChild(performancePanel);
    this.setupPerformanceEventListeners();
    this.updatePerformanceDisplay();
  }

  hidePerformancePanel() {
    const performancePanel = this.container.querySelector('.performance-panel');
    if (performancePanel) {
      performancePanel.style.display = 'none';
    }
  }

  setupPerformanceEventListeners() {
    const refreshBtn = this.container.querySelector('#refresh-performance');
    const resetBtn = this.container.querySelector('#reset-stats');
    const toggleBtn = this.container.querySelector('#toggle-monitoring');
    const optimizationSelector = this.container.querySelector('#optimization-selector');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.updatePerformanceDisplay();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to reset all performance statistics?')) {
          await window.localModelManager.resetPerformanceStats();
          this.updatePerformanceDisplay();
          this.showMessage('Performance statistics reset', 'success');
        }
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', async () => {
        const isMonitoring = toggleBtn.textContent.includes('Stop');
        if (isMonitoring) {
          await window.localModelManager.stopPerformanceMonitoring();
          toggleBtn.textContent = 'Start Monitoring';
          this.showMessage('Performance monitoring stopped', 'info');
        } else {
          await window.localModelManager.startPerformanceMonitoring();
          toggleBtn.textContent = 'Stop Monitoring';
          this.showMessage('Performance monitoring started', 'success');
        }
      });
    }

    if (optimizationSelector) {
      optimizationSelector.addEventListener('change', async (e) => {
        const level = e.target.value;
        try {
          await window.localModelManager.switchOptimizationLevel(level);
          this.showMessage(`Switched to ${level} optimization level`, 'success');
          this.updatePerformanceDisplay();
        } catch (error) {
          this.showMessage(`Failed to switch optimization level: ${error.message}`, 'error');
        }
      });
    }
  }

  async updatePerformanceDisplay() {
    try {
      const performanceReport = await window.localModelManager.getPerformanceReport();

      this.updateElement('#perf-total-translations', performanceReport.summary.totalTranslations);
      this.updateElement('#perf-success-rate', performanceReport.summary.successRate);
      this.updateElement('#perf-avg-time', performanceReport.summary.averageInferenceTime);
      this.updateElement('#perf-throughput', `${performanceReport.summary.throughput.tokensPerSecond} tokens/sec`);

      const trendElement = this.container.querySelector('#trend-indicator');
      if (trendElement) {
        trendElement.textContent = this.capitalizeFirst(performanceReport.performance.trend);
        trendElement.className = `trend-${performanceReport.performance.trend}`;
      }

      this.updateElement('#memory-current', performanceReport.memory.currentUsage);
      this.updateElement('#memory-peak', performanceReport.memory.peakUsage);

      const memoryPressure = parseFloat(performanceReport.memory.pressure);
      const memoryPressureElement = this.container.querySelector('#memory-pressure');
      const memoryBarFill = this.container.querySelector('#memory-bar-fill');

      if (memoryPressureElement && memoryBarFill) {
        memoryBarFill.style.width = performanceReport.memory.pressure;

        if (memoryPressure > 80) {
          memoryPressureElement.textContent = 'High';
          memoryPressureElement.className = 'memory-high';
          memoryBarFill.className = 'memory-bar-fill memory-high';
        } else if (memoryPressure > 60) {
          memoryPressureElement.textContent = 'Medium';
          memoryPressureElement.className = 'memory-medium';
          memoryBarFill.className = 'memory-bar-fill memory-medium';
        } else {
          memoryPressureElement.textContent = 'Normal';
          memoryPressureElement.className = 'memory-normal';
          memoryBarFill.className = 'memory-bar-fill memory-normal';
        }
      }

      this.updateElement('#current-optimization', this.capitalizeFirst(performanceReport.performance.optimizationLevel));
      this.updateElement('#last-optimized',
        performanceReport.performance.lastOptimized
          ? new Date(performanceReport.performance.lastOptimized).toLocaleString()
          : 'Never',
      );

      this.updateRecommendations(performanceReport.recommendations);
      this.updatePerformanceChart();

    } catch (error) {
      console.error('Failed to update performance display:', error);
      this.showMessage('Failed to load performance data', 'error');
    }
  }

  updateRecommendations(recommendations) {
    const recommendationsPanel = this.container.querySelector('#performance-recommendations');
    const recommendationsList = this.container.querySelector('#recommendations-list');

    if (!recommendationsPanel || !recommendationsList) return;

    if (recommendations && recommendations.length > 0) {
      recommendationsPanel.style.display = 'block';
      recommendationsList.innerHTML = recommendations.map(rec => `
        <div class="recommendation recommendation-${rec.severity}">
          <div class="recommendation-header">
            <span class="recommendation-type">${rec.type.toUpperCase()}</span>
            <span class="recommendation-severity ${rec.severity}">${rec.severity.toUpperCase()}</span>
          </div>
          <div class="recommendation-message">${rec.message}</div>
          <div class="recommendation-action">${rec.action}</div>
        </div>
      `).join('');
    } else {
      recommendationsPanel.style.display = 'none';
    }
  }

  updatePerformanceChart() {
    const canvas = this.container.querySelector('#performance-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const inferenceHistory = window.localModelManager.performanceStats
      ? window.localModelManager.performanceStats.inferenceHistory
      : [];

    if (inferenceHistory.length === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const maxValue = Math.max(...inferenceHistory);
    const minValue = Math.min(...inferenceHistory);
    const range = maxValue - minValue || 1;

    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    inferenceHistory.forEach((time, index) => {
      const x = (index / (inferenceHistory.length - 1)) * (canvas.width - 20) + 10;
      const y = ((maxValue - time) / range) * (canvas.height - 20) + 10;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    ctx.fillStyle = '#6B7280';
    ctx.font = '10px Arial';
    ctx.fillText(`${(minValue / 1000).toFixed(1)}s`, 2, canvas.height - 2);
    ctx.fillText(`${(maxValue / 1000).toFixed(1)}s`, 2, 12);
  }

  updateElement(selector, content) {
    const element = this.container.querySelector(selector);
    if (element) {
      element.textContent = content;
    }
  }

  capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  showMessage(text, type) {
    // Simple message display (could be enhanced with toast notifications)
    console.log(`[LocalModelUI] ${type}: ${text}`);
  }

  destroy() {
    this.stopStatusUpdates();
    this.hideProgress();
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocalModelUI;
} else if (typeof window !== 'undefined') {
  window.LocalModelUI = LocalModelUI;
}
