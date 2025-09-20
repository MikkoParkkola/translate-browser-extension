# Migration Guide: Monolithic to Modular Architecture

## Overview

This guide helps developers migrate from the monolithic architecture (v1.x) to the new modular architecture (v2.x) of the Qwen Translator Extension. The modular refactor introduces significant architectural changes while maintaining backward compatibility where possible.

## Table of Contents

1. [Migration Overview](#migration-overview)
2. [Breaking Changes](#breaking-changes)
3. [Step-by-Step Migration](#step-by-step-migration)
4. [Code Migration Examples](#code-migration-examples)
5. [Configuration Migration](#configuration-migration)
6. [Testing Your Migration](#testing-your-migration)
7. [Rollback Procedures](#rollback-procedures)
8. [Common Migration Issues](#common-migration-issues)

---

## Migration Overview

### What Changed

**From Monolithic (v1.x):**
```
src/
├── popup.js           # 2000+ lines, mixed concerns
├── background.js      # 1500+ lines, all functionality
├── translator.js      # 800+ lines, tightly coupled
├── config.js          # Basic configuration
└── contentScript.js   # DOM + translation logic
```

**To Modular (v2.x):**
```
src/
├── core/              # Modular core system
│   ├── types.ts       # Type definitions
│   ├── config-manager.ts
│   ├── cache-manager.js
│   ├── throttle-manager.js
│   ├── logger.js
│   └── error-manager.js
├── lib/               # Shared libraries
├── providers/         # Pluggable providers
├── popup/             # UI modules
└── [legacy files]     # Backward compatibility
```

### Migration Benefits

- **Maintainability**: Clear separation of concerns
- **Testability**: Individual module testing
- **Extensibility**: Plugin-based provider system
- **Performance**: Lazy loading and bundle optimization
- **Type Safety**: Shared `.d.ts` definitions for editor tooling
- **Developer Experience**: Better debugging and tooling

### Migration Timeline

- **Preparation**: 1-2 days (reading docs, planning)
- **Code Migration**: 3-5 days (depending on customizations)
- **Testing & Validation**: 2-3 days
- **Deployment**: 1 day
- **Total**: ~1-2 weeks for full migration

---

## Breaking Changes

### 1. Module System Changes

**Old (v1.x):**
```javascript
// Direct global access
if (typeof self.qwenTranslator !== 'undefined') {
  const translator = self.qwenTranslator;
  translator.translate('Hello', 'en', 'es');
}
```

**New (v2.x):**
```javascript
// Module-based access
import { TranslationCoordinator } from './core/translation-coordinator.js';
const coordinator = new TranslationCoordinator();
await coordinator.translate({ 
  text: 'Hello', 
  sourceLanguage: 'en', 
  targetLanguage: 'es' 
});
```

### 2. Configuration Structure

**Old Configuration:**
```javascript
const config = {
  apiKey: 'sk-123',
  model: 'qwen-turbo',
  timeout: 5000,
  sourceLanguage: 'auto',
  targetLanguage: 'en'
};
```

**New Configuration:**
```javascript
const config = {
  providers: {
    qwen: {
      id: 'qwen',
      apiKey: 'sk-123',
      model: 'qwen-turbo',
      enabled: true,
      weight: 0.8
    }
  },
  activeProvider: 'qwen',
  fallbackProviders: ['openai', 'deepl'],
  throttle: { requestLimit: 60, tokenLimit: 100000 },
  cache: { enabled: true, maxEntries: 1000 }
};
```

### 3. Provider Interface

**Old Provider System:**
```javascript
// Single provider, hard-coded
async function translateViaAPI(text, source, target) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    body: JSON.stringify({ text, source, target })
  });
  return response.json();
}
```

**New Provider System:**
```javascript
// Multi-provider, pluggable
class QwenProvider implements ITranslationProvider {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    // Provider-specific implementation
  }
}

// Usage
const provider = providerRegistry.get('qwen');
const result = await provider.translate(request);
```

### 4. Message Protocol

**Old Messaging:**
```javascript
// Simple action-based messages
chrome.runtime.sendMessage({ 
  action: 'translate', 
  text: 'Hello' 
}, response => {
  console.log(response);
});
```

**New Messaging:**
```javascript
// Structured message protocol
const response = await chrome.runtime.sendMessage({
  type: 'translate',
  data: {
    text: 'Hello',
    sourceLanguage: 'en',
    targetLanguage: 'es'
  },
  sender: 'popup',
  timestamp: Date.now(),
  version: 1
});

if (response.success) {
  console.log(response.data);
} else {
  console.error(response.error);
}
```

### 5. Error Handling

**Old Error Handling:**
```javascript
try {
  const result = await translate(text);
} catch (error) {
  console.error('Translation failed:', error.message);
}
```

**New Error Handling:**
```javascript
try {
  const result = await translator.translate(request);
} catch (error) {
  switch (error.code) {
    case 'PROVIDER_QUOTA_EXCEEDED':
      // Handle quota exceeded
      break;
    case 'PROVIDER_AUTH_FAILED':
      // Handle authentication failure
      break;
    default:
      // Handle generic error
  }
}
```

---

## Step-by-Step Migration

### Phase 1: Preparation and Planning

#### 1.1 Analyze Current Codebase

```bash
# Backup your current extension
cp -r qwen-translator-extension qwen-translator-extension-backup

# Analyze current structure
find . -name "*.js" -exec wc -l {} + | sort -n
grep -r "qwenTranslator" . --include="*.js"
grep -r "chrome.runtime.sendMessage" . --include="*.js"
```

#### 1.2 Identify Customizations

Document any customizations you've made:

- Custom providers
- Modified UI components
- Additional configuration options
- Custom message handlers
- Modified translation logic

#### 1.3 Plan Migration Strategy

**Recommended approach**: Incremental migration

1. **Core modules first**: Migrate to new configuration and error handling
2. **Provider system**: Update provider integrations
3. **UI components**: Migrate popup and options pages
4. **Content scripts**: Update DOM interaction logic
5. **Testing**: Validate each phase thoroughly

### Phase 2: Core System Migration

#### 2.1 Update Package Dependencies

```bash
# Update to latest version
npm install

# Optional: install additional editor typings
npm install --save-dev @types/chrome
```

#### 2.2 Migrate Configuration System

**Step 1**: Create migration script

```javascript
// scripts/migrate-config.js
async function migrateConfiguration() {
  // Read old configuration
  const oldConfig = await chrome.storage.sync.get();
  
  // Transform to new structure
  const newConfig = {
    providers: {
      qwen: {
        id: 'qwen',
        name: 'Qwen Translation',
        apiKey: oldConfig.apiKey || '',
        apiEndpoint: oldConfig.apiEndpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: oldConfig.model || 'qwen-mt-turbo',
        enabled: true,
        weight: 1.0,
        requestLimit: 60,
        tokenLimit: 100000,
        charLimit: 6000
      }
    },
    activeProvider: 'qwen',
    fallbackProviders: [],
    sourceLanguage: oldConfig.sourceLanguage || 'auto',
    targetLanguage: oldConfig.targetLanguage || 'en',
    theme: oldConfig.theme || 'modern',
    cache: {
      enabled: true,
      maxEntries: oldConfig.cacheSize || 1000,
      defaultTtl: 300000
    },
    features: {
      pdfTranslation: true,
      contextMenu: true,
      shortcuts: true,
      batchTranslation: true
    }
  };
  
  // Save new configuration
  await chrome.storage.sync.set(newConfig);
  
  console.log('Configuration migrated successfully');
  return newConfig;
}
```

**Step 2**: Initialize new core modules

```javascript
// src/core/migration-helper.js
class MigrationHelper {
  static async initializeCoreModules() {
    // Initialize configuration manager
    const configManager = new ConfigManager();
    await configManager.initialize();
    
    // Initialize cache manager
    const cacheManager = new CacheManager({
      maxEntries: 1000,
      defaultTtl: 300000
    });
    await cacheManager.initialize();
    
    // Initialize throttle manager
    const throttleManager = new ThrottleManager();
    await throttleManager.initialize();
    
    // Initialize logger
    const logger = Logger.create('migration');
    logger.info('Core modules initialized');
    
    return {
      configManager,
      cacheManager,
      throttleManager,
      logger
    };
  }
}
```

#### 2.3 Update Background Script

**Step 1**: Migrate background.js structure

```javascript
// src/background.js - migrated version
importScripts(
  // Core modules
  'core/types.js',
  'core/config-manager.js', 
  'core/cache-manager.js',
  'core/throttle-manager.js',
  'core/logger.js',
  'core/error-manager.js',
  
  // Libraries
  'lib/messaging.js',
  'lib/providers.js',
  
  // Legacy compatibility
  'translator.js',
  'config.js'
);

class BackgroundService {
  constructor() {
    this.modules = null;
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Initialize core modules
      this.modules = await MigrationHelper.initializeCoreModules();
      
      // Set up message handling
      this.setupMessageHandling();
      
      // Initialize providers
      await this.initializeProviders();
      
      this.initialized = true;
      this.modules.logger.info('Background service initialized');
      
    } catch (error) {
      console.error('Failed to initialize background service:', error);
      throw error;
    }
  }
  
  setupMessageHandling() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ 
          success: false, 
          error: { 
            code: error.code || 'UNKNOWN_ERROR',
            message: error.message 
          }
        }));
      
      return true; // Async response
    });
  }
  
  async handleMessage(message, sender) {
    const { type, data } = message;
    
    switch (type) {
      case 'translate':
        return await this.handleTranslateRequest(data);
      
      case 'batch-translate':
        return await this.handleBatchTranslateRequest(data);
      
      case 'get-config':
        return await this.modules.configManager.get(data.key, data.defaultValue);
      
      case 'set-config':
        return await this.modules.configManager.set(data.key, data.value);
      
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  }
  
  async handleTranslateRequest(data) {
    const { text, sourceLanguage, targetLanguage, provider } = data;
    
    // Use new provider system
    const translationProvider = this.providerRegistry.get(provider || 'qwen');
    if (!translationProvider) {
      throw new Error(`Provider ${provider} not available`);
    }
    
    return await translationProvider.translate({
      text,
      sourceLanguage,
      targetLanguage
    });
  }
}

// Initialize background service
const backgroundService = new BackgroundService();
backgroundService.initialize().catch(console.error);
```

### Phase 3: Provider System Migration

#### 3.1 Convert Existing Provider

**Old provider code:**
```javascript
// Old: src/providers/qwen-old.js
async function translateWithQwen(text, source, target) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ text, source, target })
  });
  return response.json();
}
```

**New provider structure:**
```javascript
// New: src/providers/qwen.js
class QwenProvider {
  constructor(config) {
    this.id = 'qwen';
    this.name = 'Qwen Translation';
    this.config = config;
    this.logger = Logger.create('provider:qwen');
  }
  
  async translate(request) {
    const startTime = Date.now();
    
    try {
      this.validateRequest(request);
      
      const response = await fetch(this.config.apiEndpoint + '/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{
            role: 'user',
            content: `Translate the following text from ${request.sourceLanguage} to ${request.targetLanguage}:\n\n${request.text}`
          }]
        })
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      const data = await response.json();
      const translatedText = data.choices[0]?.message?.content || '';
      
      return {
        translatedText,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        provider: this.id,
        model: this.config.model,
        tokensUsed: data.usage?.total_tokens || 0,
        duration: Date.now() - startTime,
        confidence: 0.9, // Default confidence
        cached: false
      };
      
    } catch (error) {
      this.logger.error('Translation failed', error);
      throw this.mapError(error);
    }
  }
  
  validateRequest(request) {
    if (!request.text || request.text.trim().length === 0) {
      throw new Error('Text is required');
    }
    
    if (request.text.length > this.config.charLimit) {
      const error = new Error('Text too long');
      error.code = 'TEXT_TOO_LONG';
      throw error;
    }
  }
  
  mapError(error) {
    if (error.message.includes('401')) {
      error.code = 'PROVIDER_AUTH_FAILED';
    } else if (error.message.includes('429')) {
      error.code = 'PROVIDER_QUOTA_EXCEEDED';
    } else if (error.message.includes('timeout')) {
      error.code = 'TIMEOUT_ERROR';
    }
    
    return error;
  }
  
  async detectLanguage(text) {
    // Implementation for language detection
    return 'auto';
  }
  
  async getSupportedLanguages() {
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' },
      { code: 'zh', name: 'Chinese' }
    ];
  }
  
  validateConfig(config) {
    const errors = [];
    
    if (!config.apiKey) {
      errors.push('API key is required');
    }
    
    if (!config.apiEndpoint) {
      errors.push('API endpoint is required');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings: []
    };
  }
}

// Register provider
if (typeof self !== 'undefined' && self.providerRegistry) {
  self.providerRegistry.register(QwenProvider);
}
```

#### 3.2 Register Migrated Providers

```javascript
// src/lib/provider-migration.js
class ProviderMigration {
  static async migrateProviders() {
    const providerRegistry = new ProviderRegistry();
    
    // Migrate existing provider configurations
    const config = await chrome.storage.sync.get();
    
    // Register migrated Qwen provider
    if (config.apiKey) {
      const qwenProvider = new QwenProvider({
        id: 'qwen',
        apiKey: config.apiKey,
        apiEndpoint: config.apiEndpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: config.model || 'qwen-mt-turbo',
        enabled: true,
        requestLimit: 60,
        tokenLimit: 100000,
        charLimit: 6000
      });
      
      providerRegistry.register(qwenProvider);
    }
    
    // Add any additional custom providers here
    
    return providerRegistry;
  }
}
```

### Phase 4: UI Component Migration

#### 4.1 Migrate Popup Interface

**Step 1**: Update popup.html structure

```html
<!-- src/popup.html - migrated -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
  <link rel="stylesheet" href="styles/modern.css">
</head>
<body>
  <div id="app">
    <!-- Theme selector -->
    <div class="header">
      <select id="theme-selector">
        <option value="modern">Modern</option>
        <option value="cyberpunk">Cyberpunk</option>
        <option value="apple">Apple</option>
      </select>
      <button id="settings-button">Settings</button>
    </div>
    
    <!-- Provider selection -->
    <div id="provider-grid" class="provider-grid">
      <!-- Dynamically populated -->
    </div>
    
    <!-- Language selection -->
    <div class="language-section">
      <select id="source-language">
        <option value="auto">Auto Detect</option>
      </select>
      <span class="arrow">→</span>
      <select id="target-language">
        <option value="en">English</option>
      </select>
    </div>
    
    <!-- Action button -->
    <button id="translate-button" class="primary-button">
      Translate Page
    </button>
    
    <!-- Loading overlay -->
    <div id="loading-overlay" class="loading-overlay">
      <div class="spinner"></div>
      <p>Translating...</p>
    </div>
  </div>
  
  <!-- Scripts -->
  <script src="core/types.js"></script>
  <script src="popup/home.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

**Step 2**: Migrate popup JavaScript

```javascript
// src/popup/home.js - new modular approach
class PopupHome {
  constructor() {
    this.configManager = null;
    this.providerRegistry = null;
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Initialize managers
      this.configManager = new ConfigManager();
      await this.configManager.initialize();
      
      // Load UI state
      await this.loadProviders();
      await this.loadLanguages();
      await this.loadSettings();
      
      // Setup event listeners
      this.setupEventListeners();
      
      this.initialized = true;
      
    } catch (error) {
      console.error('Failed to initialize popup:', error);
    }
  }
  
  async loadProviders() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'get-providers',
        data: {},
        sender: 'popup'
      });
      
      if (response.success) {
        this.renderProviders(response.data.providers);
      }
      
    } catch (error) {
      console.error('Failed to load providers:', error);
      // Show fallback providers
      this.renderFallbackProviders();
    }
  }
  
  renderProviders(providers) {
    const grid = document.getElementById('provider-grid');
    grid.innerHTML = '';
    
    providers.forEach(provider => {
      const card = document.createElement('div');
      card.className = 'provider-card';
      card.dataset.providerId = provider.id;
      card.innerHTML = `
        <h3>${provider.name}</h3>
        <div class="provider-status ${provider.enabled ? 'enabled' : 'disabled'}">
          ${provider.enabled ? '●' : '○'}
        </div>
      `;
      
      grid.appendChild(card);
    });
  }
  
  setupEventListeners() {
    // Provider selection
    document.getElementById('provider-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.provider-card');
      if (card) {
        this.selectProvider(card.dataset.providerId);
      }
    });
    
    // Translation button
    document.getElementById('translate-button').addEventListener('click', () => {
      this.handleTranslate();
    });
    
    // Settings button
    document.getElementById('settings-button').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    // Language selectors
    document.getElementById('source-language').addEventListener('change', (e) => {
      this.configManager.set('sourceLanguage', e.target.value);
    });
    
    document.getElementById('target-language').addEventListener('change', (e) => {
      this.configManager.set('targetLanguage', e.target.value);
    });
  }
  
  async handleTranslate() {
    const activeProvider = this.getActiveProvider();
    if (!activeProvider) {
      this.showError('Please select a translation provider');
      return;
    }
    
    const sourceLanguage = document.getElementById('source-language').value;
    const targetLanguage = document.getElementById('target-language').value;
    
    this.showLoading(true);
    
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Send translation request to content script
      await chrome.tabs.sendMessage(tab.id, {
        type: 'translate-page',
        data: {
          provider: activeProvider,
          sourceLanguage,
          targetLanguage
        },
        sender: 'popup'
      });
      
      // Close popup after successful translation
      window.close();
      
    } catch (error) {
      console.error('Translation failed:', error);
      this.showError('Translation failed: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }
  
  showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = show ? 'flex' : 'none';
  }
  
  showError(message) {
    // Show error notification (implement as needed)
    console.error(message);
    alert(message); // Temporary - should use proper notification system
  }
  
  getActiveProvider() {
    const activeCard = document.querySelector('.provider-card.active');
    return activeCard ? activeCard.dataset.providerId : null;
  }
  
  selectProvider(providerId) {
    // Update UI
    document.querySelectorAll('.provider-card').forEach(card => {
      card.classList.toggle('active', card.dataset.providerId === providerId);
    });
    
    // Save selection
    this.configManager.set('activeProvider', providerId);
  }
}

// Initialize when DOM loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const popup = new PopupHome();
    popup.initialize();
  });
} else {
  const popup = new PopupHome();
  popup.initialize();
}
```

#### 4.2 Migrate Content Script

**Step 1**: Update content script structure

```javascript
// src/contentScript.js - migrated version
class ContentScriptCoordinator {
  constructor() {
    this.translationService = null;
    this.domScanner = null;
    this.initialized = false;
    
    this.translatedNodes = new WeakSet();
    this.isTranslating = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Load required modules
      await this.loadModules();
      
      // Initialize services
      this.translationService = new TranslationService();
      this.domScanner = new DOMScanner();
      
      // Setup message handlers
      this.setupMessageHandlers();
      
      // Setup DOM monitoring
      this.setupDOMMonitoring();
      
      this.initialized = true;
      console.log('Content script initialized');
      
    } catch (error) {
      console.error('Failed to initialize content script:', error);
    }
  }
  
  async loadModules() {
    // Load core modules dynamically
    if (typeof ModuleLoader !== 'undefined') {
      await ModuleLoader.loadModules(['dom-scanner', 'translation-service']);
    }
  }
  
  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ 
          success: false, 
          error: { code: error.code, message: error.message }
        }));
      
      return true; // Async response
    });
  }
  
  async handleMessage(message, sender) {
    const { type, data } = message;
    
    switch (type) {
      case 'translate-page':
        return await this.translatePage(data);
      
      case 'translate-selection':
        return await this.translateSelection(data);
      
      case 'get-page-info':
        return this.getPageInfo();
      
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  }
  
  async translatePage({ provider, sourceLanguage, targetLanguage }) {
    if (this.isTranslating) {
      throw new Error('Translation already in progress');
    }
    
    this.isTranslating = true;
    
    try {
      // Scan for translatable elements
      const textNodes = this.domScanner.findTranslatableNodes();
      console.log(`Found ${textNodes.length} translatable nodes`);
      
      // Group nodes into batches
      const batches = this.createTranslationBatches(textNodes);
      
      let translatedCount = 0;
      
      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        try {
          // Send batch for translation
          const response = await chrome.runtime.sendMessage({
            type: 'batch-translate',
            data: {
              texts: batch.texts,
              sourceLanguage,
              targetLanguage,
              provider
            },
            sender: 'content'
          });
          
          if (response.success) {
            this.applyTranslations(batch.nodes, response.data.translations);
            translatedCount += batch.nodes.length;
          }
          
        } catch (error) {
          console.error(`Batch ${i + 1} failed:`, error);
        }
      }
      
      return { translatedCount, totalNodes: textNodes.length };
      
    } finally {
      this.isTranslating = false;
    }
  }
  
  createTranslationBatches(textNodes, maxBatchSize = 50) {
    const batches = [];
    
    for (let i = 0; i < textNodes.length; i += maxBatchSize) {
      const batchNodes = textNodes.slice(i, i + maxBatchSize);
      const batchTexts = batchNodes.map(node => node.textContent.trim());
      
      batches.push({
        nodes: batchNodes,
        texts: batchTexts
      });
    }
    
    return batches;
  }
  
  applyTranslations(nodes, translations) {
    nodes.forEach((node, index) => {
      if (translations[index] && translations[index].translatedText) {
        const originalText = node.textContent;
        const translatedText = translations[index].translatedText;
        
        // Apply translation
        node.textContent = translatedText;
        
        // Mark as translated
        this.translatedNodes.add(node);
        
        // Add metadata
        if (node.parentElement) {
          node.parentElement.setAttribute('data-translated', 'true');
          node.parentElement.setAttribute('data-original', originalText);
        }
      }
    });
  }
}

