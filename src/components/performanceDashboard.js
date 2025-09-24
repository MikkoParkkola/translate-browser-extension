/**
 * Performance Dashboard Component
 * Real-time telemetry visualization for popup interface
 */

import { logger } from '../lib/logger.js';
import { getDashboardData } from '../lib/performanceTracker.js';
import { escapeHtml, setTextContent, createElement } from '../lib/securityUtils.js';

class PerformanceDashboard {
  constructor(container) {
    this.container = container;
    this.refreshInterval = null;
    this.isVisible = false;
    this.chartData = {
      translation: [],
      domScan: [],
      api: []
    };

    this.createDashboard();
  }

  createDashboard() {
    this.container.innerHTML = `
      <div class="performance-dashboard" style="display: none;">
        <div class="dashboard-header">
          <h3>Performance Telemetry</h3>
          <button class="toggle-btn" data-action="toggle-dashboard">Hide</button>
        </div>

        <div class="metrics-grid">
          <!-- Real-time Metrics -->
          <div class="metric-card">
            <h4>Translation Speed</h4>
            <div class="metric-value" id="translation-speed">-- chars/sec</div>
            <div class="metric-trend" id="translation-trend"></div>
          </div>

          <div class="metric-card">
            <h4>DOM Scan Time</h4>
            <div class="metric-value" id="dom-scan-time">-- ms</div>
            <div class="metric-trend" id="dom-scan-trend"></div>
          </div>

          <div class="metric-card">
            <h4>API Response</h4>
            <div class="metric-value" id="api-response-time">-- ms</div>
            <div class="metric-trend" id="api-response-trend"></div>
          </div>

          <div class="metric-card">
            <h4>Cache Hit Rate</h4>
            <div class="metric-value" id="cache-hit-rate">-- %</div>
            <div class="metric-badge" id="cache-badge"></div>
          </div>

          <div class="metric-card">
            <h4>Error Rate</h4>
            <div class="metric-value" id="error-rate">-- %</div>
            <div class="metric-badge" id="error-badge"></div>
          </div>

          <div class="metric-card">
            <h4>Memory Usage</h4>
            <div class="metric-value" id="memory-usage">-- MB</div>
            <div class="metric-progress" id="memory-progress"></div>
          </div>
        </div>

        <!-- Performance Insights -->
        <div class="insights-section">
          <h4>Performance Insights</h4>
          <div class="insights-list" id="insights-list">
            <div class="insight-placeholder">No insights available yet</div>
          </div>
        </div>

        <!-- Detailed Statistics -->
        <div class="statistics-section" style="display: none;">
          <h4>Detailed Statistics</h4>
          <div class="stats-table">
            <div class="stat-row">
              <span class="stat-label">Translation Avg:</span>
              <span class="stat-value" id="translation-avg">--</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Translation P95:</span>
              <span class="stat-value" id="translation-p95">--</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">DOM Scan Avg:</span>
              <span class="stat-value" id="dom-scan-avg">--</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">DOM Scan P95:</span>
              <span class="stat-value" id="dom-scan-p95">--</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">API Call Avg:</span>
              <span class="stat-value" id="api-call-avg">--</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">API Call P95:</span>
              <span class="stat-value" id="api-call-p95">--</span>
            </div>
          </div>
          <button class="btn-secondary" data-action="toggle-stats">Show Less</button>
        </div>

        <div class="dashboard-actions">
          <button class="btn-secondary" data-action="toggle-stats">Show Detailed Stats</button>
          <button class="btn-secondary" data-action="clear-metrics">Clear Metrics</button>
          <button class="btn-secondary" data-action="export-metrics">Export Data</button>
        </div>
      </div>
    `;

    this.addEventListeners();
    this.addStyles();
  }

