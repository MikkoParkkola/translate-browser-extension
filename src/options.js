// src/options.js - Modern Beautiful Options Page

// Initialize logger
const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
  ? window.qwenLogger.create('options')
  : console;

// Options page management object
const OptionsPage = {
  // UI Elements
  themeToggle: null,
  tabButtons: null,
  tabPanes: null,
  addProviderButton: null,
  addProviderOverlay: null,
  providerEditorOverlay: null,
  providerGrid: null,
  
  // State
  currentTheme: 'light',
  activeTab: 'providers',
  providers: [],
  selectedPreset: null,
  editingProvider: null,

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async initialize() {
    this.initializeElements();
    await this.loadTheme();
    await this.loadProviders();
    await this.loadPreferences();
    this.setupEventListeners();
    this.renderProviders();
    this.renderAnalytics();
    this.setupTabNavigation();
  },

  initializeElements() {
    this.themeToggle = document.getElementById('theme-toggle');
    this.tabButtons = document.querySelectorAll('.tab-button');
    this.tabPanes = document.querySelectorAll('.tab-pane');
    this.addProviderButton = document.getElementById('addProvider');
    this.addProviderOverlay = document.getElementById('addProviderOverlay');
    this.providerEditorOverlay = document.getElementById('providerEditorOverlay');
    this.providerGrid = document.getElementById('provider-grid');
  },

  // --------------------------------------------------------------------------
  // Theme Management
  // --------------------------------------------------------------------------
  async loadTheme() {
    const { theme } = await chrome.storage.local.get({ theme: 'light' });
    this.currentTheme = theme;
    this.applyTheme(theme);
    this.updateThemeIcon();
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    this.currentTheme = theme;
  },

  toggleTheme() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(newTheme);
    this.updateThemeIcon();
    chrome.storage.local.set({ theme: newTheme });
  },

  updateThemeIcon() {
    const lightIcon = document.querySelector('.theme-icon-light');
    const darkIcon = document.querySelector('.theme-icon-dark');
    
    if (this.currentTheme === 'light') {
      lightIcon.style.display = 'block';
      darkIcon.style.display = 'none';
    } else {
      lightIcon.style.display = 'none';
      darkIcon.style.display = 'block';
    }
  },

  // --------------------------------------------------------------------------
  // Tab Navigation
  // --------------------------------------------------------------------------
  setupTabNavigation() {
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tabId = button.dataset.tab;
        this.switchTab(tabId);
      });
    });
  },

  switchTab(tabId) {
    // Update active tab button
    this.tabButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tabId);
    });

    // Update active tab pane
    this.tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `${tabId}-tab`);
    });

    this.activeTab = tabId;

    // Load tab-specific content
    if (tabId === 'analytics') {
      this.renderAnalytics();
    }
  },

  // --------------------------------------------------------------------------
  // Provider Management
  // --------------------------------------------------------------------------
  async loadProviders() {
    try {
      const { providers } = await chrome.storage.local.get({ providers: [] });
      this.providers = providers.length > 0 ? providers : this.getDefaultProviders();

      // Validate and fix provider statuses based on API key presence
      let needsUpdate = false;
      this.providers.forEach(provider => {
        const shouldBeActive = provider.apiKey && provider.apiKey.trim().length > 0;
        const newStatus = shouldBeActive ? 'active' : 'inactive';

        if (provider.status !== newStatus) {
          provider.status = newStatus;
          needsUpdate = true;
        }
      });

      // Save corrected statuses if any were updated
      if (needsUpdate) {
        await this.saveProviders();
      }
    } catch (error) {
      logger.error('Failed to load providers:', error);
      this.providers = this.getDefaultProviders();
    }
  },

  getDefaultProviders() {
    return [
      {
        id: 'qwen-mt-turbo',
        name: 'Alibaba Qwen MT Turbo',
        type: 'dashscope',
        icon: '🤖',
        status: 'active',
        apiKey: '',
        apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message',
        model: 'qwen-turbo',
        usage: { requests: 0, tokens: 0, limit: 1000 }
      },
      {
        id: 'hunyuan-local',
        name: 'Hunyuan Local Model',
        type: 'local',
        icon: '🏠',
        status: 'inactive',
        apiKey: 'local-model', // Special value to indicate local model
        apiEndpoint: 'local://hunyuan-mt',
        model: 'Hunyuan-MT-7B.i1-Q4_K_M.gguf',
        usage: { requests: 0, tokens: 0, limit: Infinity }, // No limit for local model
        description: 'Runs locally on your device (4.37GB download)',
        downloadSize: '4.37GB'
      },
      {
        id: 'openai',
        name: 'OpenAI GPT',
        type: 'openai',
        icon: '🧠',
        status: 'inactive',
        apiKey: '',
        apiEndpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-3.5-turbo',
        usage: { requests: 0, tokens: 0, limit: 1000 }
      }
    ];
  },

  async saveProviders() {
    await chrome.storage.local.set({ providers: this.providers });
  },

  renderProviders() {
    this.providerGrid.innerHTML = '';
    
    this.providers.forEach((provider, index) => {
      const card = this.createProviderCard(provider, index);
      this.providerGrid.appendChild(card);
    });
  },

  createProviderCard(provider, index) {
    const card = document.createElement('div');
    card.className = `provider-card ${provider.status === 'active' ? 'active' : ''}`;
    
    const usagePercent = Math.min((provider.usage.requests / provider.usage.limit) * 100, 100);
    
    card.innerHTML = `
      <div class="provider-header">
        <div class="provider-info">
          <div class="provider-icon">${provider.icon}</div>
          <div class="provider-details">
            <h3>${provider.name}</h3>
            <p class="provider-status ${provider.status}">${provider.status === 'active' ? 'Active' : 'Inactive'}</p>
          </div>
        </div>
        <div class="provider-actions">
          <button class="provider-action-btn js-edit" aria-label="Edit provider">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2"/>
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
          <button class="provider-action-btn js-delete" aria-label="Delete provider">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
        </div>
      </div>
      
      <div class="provider-usage">
        <div class="usage-metric">
          <span class="usage-label">Requests Used</span>
          <span class="usage-value">${provider.usage.requests}/${provider.usage.limit}</span>
        </div>
        <div class="usage-bar">
          <div class="usage-fill" style="width: ${usagePercent}%"></div>
        </div>
      </div>
    `;

    const editBtn = card.querySelector('.js-edit');
    const delBtn = card.querySelector('.js-delete');
    editBtn.addEventListener('click', () => OptionsPage.editProvider(index));
    delBtn.addEventListener('click', () => OptionsPage.deleteProvider(index));
    
    return card;
  },

  // --------------------------------------------------------------------------
  // Provider Modal Management
  // --------------------------------------------------------------------------
  showAddProviderModal() {
    this.selectedPreset = null;
    this.addProviderOverlay.classList.add('active');
    document.getElementById('ap_step1').style.display = 'block';
    document.getElementById('ap_step2').style.display = 'none';
    document.getElementById('ap_next').disabled = true;
    
    // Reset preset selection
    document.querySelectorAll('.preset-card').forEach(card => {
      card.classList.remove('selected');
    });
  },

  hideAddProviderModal() {
    this.addProviderOverlay.classList.remove('active');
  },

  selectPreset(presetType) {
    this.selectedPreset = presetType;
    
    // Update visual selection
    document.querySelectorAll('.preset-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.preset === presetType);
    });
    
    // Enable next button
    document.getElementById('ap_next').disabled = false;
  },

  showProviderForm() {
    document.getElementById('ap_step1').style.display = 'none';
    document.getElementById('ap_step2').style.display = 'block';
    this.renderProviderForm(this.selectedPreset);
  },

  renderProviderForm(presetType) {
    const fieldsContainer = document.getElementById('ap_fields');
    let formHTML = '';

    switch (presetType) {
      case 'openai':
        formHTML = `
          <div class="form-group">
            <label for="provider-name">Provider Name</label>
            <input type="text" id="provider-name" class="form-input" value="OpenAI GPT" placeholder="Enter provider name">
          </div>
          <div class="form-group">
            <label for="provider-api-key">API Key</label>
            <input type="password" id="provider-api-key" class="form-input" placeholder="Enter your OpenAI API key">
          </div>
          <div class="form-group">
            <label for="provider-model">Model</label>
            <select id="provider-model" class="form-select">
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5-turbo" selected>GPT-3.5 Turbo</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
            </select>
          </div>
        `;
        break;
      
      case 'deepl':
        formHTML = `
          <div class="form-group">
            <label for="provider-name">Provider Name</label>
            <input type="text" id="provider-name" class="form-input" value="DeepL" placeholder="Enter provider name">
          </div>
          <div class="form-group">
            <label for="provider-api-key">API Key</label>
            <input type="password" id="provider-api-key" class="form-input" placeholder="Enter your DeepL API key">
          </div>
          <div class="form-group">
            <label for="provider-endpoint">API Endpoint</label>
            <select id="provider-endpoint" class="form-select">
              <option value="https://api-free.deepl.com">Free API</option>
              <option value="https://api.deepl.com">Pro API</option>
            </select>
          </div>
        `;
        break;
      
      case 'google':
        formHTML = `
          <div class="form-group">
            <label for="provider-name">Provider Name</label>
            <input type="text" id="provider-name" class="form-input" value="Google Translate" placeholder="Enter provider name">
          </div>
          <div class="form-group">
            <label for="provider-api-key">API Key</label>
            <input type="password" id="provider-api-key" class="form-input" placeholder="Enter your Google Cloud API key">
          </div>
        `;
        break;

      case 'qwen':
        formHTML = `
          <div class="form-group">
            <label for="provider-name">Provider Name</label>
            <input type="text" id="provider-name" class="form-input" value="Alibaba Qwen MT Turbo" placeholder="Enter provider name">
          </div>
          <div class="form-group">
            <label for="provider-api-key">API Key</label>
            <input type="password" id="provider-api-key" class="form-input" placeholder="Enter your DashScope API key">
          </div>
          <div class="form-group">
            <label for="provider-model">Model</label>
            <select id="provider-model" class="form-select">
              <option value="qwen-turbo" selected>Qwen Turbo</option>
              <option value="qwen-plus">Qwen Plus</option>
            </select>
          </div>
          <div class="form-group">
            <label for="provider-endpoint">API Endpoint</label>
            <input type="text" id="provider-endpoint" class="form-input" value="https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message" readonly>
          </div>
        `;
        break;

      default:
        formHTML = `
          <div class="form-group">
            <label for="provider-name">Provider Name</label>
            <input type="text" id="provider-name" class="form-input" placeholder="Enter provider name">
          </div>
          <div class="form-group">
            <label for="provider-api-key">API Key</label>
            <input type="password" id="provider-api-key" class="form-input" placeholder="Enter API key">
          </div>
          <div class="form-group">
            <label for="provider-endpoint">API Endpoint</label>
            <input type="url" id="provider-endpoint" class="form-input" placeholder="https://api.example.com">
          </div>
          <div class="form-group">
            <label for="provider-model">Model</label>
            <input type="text" id="provider-model" class="form-input" placeholder="Model name">
          </div>
        `;
    }
    
    fieldsContainer.innerHTML = formHTML;
  },

  createProvider() {
    const name = document.getElementById('provider-name').value;
    const apiKey = document.getElementById('provider-api-key').value;
    const model = document.getElementById('provider-model')?.value || '';
    const endpoint = document.getElementById('provider-endpoint')?.value || '';

    if (!name || !apiKey) {
      alert('Please fill in all required fields.');
      return;
    }

    const newProvider = {
      id: Date.now().toString(),
      name: name,
      type: this.selectedPreset,
      icon: this.getPresetIcon(this.selectedPreset),
      status: apiKey && apiKey.trim().length > 0 ? 'active' : 'inactive',
      apiKey: apiKey,
      apiEndpoint: endpoint,
      model: model,
      usage: { requests: 0, tokens: 0, limit: 1000 }
    };

    this.providers.push(newProvider);
    this.saveProviders();
    this.renderProviders();
    this.hideAddProviderModal();
  },

  getPresetIcon(presetType) {
    const icons = {
      'openai': '🧠',
      'qwen': '🚀',
      'deepl': '🔷',
      'google': '🔍',
      'custom': '⚙️'
    };
    return icons[presetType] || '🔧';
  },

  editProvider(index) {
    this.editingProvider = index;
    const provider = this.providers[index];
    
    // Populate form fields
    document.getElementById('pe_apiKey').value = provider.apiKey || '';
    document.getElementById('pe_apiEndpoint').value = provider.apiEndpoint || '';
    document.getElementById('pe_model').value = provider.model || '';
    
    this.providerEditorOverlay.classList.add('active');
  },

  saveProvider() {
    if (this.editingProvider === null) return;

    const provider = this.providers[this.editingProvider];
    provider.apiKey = document.getElementById('pe_apiKey').value;
    provider.apiEndpoint = document.getElementById('pe_apiEndpoint').value;
    provider.model = document.getElementById('pe_model').value;

    // Update provider status based on API key presence
    provider.status = provider.apiKey && provider.apiKey.trim().length > 0 ? 'active' : 'inactive';

    this.saveProviders();
    this.renderProviders();
    this.hideProviderEditor();
  },

  deleteProvider(index) {
    if (confirm('Are you sure you want to delete this provider?')) {
      this.providers.splice(index, 1);
      this.saveProviders();
      this.renderProviders();
    }
  },

  hideProviderEditor() {
    this.providerEditorOverlay.classList.remove('active');
    this.editingProvider = null;
  },

  // --------------------------------------------------------------------------
  // Preferences Management
  // --------------------------------------------------------------------------
  async loadPreferences() {
    const { 
      globalAutoTranslate,
      showOriginal,
      enableShortcuts,
      pdfEngine 
    } = await chrome.storage.local.get({
      globalAutoTranslate: false,
      showOriginal: true,
      enableShortcuts: true,
      pdfEngine: 'none'
    });

    document.getElementById('global-auto-translate').checked = globalAutoTranslate;
    document.getElementById('show-original').checked = showOriginal;
    document.getElementById('enable-shortcuts').checked = enableShortcuts;
    
    // Load PDF engine selection
    this.loadPdfEngineConfig(pdfEngine);
  },

  // PDF Engine Configuration
  loadPdfEngineConfig(selectedEngine = 'none') {
    // Set the selected engine
    const engineRadio = document.getElementById(`pdf-engine-${selectedEngine}`);
    if (engineRadio) {
      engineRadio.checked = true;
    }
    
    // Update stats display
    this.updatePdfEngineStats(selectedEngine);
  },

  updatePdfEngineStats(selectedEngine) {
    const engineSizes = {
      none: { size: '0MB', totalSaved: '16.1MB' },
      pdfjs: { size: '1.3MB', totalSaved: '14.8MB' },
      pdfium: { size: '5.5MB', totalSaved: '10.6MB' },
      mupdf: { size: '9.3MB', totalSaved: '6.8MB' }
    };
    
    const engineNames = {
      none: 'Disabled',
      pdfjs: 'PDF.js',
      pdfium: 'PDFium', 
      mupdf: 'MuPDF'
    };
    
    const stats = engineSizes[selectedEngine] || engineSizes.none;
    const engineName = engineNames[selectedEngine] || 'Unknown';
    
    const currentEngineEl = document.getElementById('current-pdf-engine');
    const sizeSavedEl = document.getElementById('pdf-size-saved');
    
    if (currentEngineEl) {
      currentEngineEl.textContent = `${engineName} (${stats.size})`;
    }
    
    if (sizeSavedEl) {
      sizeSavedEl.textContent = stats.totalSaved;
    }
  },

  async savePdfEngineSelection(engineName) {
    try {
      await chrome.storage.local.set({ pdfEngine: engineName });
      this.updatePdfEngineStats(engineName);
      
      // Show success feedback
      this.showEngineChangeNotification(engineName);
    } catch (error) {
      logger.error('Failed to save PDF engine configuration:', error);
    }
  },

  showEngineChangeNotification(engineName) {
    const engineNames = {
      none: 'PDF translation disabled',
      pdfjs: 'PDF.js engine selected',
      pdfium: 'PDFium engine selected',
      mupdf: 'MuPDF engine selected'
    };
    
    const message = engineNames[engineName] || 'Engine updated';
    
    // Create temporary notification
    const notification = document.createElement('div');
    notification.className = 'engine-notification';
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: var(--color-success-100);
      color: var(--color-success-700);
      border: 1px solid var(--color-success-300);
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: var(--shadow-lg);
      z-index: 1000;
      font-weight: 500;
      animation: slideInRight 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  },

  savePreference(key, value) {
    chrome.storage.local.set({ [key]: value });
  },

  // --------------------------------------------------------------------------
  // Analytics Rendering
  // --------------------------------------------------------------------------
  renderAnalytics() {
    // This would normally fetch real data from the background script
    this.renderUsageChart();
  },

  renderUsageChart() {
    const chartContainer = document.getElementById('usage-chart');
    if (!chartContainer) return;

    // Simple demo chart representation
    chartContainer.innerHTML = `
      <div style="display: flex; align-items: end; height: 100%; gap: 8px; justify-content: center;">
        <div style="width: 30px; height: 60%; background: var(--primary); border-radius: 4px 4px 0 0;"></div>
        <div style="width: 30px; height: 80%; background: var(--primary); border-radius: 4px 4px 0 0;"></div>
        <div style="width: 30px; height: 45%; background: var(--primary); border-radius: 4px 4px 0 0;"></div>
        <div style="width: 30px; height: 90%; background: var(--primary); border-radius: 4px 4px 0 0;"></div>
        <div style="width: 30px; height: 70%; background: var(--primary); border-radius: 4px 4px 0 0;"></div>
        <div style="width: 30px; height: 55%; background: var(--primary); border-radius: 4px 4px 0 0;"></div>
        <div style="width: 30px; height: 85%; background: var(--primary); border-radius: 4px 4px 0 0;"></div>
      </div>
    `;
  },

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  setupEventListeners() {
    // Theme toggle
    this.themeToggle?.addEventListener('click', () => this.toggleTheme());

    // Add provider modal
    this.addProviderButton?.addEventListener('click', () => this.showAddProviderModal());
    
    // Modal close buttons
    document.getElementById('ap_close')?.addEventListener('click', () => this.hideAddProviderModal());
    document.getElementById('pe_close')?.addEventListener('click', () => this.hideProviderEditor());
    document.getElementById('ap_cancel1')?.addEventListener('click', () => this.hideAddProviderModal());
    
    // Modal actions
    document.getElementById('ap_next')?.addEventListener('click', () => this.showProviderForm());
    document.getElementById('ap_back')?.addEventListener('click', () => {
      document.getElementById('ap_step1').style.display = 'block';
      document.getElementById('ap_step2').style.display = 'none';
    });
    document.getElementById('ap_create')?.addEventListener('click', () => this.createProvider());
    
    // Provider editor actions
    document.getElementById('pe_save')?.addEventListener('click', () => this.saveProvider());
    document.getElementById('pe_cancel')?.addEventListener('click', () => this.hideProviderEditor());
    document.getElementById('pe_delete')?.addEventListener('click', () => {
      if (this.editingProvider !== null) {
        this.deleteProvider(this.editingProvider);
        this.hideProviderEditor();
      }
    });

    // Preset selection
    document.querySelectorAll('.preset-card').forEach(card => {
      card.addEventListener('click', () => this.selectPreset(card.dataset.preset));
    });

    // Preference toggles
    document.getElementById('global-auto-translate')?.addEventListener('change', (e) => {
      this.savePreference('globalAutoTranslate', e.target.checked);
    });
    document.getElementById('show-original')?.addEventListener('change', (e) => {
      this.savePreference('showOriginal', e.target.checked);
    });
    document.getElementById('enable-shortcuts')?.addEventListener('change', (e) => {
      this.savePreference('enableShortcuts', e.target.checked);
    });

    // PDF engine selection
    document.querySelectorAll('input[name="pdf-engine"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.savePdfEngineSelection(e.target.value);
        }
      });
    });

    // Advanced settings
    document.getElementById('batch-size')?.addEventListener('input', (e) => {
      document.querySelector('[for="batch-size"] + .range-value').textContent = e.target.value;
      this.savePreference('batchSize', parseInt(e.target.value));
    });
    document.getElementById('request-delay')?.addEventListener('input', (e) => {
      document.querySelector('[for="request-delay"] + .range-value').textContent = e.target.value + 'ms';
      this.savePreference('requestDelay', parseInt(e.target.value));
    });

    // Close modals on overlay click
    this.addProviderOverlay?.addEventListener('click', (e) => {
      if (e.target === this.addProviderOverlay) {
        this.hideAddProviderModal();
      }
    });
    this.providerEditorOverlay?.addEventListener('click', (e) => {
      if (e.target === this.providerEditorOverlay) {
        this.hideProviderEditor();
      }
    });

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.addProviderOverlay?.classList.contains('active')) {
          this.hideAddProviderModal();
        }
        if (this.providerEditorOverlay?.classList.contains('active')) {
          this.hideProviderEditor();
        }
      }
    });
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  OptionsPage.initialize();
});

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = OptionsPage;
}