// DOM Scanner class
class DOMScanner {
  findTranslatableNodes() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      this.createTextFilter(),
      false
    );
    
    const textNodes = [];
    let node;
    
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }
    
    return textNodes;
  }
  
  createTextFilter() {
    return {
      acceptNode: (node) => {
        // Skip empty nodes
        const text = node.textContent.trim();
        if (!text || text.length < 3) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip script/style elements
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        const tagName = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'template'].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip invisible elements
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    };
  }
}

// Initialize content script
const contentScript = new ContentScriptCoordinator();
contentScript.initialize();
```

### Phase 5: Testing and Validation

#### 5.1 Create Migration Test Suite

```javascript
// test/migration.test.js
describe('Migration from v1.x to v2.x', () => {
  let mockStorage;
  
  beforeEach(() => {
    // Mock Chrome APIs
    mockStorage = {
      sync: { get: jest.fn(), set: jest.fn() },
      local: { get: jest.fn(), set: jest.fn() }
    };
    
    global.chrome = {
      storage: mockStorage,
      runtime: { sendMessage: jest.fn() }
    };
  });
  
  describe('Configuration Migration', () => {
    test('should migrate v1 config to v2 structure', async () => {
      // Setup v1 config
      const v1Config = {
        apiKey: 'sk-test123',
        model: 'qwen-turbo',
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        timeout: 5000
      };
      
      mockStorage.sync.get.mockResolvedValue(v1Config);
      mockStorage.sync.set.mockResolvedValue();
      
      // Run migration
      const migrated = await migrateConfiguration();
      
      // Verify v2 structure
      expect(migrated.providers.qwen.apiKey).toBe('sk-test123');
      expect(migrated.providers.qwen.model).toBe('qwen-turbo');
      expect(migrated.activeProvider).toBe('qwen');
      expect(migrated.sourceLanguage).toBe('auto');
      expect(migrated.targetLanguage).toBe('en');
    });
  });
  
  describe('Provider Migration', () => {
    test('should create provider from v1 config', () => {
      const v1Config = {
        apiKey: 'sk-test123',
        apiEndpoint: 'https://api.example.com',
        model: 'test-model'
      };
      
      const provider = new QwenProvider({
        id: 'qwen',
        apiKey: v1Config.apiKey,
        apiEndpoint: v1Config.apiEndpoint,
        model: v1Config.model
      });
      
      expect(provider.id).toBe('qwen');
      expect(provider.config.apiKey).toBe('sk-test123');
      expect(provider.config.model).toBe('test-model');
    });
  });
  
  describe('Message Protocol Migration', () => {
    test('should handle both v1 and v2 message formats', async () => {
      const messageHandler = new MessageHandler();
      
      // Test v1 format (backward compatibility)
      const v1Message = {
        action: 'translate',
        text: 'Hello',
        source: 'en',
        target: 'es'
      };
      
      const v1Result = await messageHandler.handle(v1Message);
      expect(v1Result.success).toBe(true);
      
      // Test v2 format
      const v2Message = {
        type: 'translate',
        data: {
          text: 'Hello',
          sourceLanguage: 'en',
          targetLanguage: 'es'
        }
      };
      
      const v2Result = await messageHandler.handle(v2Message);
      expect(v2Result.success).toBe(true);
    });
  });
});
```

#### 5.2 Validation Checklist

After migration, verify the following:

- [ ] **Configuration**: Settings load correctly from storage
- [ ] **Providers**: All providers are registered and functional  
- [ ] **UI**: Popup and options pages work as expected
- [ ] **Translation**: Page translation works end-to-end
- [ ] **Error Handling**: Errors are properly caught and displayed
- [ ] **Performance**: No significant performance regression
- [ ] **Compatibility**: Works across different browser versions

#### 5.3 End-to-End Testing

```bash
# Run comprehensive test suite
npm test
npm run test:e2e