  addEventListeners() {
    // Dashboard toggle
    const toggleBtn = this.container.querySelector('[data-action="toggle-dashboard"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.hide());
    }

    // Statistics toggle
    const statsToggle = this.container.querySelector('[data-action="toggle-stats"]');
    if (statsToggle) {
      statsToggle.addEventListener('click', () => this.toggleStats());
    }

    // Clear metrics
    const clearBtn = this.container.querySelector('[data-action="clear-metrics"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearMetrics());
    }

    // Export metrics
    const exportBtn = this.container.querySelector('[data-action="export-metrics"]');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportMetrics());
    }
  }

  show() {
    this.isVisible = true;
    this.container.querySelector('.performance-dashboard').style.display = 'block';
    this.startRefresh();
    logger.debug('PerformanceDashboard', 'Dashboard shown');
  }

  hide() {
    this.isVisible = false;
    this.container.querySelector('.performance-dashboard').style.display = 'none';
    this.stopRefresh();
    logger.debug('PerformanceDashboard', 'Dashboard hidden');
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  startRefresh() {
    if (this.refreshInterval) return;

    this.refreshInterval = setInterval(() => {
      this.updateDashboard();
    }, 2000); // Update every 2 seconds

    // Initial update
    this.updateDashboard();
  }

  stopRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async updateDashboard() {
    try {
      const dashboardData = getDashboardData();
      this.renderMetrics(dashboardData);
      this.renderInsights(dashboardData.insights);
      this.renderStatistics(dashboardData.statistics);
    } catch (error) {
      logger.error('PerformanceDashboard', 'Failed to update dashboard:', error);
    }
  }

  renderMetrics(data) {
    const { realtime } = data;

    // Translation speed
    const latestTranslation = realtime.translationSpeed.slice(-1)[0];
    if (latestTranslation) {
      const speed = Math.round(latestTranslation.speed);
      this.setElementText('translation-speed', `${speed} chars/sec`);
      this.setTrend('translation-trend', this.calculateTrend(realtime.translationSpeed, 'speed'));
    }

    // DOM scan time
    const latestDomScan = realtime.domScanTime.slice(-1)[0];
    if (latestDomScan) {
      const time = latestDomScan.duration.toFixed(1);
      this.setElementText('dom-scan-time', `${time}ms`);
      this.setTrend('dom-scan-trend', this.calculateTrend(realtime.domScanTime, 'duration', true));
    }

    // API response time
    const latestApiCall = realtime.apiResponseTime.slice(-1)[0];
    if (latestApiCall) {
      const time = latestApiCall.duration.toFixed(0);
      this.setElementText('api-response-time', `${time}ms`);
      this.setTrend('api-response-trend', this.calculateTrend(realtime.apiResponseTime, 'duration', true));
    }

    // Cache hit rate
    const cacheRate = (realtime.cacheHitRate * 100).toFixed(1);
    this.setElementText('cache-hit-rate', `${cacheRate}%`);
    this.setBadge('cache-badge', realtime.cacheHitRate > 0.7 ? 'good' : realtime.cacheHitRate > 0.3 ? 'ok' : 'low');

    // Error rate
    const errorRate = (realtime.errorRate * 100).toFixed(1);
    this.setElementText('error-rate', `${errorRate}%`);
    this.setBadge('error-badge', realtime.errorRate < 0.01 ? 'good' : realtime.errorRate < 0.05 ? 'ok' : 'high');

    // Memory usage
    if (realtime.memoryUsage > 0) {
      const memoryMB = (realtime.memoryUsage / (1024 * 1024)).toFixed(1);
      this.setElementText('memory-usage', `${memoryMB}MB`);
      this.setProgress('memory-progress', Math.min(realtime.memoryUsage / (50 * 1024 * 1024), 1) * 100);
    }
  }

  renderInsights(insights) {
    const insightsList = this.container.querySelector('#insights-list');
    if (!insightsList) return;

    // Clear previous content
    insightsList.innerHTML = '';

    if (!insights || insights.length === 0) {
      const placeholder = createElement('div', {
        className: 'insight-placeholder',
        text: 'No insights available yet'
      });
      insightsList.appendChild(placeholder);
      return;
    }

    // Create insight elements securely
    insights.forEach(insight => {
      const insightItem = createElement('div', {
        className: `insight-item ${escapeHtml(insight.type || '')}`
      });

      const insightIcon = createElement('div', {
        className: 'insight-icon',
        text: this.getInsightIcon(insight.type)
      });

      const insightContent = createElement('div', {
        className: 'insight-content'
      });

      const insightCategory = createElement('div', {
        className: 'insight-category',
        text: insight.category || ''
      });

      const insightMessage = createElement('div', {
        className: 'insight-message',
        text: insight.message || ''
      });

      insightContent.appendChild(insightCategory);
      insightContent.appendChild(insightMessage);
      insightItem.appendChild(insightIcon);
      insightItem.appendChild(insightContent);
      insightsList.appendChild(insightItem);
    });
  }

  renderStatistics(statistics) {
    if (!statistics) return;

    // Translation statistics
    if (statistics.translation) {
      this.setElementText('translation-avg', `${statistics.translation.avg?.toFixed(0)}ms`);
      this.setElementText('translation-p95', `${statistics.translation.p95?.toFixed(0)}ms`);
    }

    // DOM scan statistics
    if (statistics.domScan) {
      this.setElementText('dom-scan-avg', `${statistics.domScan.avg?.toFixed(1)}ms`);
      this.setElementText('dom-scan-p95', `${statistics.domScan.p95?.toFixed(1)}ms`);
    }

    // API call statistics
    if (statistics.apiCall) {
      this.setElementText('api-call-avg', `${statistics.apiCall.avg?.toFixed(0)}ms`);
      this.setElementText('api-call-p95', `${statistics.apiCall.p95?.toFixed(0)}ms`);
    }
  }

  calculateTrend(data, property, inverted = false) {
    if (data.length < 2) return 'neutral';

    const recent = data.slice(-5);
    const first = recent[0][property];
    const last = recent[recent.length - 1][property];

    const change = (last - first) / first;
    const threshold = 0.1; // 10% change threshold

    if (Math.abs(change) < threshold) return 'neutral';

    const improving = inverted ? change < 0 : change > 0;
    return improving ? 'up' : 'down';
  }

  getInsightIcon(type) {
    const icons = {
      success: '✅',
      warning: '⚠️',
      error: '❌',
      info: 'ℹ️'
    };
    return icons[type] || 'ℹ️';
  }

  setElementText(id, text) {
    const element = this.container.querySelector(`#${id}`);
    if (element) {
      element.textContent = text;
    }
  }

  setTrend(id, trend) {
    const element = this.container.querySelector(`#${id}`);
    if (element) {
      element.className = `metric-trend ${trend}`;
      const arrows = { up: '↗', down: '↘', neutral: '→' };
      element.textContent = arrows[trend] || '→';
    }
  }

  setBadge(id, status) {
    const element = this.container.querySelector(`#${id}`);
    if (element) {
      element.className = `metric-badge ${status}`;
      const labels = { good: 'Good', ok: 'OK', low: 'Low', high: 'High' };
      element.textContent = labels[status] || '';
    }
  }

  setProgress(id, percentage) {
    const element = this.container.querySelector(`#${id}`);
    if (element) {
      element.style.width = `${percentage}%`;
    }
  }

  toggleStats() {
    const statsSection = this.container.querySelector('.statistics-section');
    const toggleBtn = this.container.querySelector('[data-action="toggle-stats"]');

    if (statsSection && toggleBtn) {
      const isVisible = statsSection.style.display !== 'none';
      statsSection.style.display = isVisible ? 'none' : 'block';
      toggleBtn.textContent = isVisible ? 'Show Detailed Stats' : 'Show Less';
    }
  }

  async clearMetrics() {
    if (confirm('Clear all performance metrics? This cannot be undone.')) {
      try {
        // Clear metrics via performance tracker
        const tracker = window.PerformanceTracker?.getTracker();
        if (tracker) {
          tracker.clearMetrics();
          logger.info('PerformanceDashboard', 'Metrics cleared');
          this.updateDashboard(); // Refresh display
        }
      } catch (error) {
        logger.error('PerformanceDashboard', 'Failed to clear metrics:', error);
      }
    }
  }

  async exportMetrics() {
    try {
      const dashboardData = getDashboardData();
      const exportData = {
        timestamp: new Date().toISOString(),
        realtime: dashboardData.realtime,
        statistics: dashboardData.statistics,
        insights: dashboardData.insights
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });

      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(dataBlob);
      downloadLink.download = `translation-metrics-${new Date().toISOString().slice(0, 10)}.json`;
      downloadLink.click();

      logger.info('PerformanceDashboard', 'Metrics exported');
    } catch (error) {
      logger.error('PerformanceDashboard', 'Failed to export metrics:', error);
    }
  }

  addStyles() {
    const styleId = 'performance-dashboard-styles';
    if (document.getElementById(styleId)) return;

    const styles = document.createElement('style');
    styles.id = styleId;
    styles.textContent = `
      .performance-dashboard {
        background: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 16px;
        margin-top: 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .dashboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        border-bottom: 1px solid #e9ecef;
        padding-bottom: 8px;
      }

      .dashboard-header h3 {
        margin: 0;
        font-size: 16px;
        color: #495057;
      }

      .toggle-btn {
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }

      .metric-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 6px;
        padding: 12px;
        text-align: center;
      }

      .metric-card h4 {
        margin: 0 0 8px 0;
        font-size: 12px;
        color: #6c757d;
        font-weight: 500;
      }

      .metric-value {
        font-size: 16px;
        font-weight: bold;
        color: #343a40;
        margin-bottom: 4px;
      }

      .metric-trend {
        font-size: 14px;
      }

      .metric-trend.up { color: #28a745; }
      .metric-trend.down { color: #dc3545; }
      .metric-trend.neutral { color: #6c757d; }

      .metric-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        font-weight: bold;
        text-transform: uppercase;
      }

      .metric-badge.good { background: #d4edda; color: #155724; }
      .metric-badge.ok { background: #fff3cd; color: #856404; }
      .metric-badge.low, .metric-badge.high { background: #f8d7da; color: #721c24; }

      .metric-progress {
        height: 4px;
        background: #e9ecef;
        border-radius: 2px;
        margin-top: 4px;
        position: relative;
        overflow: hidden;
      }

      .metric-progress::after {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        background: #007bff;
        transition: width 0.3s ease;
      }

      .insights-section {
        margin-bottom: 16px;
      }

      .insights-section h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: #495057;
      }

      .insight-placeholder {
        color: #6c757d;
        font-style: italic;
        font-size: 12px;
        text-align: center;
        padding: 8px;
      }

      .insight-item {
        display: flex;
        align-items: flex-start;
        padding: 8px;
        margin-bottom: 6px;
        border-radius: 4px;
        font-size: 12px;
      }

      .insight-item.success { background: #d4edda; }
      .insight-item.warning { background: #fff3cd; }
      .insight-item.error { background: #f8d7da; }
      .insight-item.info { background: #d1ecf1; }

      .insight-icon {
        margin-right: 8px;
        font-size: 14px;
      }

      .insight-category {
        font-weight: bold;
        margin-bottom: 2px;
        text-transform: capitalize;
      }

      .insight-message {
        color: #495057;
      }

      .statistics-section {
        margin-bottom: 16px;
      }

      .statistics-section h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: #495057;
      }

      .stats-table {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 4px;
      }

      .stat-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid #e9ecef;
        font-size: 12px;
      }

      .stat-row:last-child {
        border-bottom: none;
      }

      .stat-label {
        color: #6c757d;
      }

      .stat-value {
        font-weight: bold;
        color: #343a40;
      }

      .dashboard-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .btn-secondary {
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 6px 12px;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-secondary:hover {
        background: #5a6268;
      }
    `;

    document.head.appendChild(styles);
  }

  destroy() {
    this.stopRefresh();
    this.container.innerHTML = '';
  }
}

export { PerformanceDashboard };