# Test in different browsers
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=webkit

# Performance testing
npm run size
npm run test:performance
```

---

## Configuration Migration

### Automated Migration Script

Create a comprehensive migration script to handle configuration updates:

```javascript
// scripts/complete-migration.js
class CompleteMigration {
  constructor() {
    this.logger = console;
    this.backupKey = 'migration_backup_' + Date.now();
  }
  
  async migrate() {
    try {
      this.logger.info('Starting complete migration...');
      
      // Step 1: Backup existing configuration
      await this.backupConfiguration();
      
      // Step 2: Migrate configuration structure
      await this.migrateConfiguration();
      
      // Step 3: Initialize new modules
      await this.initializeModules();
      
      // Step 4: Migrate providers
      await this.migrateProviders();
      
      // Step 5: Update UI preferences
      await this.migrateUIPreferences();
      
      // Step 6: Validate migration
      await this.validateMigration();
      
      this.logger.info('Migration completed successfully');
      
    } catch (error) {
      this.logger.error('Migration failed:', error);
      await this.rollback();
      throw error;
    }
  }
  
  async backupConfiguration() {
    const currentConfig = await chrome.storage.sync.get();
    await chrome.storage.local.set({
      [this.backupKey]: {
        config: currentConfig,
        timestamp: Date.now(),
        version: '1.x'
      }
    });
    
    this.logger.info('Configuration backed up');
  }
  
  async migrateConfiguration() {
    const oldConfig = await chrome.storage.sync.get();
    
    const newConfig = {
      // Version info
      version: '2.0.0',
      migrated: true,
      migrationDate: new Date().toISOString(),
      
      // Provider configuration
      providers: {},
      activeProvider: null,
      fallbackProviders: [],
      
      // Core settings
      sourceLanguage: oldConfig.sourceLanguage || 'auto',
      targetLanguage: oldConfig.targetLanguage || 'en',
      
      // Feature flags
      features: {
        experimental: false,
        pdfTranslation: true,
        contextMenu: true,
        shortcuts: true,
        batchTranslation: true,
        autoDetection: true,
        history: false,
        glossary: false
      },
      
      // UI configuration
      ui: {
        theme: oldConfig.theme || 'modern',
        showOverlay: true,
        overlayPosition: 'top',
        animations: true,
        fontScale: 1.0,
        highContrast: false,
        reduceMotion: false
      },
      
      // Cache configuration
      cache: {
        enabled: true,
        maxEntries: oldConfig.cacheSize || 1000,
        defaultTtl: 300000,
        cleanupInterval: 60000,
        evictionStrategy: 'lru',
        storageBackend: 'memory'
      },
      
      // Throttling configuration
      throttle: {
        requestLimit: 60,
        tokenLimit: 100000,
        windowMs: 60000,
        contexts: {}
      }
    };
    
    // Migrate provider-specific settings
    if (oldConfig.apiKey) {
      newConfig.providers.qwen = {
        id: 'qwen',
        name: 'Qwen Translation',
        apiKey: oldConfig.apiKey,
        apiEndpoint: oldConfig.apiEndpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: oldConfig.model || 'qwen-mt-turbo',
        models: ['qwen-mt-turbo', 'qwen-turbo'],
        requestLimit: 60,
        tokenLimit: 100000,
        charLimit: 6000,
        weight: 1.0,
        strategy: 'balanced',
        costPerInputToken: 0.0001,
        costPerOutputToken: 0.0002,
        enabled: true
      };
      
      newConfig.activeProvider = 'qwen';
    }
    
    // Save new configuration
    await chrome.storage.sync.set(newConfig);
    
    this.logger.info('Configuration structure migrated');
    return newConfig;
  }
  
  async validateMigration() {
    const config = await chrome.storage.sync.get();
    const issues = [];
    
    // Check required fields
    if (!config.version) {
      issues.push('Version not set');
    }
    
    if (!config.providers || Object.keys(config.providers).length === 0) {
      issues.push('No providers configured');
    }
    
    if (config.activeProvider && !config.providers[config.activeProvider]) {
      issues.push('Active provider not found in providers list');
    }
    
    // Validate provider configurations
    for (const [id, provider] of Object.entries(config.providers || {})) {
      if (!provider.apiKey) {
        issues.push(`Provider ${id} missing API key`);
      }
      
      if (!provider.apiEndpoint) {
        issues.push(`Provider ${id} missing API endpoint`);
      }
    }
    
    if (issues.length > 0) {
      throw new Error(`Migration validation failed: ${issues.join(', ')}`);
    }
    
    this.logger.info('Migration validated successfully');
  }
  
  async rollback() {
    try {
      const backup = await chrome.storage.local.get(this.backupKey);
      if (backup[this.backupKey]) {
        await chrome.storage.sync.set(backup[this.backupKey].config);
        this.logger.info('Rollback completed');
      }
    } catch (error) {
      this.logger.error('Rollback failed:', error);
    }
  }
}

// Usage
const migration = new CompleteMigration();
migration.migrate().catch(console.error);
```

---

## Rollback Procedures

### When to Rollback

Consider rollback in these scenarios:

- Migration validation fails
- Critical functionality is broken
- Performance significantly degraded
- Users report severe issues
- Data corruption detected

### Automated Rollback

```javascript
// scripts/rollback.js
class RollbackManager {
  static async performRollback() {
    try {
      console.log('Starting rollback...');
      
      // Find latest backup
      const storage = await chrome.storage.local.get();
      const backups = Object.keys(storage)
        .filter(key => key.startsWith('migration_backup_'))
        .map(key => ({ key, timestamp: storage[key].timestamp }))
        .sort((a, b) => b.timestamp - a.timestamp);
      
      if (backups.length === 0) {
        throw new Error('No backup found for rollback');
      }
      
      const latestBackup = storage[backups[0].key];
      
      // Restore configuration
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(latestBackup.config);
      
      // Clear migration flag
      await chrome.storage.local.remove('migration_completed');
      
      console.log('Rollback completed successfully');
      
    } catch (error) {
      console.error('Rollback failed:', error);
      throw error;
    }
  }
}
```

### Manual Rollback Steps

1. **Backup Current State**: Before rollback, backup current state
2. **Restore Files**: Copy v1.x files back to extension directory
3. **Restore Configuration**: Use backup to restore storage data
4. **Test Functionality**: Verify that v1.x functionality works
5. **Clear Cache**: Clear any v2.x cache or temporary data

```bash
# Manual rollback script
#!/bin/bash

echo "Starting manual rollback..."

# 1. Backup current v2 state
cp -r dist dist-v2-backup

# 2. Restore v1 files
cp -r qwen-translator-extension-backup/* .

# 3. Rebuild v1 extension
npm install
npm run build

# 4. Load in browser and test
echo "Rollback completed. Please test the extension."
```

---

## Common Migration Issues

### Issue 1: Module Loading Errors

**Symptoms:**
- `importScripts` fails in background.js
- Module not found errors
- Extension won't start

**Solution:**
```javascript
// Check if modules exist before loading
const requiredModules = [
  'core/config-manager.js',
  'core/cache-manager.js',
  'lib/providers.js'
];

for (const module of requiredModules) {
  try {
    importScripts(module);
  } catch (error) {
    console.error(`Failed to load ${module}:`, error);
    // Load fallback or legacy module
    if (module.includes('config-manager.js')) {
      importScripts('config.js'); // Fallback to legacy
    }
  }
}
```

### Issue 2: Configuration Structure Mismatch

**Symptoms:**
- Settings not loading
- Provider configuration errors
- UI showing default values

**Solution:**
```javascript
// Graceful configuration handling
async function loadConfigWithFallback() {
  try {
    const config = await configManager.get();
    
    // Check if config has v2 structure
    if (config.providers && config.version) {
      return config;
    }
    
    // Fallback to v1 structure
    const legacyConfig = await chrome.storage.sync.get();
    return migrateLegacyConfig(legacyConfig);
    
  } catch (error) {
    console.error('Config load failed:', error);
    return getDefaultConfig();
  }
}
```

### Issue 3: Provider Registration Failures

**Symptoms:**
- Providers not appearing in UI
- Translation requests fail
- "Provider not found" errors

**Solution:**
```javascript
// Robust provider registration
class ProviderRegistration {
  static async registerWithFallback() {
    const providers = [];
    
    try {
      // Try to register new providers
      const qwenProvider = new QwenProvider(config.providers.qwen);
      providers.push(qwenProvider);
      
    } catch (error) {
      console.warn('New provider registration failed, using legacy:', error);
      
      // Fallback to legacy provider
      const legacyProvider = {
        id: 'qwen-legacy',
        translate: legacyTranslateFunction
      };
      providers.push(legacyProvider);
    }
    
    return providers;
  }
}
```

### Issue 4: Message Protocol Incompatibility

**Symptoms:**
- Popup-background communication fails
- Content script errors
- Message format errors

**Solution:**
```javascript
// Universal message handler
function handleMessage(message, sender, sendResponse) {
  // Detect message format
  if (message.action) {
    // v1 format - convert to v2
    const v2Message = {
      type: message.action,
      data: { ...message },
      sender: 'unknown',
      version: 1
    };
    return handleV2Message(v2Message, sender, sendResponse);
  }
  
  if (message.type) {
    // v2 format
    return handleV2Message(message, sender, sendResponse);
  }
  
  // Unknown format
  sendResponse({ 
    success: false, 
    error: { code: 'INVALID_MESSAGE_FORMAT', message: 'Unknown message format' }
  });
}
```

### Issue 5: Performance Regression

**Symptoms:**
- Slower translation
- High memory usage
- UI lag

**Solutions:**
```javascript
// Performance monitoring during migration
class PerformanceMonitor {
  static startMigrationMonitoring() {
    const startTime = performance.now();
    const startMemory = performance.memory?.usedJSHeapSize || 0;
    
    return {
      end() {
        const endTime = performance.now();
        const endMemory = performance.memory?.usedJSHeapSize || 0;
        
        console.log({
          migrationDuration: endTime - startTime,
          memoryDelta: endMemory - startMemory,
          memoryIncrease: ((endMemory - startMemory) / startMemory) * 100
        });
      }
    };
  }
}

// Use during migration
const monitor = PerformanceMonitor.startMigrationMonitoring();
await performMigration();
monitor.end();
```

---

## Post-Migration Best Practices

### 1. Gradual Feature Adoption

Don't enable all new features immediately. Roll them out gradually:

```javascript
// Feature flag management
const featureRollout = {
  week1: ['basic-providers', 'new-ui'],
  week2: ['advanced-caching', 'throttling'],
  week3: ['pdf-translation', 'wasm-modules'],
  week4: ['experimental-features']
};

async function enableFeaturesGradually() {
  const migrationDate = await configManager.get('migrationDate');
  const weeksSinceMigration = Math.floor((Date.now() - new Date(migrationDate).getTime()) / (7 * 24 * 60 * 60 * 1000));
  
  const availableFeatures = featureRollout[`week${Math.min(weeksSinceMigration + 1, 4)}`] || [];
  
  for (const feature of availableFeatures) {
    await configManager.set(`features.${feature}`, true);
  }
}
```

### 2. Monitoring and Alerting

Set up monitoring for the migrated extension:

```javascript
// Migration health monitoring
class MigrationHealthCheck {
  static async performHealthCheck() {
    const issues = [];
    
    try {
      // Check core modules
      const configManager = new ConfigManager();
      await configManager.initialize();
      
      // Check providers
      const providers = await providerRegistry.getAll();
      if (providers.length === 0) {
        issues.push('No providers registered');
      }
      
      // Check translation functionality
      const testResult = await testTranslation();
      if (!testResult.success) {
        issues.push('Translation test failed');
      }
      
      // Report health status
      if (issues.length === 0) {
        console.log('Migration health check: PASSED');
      } else {
        console.error('Migration health check: FAILED', issues);
        // Send telemetry or alert
      }
      
    } catch (error) {
      console.error('Health check failed:', error);
      issues.push('Health check exception: ' + error.message);
    }
    
    return { healthy: issues.length === 0, issues };
  }
}

// Run health checks periodically
setInterval(() => {
  MigrationHealthCheck.performHealthCheck();
}, 24 * 60 * 60 * 1000); // Daily
```

### 3. User Communication

Inform users about the migration:

```javascript
// Migration notification system
class MigrationNotification {
  static async showMigrationComplete() {
    const config = await configManager.get();
    
    if (config.migrated && !config.migrationNotificationShown) {
      // Show welcome notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Qwen Translator Updated',
        message: 'Your extension has been upgraded to v2.0 with improved performance and new features!'
      });
      
      // Mark as shown
      await configManager.set('migrationNotificationShown', true);
    }
  }
}
```

---

This comprehensive migration guide provides everything needed to successfully migrate from the monolithic v1.x architecture to the modular v2.x system. The migration preserves functionality while introducing modern architectural patterns, improved performance, and enhanced maintainability.

Remember to test thoroughly at each phase and maintain backups throughout the migration process. The modular architecture will provide a much better foundation for future development and maintenance.
