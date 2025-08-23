// src/options.js

(async function () {
  try { window.qwenProviders?.initProviders?.(); } catch {}
  
  const defaults = {
    settingsTab: 'general',
    enableDetection: true,
    glossary: '',
    cacheEnabled: false,
    localProviders: [],
    selectionPopup: false,
    sensitivity: 0.3,
    minDetectLength: 2,
    translateTimeoutMs: 20000,
    failoverEnabled: true,
    parallelProcessing: 'auto',
    theme: 'dark',
    themeStyle: 'apple'
  };

  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
      if (typeof cb === 'function') cb(...args);
    };
  }

  // Load settings
  const store = await new Promise(res => {
    if (chrome?.storage?.sync) chrome.storage.sync.get(defaults, res);
    else res(defaults);
  });

  // Set up theme
  document.documentElement.setAttribute('data-qwen-theme', store.themeStyle || 'apple');
  document.documentElement.setAttribute('data-qwen-color', store.theme || 'dark');
  
  const themeSel = document.getElementById('theme');
  const themeStyleSel = document.getElementById('themeStyle');
  
  if (themeSel) {
    themeSel.value = store.theme || 'dark';
    themeSel.addEventListener('change', () => {
      const theme = themeSel.value;
      document.documentElement.setAttribute('data-qwen-color', theme);
      chrome?.storage?.sync?.set({ theme });
      chrome.runtime.sendMessage({ action: 'set-config', config: { theme } }, handleLastError());
    });
  }
  
  if (themeStyleSel) {
    themeStyleSel.value = store.themeStyle || 'apple';
    themeStyleSel.addEventListener('change', () => {
      const style = themeStyleSel.value;
      document.documentElement.setAttribute('data-qwen-theme', style);
      chrome?.storage?.sync?.set({ themeStyle: style });
      chrome.runtime.sendMessage({ action: 'set-config', config: { themeStyle: style } }, handleLastError());
    });
  }

  // Set up tabs
  const tabs = document.querySelectorAll('.tabs button');
  const sections = {
    general: document.getElementById('generalTab'),
    providers: document.getElementById('providersTab'),
    advanced: document.getElementById('advancedTab'),
    diagnostics: document.getElementById('diagnosticsTab'),
  };

  function activate(tab) {
    tabs.forEach(b => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
      b.setAttribute('tabindex', active ? '0' : '-1');
    });
    Object.entries(sections).forEach(([k, el]) => {
      el.classList.toggle('active', k === tab);
    });
  }

  // Activate the stored tab or default to general
  activate(store.settingsTab || 'general');
  
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      activate(btn.dataset.tab);
      chrome?.storage?.sync?.set({ settingsTab: btn.dataset.tab });
    });
  });

  // Initialize language selection
  const sourceLanguageSelect = document.getElementById('source-language');
  if (sourceLanguageSelect) {
    try {
      // Load comprehensive language list
      if (typeof window !== 'undefined' && window.qwenLanguages) {
        // Clear existing options (except the auto option)
        while (sourceLanguageSelect.firstChild) {
          if (sourceLanguageSelect.firstChild.value === 'auto') {
            break;
          }
          sourceLanguageSelect.removeChild(sourceLanguageSelect.firstChild);
        }
        
        // Add all languages
        window.qwenLanguages.forEach(lang => {
          const option = document.createElement('option');
          option.value = lang.code;
          option.textContent = lang.name;
          sourceLanguageSelect.appendChild(option);
        });
      }
      
      // Set the current value
      sourceLanguageSelect.value = store.sourceLanguage || 'auto';
      
      // Add event listener
      sourceLanguageSelect.addEventListener('change', () => {
        chrome.storage.local.set({ sourceLanguage: sourceLanguageSelect.value });
      });
    } catch (error) {
      console.error('Failed to load languages:', error);
    }
  }

  // Initialize general settings
  const enableDetection = document.getElementById('enableDetection');
  const glossary = document.getElementById('glossary');
  const selectionPopup = document.getElementById('selectionPopup');
  const sensitivity = document.getElementById('sensitivity');
  const minDetectLength = document.getElementById('minDetectLength');
  
  if (enableDetection) {
    enableDetection.checked = store.enableDetection !== false;
    enableDetection.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ enableDetection: enableDetection.checked });
    });
  }
  
  if (glossary) {
    glossary.value = store.glossary || '';
    glossary.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ glossary: glossary.value });
    });
  }
  
  if (selectionPopup) {
    selectionPopup.checked = !!store.selectionPopup;
    selectionPopup.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ selectionPopup: selectionPopup.checked });
    });
  }
  
  if (sensitivity) {
    sensitivity.value = store.sensitivity || 0.3;
    sensitivity.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ sensitivity: parseFloat(sensitivity.value) });
    });
  }
  
  if (minDetectLength) {
    minDetectLength.value = store.minDetectLength || 2;
    minDetectLength.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ minDetectLength: parseInt(minDetectLength.value) });
    });
  }

  // Initialize advanced settings
  const translateTimeoutMs = document.getElementById('translateTimeoutMs');
  const cacheEnabled = document.getElementById('cacheEnabled');
  const failoverEnabled = document.getElementById('failoverEnabled');
  const parallelProcessing = document.getElementById('parallelProcessing');
  
  if (translateTimeoutMs) {
    translateTimeoutMs.value = store.translateTimeoutMs || 20000;
    translateTimeoutMs.addEventListener('change', () => {
      const value = parseInt(translateTimeoutMs.value);
      chrome?.storage?.sync?.set({ translateTimeoutMs: value });
      chrome.runtime.sendMessage({ action: 'set-config', config: { translateTimeoutMs: value } }, handleLastError());
    });
  }
  
  if (cacheEnabled) {
    cacheEnabled.checked = !!store.cacheEnabled;
    cacheEnabled.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ cacheEnabled: cacheEnabled.checked });
    });
  }
  
  if (failoverEnabled) {
    failoverEnabled.checked = store.failoverEnabled !== false;
    failoverEnabled.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ failoverEnabled: failoverEnabled.checked });
    });
  }
  
  if (parallelProcessing) {
    parallelProcessing.value = store.parallelProcessing || 'auto';
    parallelProcessing.addEventListener('change', () => {
      chrome?.storage?.sync?.set({ parallelProcessing: parallelProcessing.value });
    });
  }

  // Initialize diagnostics
  const usageStats = document.getElementById('usageStats');
  const tmMetrics = document.getElementById('tmMetrics');
  const cacheStats = document.getElementById('cacheStats');
  const quotaStats = document.getElementById('quotaStats');
  
  if (usageStats || tmMetrics || cacheStats || quotaStats) {
    // Request diagnostics data
    chrome.runtime.sendMessage({ action: 'metrics' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Failed to get metrics:', chrome.runtime.lastError);
        return;
      }
      
      if (usageStats && response.usage) {
        usageStats.textContent = JSON.stringify(response.usage, null, 2);
      }
      
      if (tmMetrics && response.tm) {
        tmMetrics.textContent = JSON.stringify(response.tm, null, 2);
      }
      
      if (cacheStats && response.cache) {
        cacheStats.textContent = JSON.stringify(response.cache, null, 2);
      }
      
      if (quotaStats && response.providersUsage) {
        // Format quota and rate limit usage information
        let quotaText = '';
        for (const [provider, usage] of Object.entries(response.providersUsage)) {
          quotaText += `${provider}:
`;
          quotaText += `  Requests (last minute): ${usage.requests}
`;
          quotaText += `  Tokens (last minute): ${usage.tokens}
`;
          quotaText += `  Total requests: ${usage.totalRequests}
`;
          quotaText += `  Total tokens: ${usage.totalTokens}

`;
        }
        quotaStats.textContent = quotaText || 'No quota data available';
      }
    });
  }

  // Set up action buttons
  const clearCache = document.getElementById('clearCache');
  const tmClear = document.getElementById('tmClear');
  const tmExport = document.getElementById('tmExport');
  const tmImport = document.getElementById('tmImport');
  const tmImportFile = document.getElementById('tmImportFile');
  
  if (clearCache) {
    clearCache.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear the translation cache?')) {
        chrome.runtime.sendMessage({ action: 'clear-cache' }, handleLastError(() => {
          alert('Cache cleared successfully');
        }));
      }
    });
  }
  
  if (tmClear) {
    tmClear.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear the translation memory?')) {
        chrome.runtime.sendMessage({ action: 'tm-clear' }, handleLastError(() => {
          alert('Translation memory cleared successfully');
        }));
      }
    });
  }
  
  if (tmExport) {
    tmExport.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'tm-get-all' }, response => {
        if (chrome.runtime.lastError || !response || !response.entries) {
          alert('Failed to export translation memory');
          return;
        }
        
        const dataStr = JSON.stringify(response.entries, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'translation-memory.json';
        link.click();
        URL.revokeObjectURL(url);
      });
    });
  }
  
  if (tmImport && tmImportFile) {
    tmImport.addEventListener('click', () => {
      if (!tmImportFile.files || tmImportFile.files.length === 0) {
        alert('Please select a file to import');
        return;
      }
      
      const file = tmImportFile.files[0];
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const entries = JSON.parse(e.target.result);
          chrome.runtime.sendMessage({ action: 'tm-import', entries }, response => {
            if (chrome.runtime.lastError || !response || !response.ok) {
              alert('Failed to import translation memory');
              return;
            }
            alert('Translation memory imported successfully');
          });
        } catch (err) {
          alert('Failed to parse import file: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  // Provider management functionality
  const providerList = document.getElementById('providerList');
  const addProvider = document.getElementById('addProvider');
  const addProviderOverlay = document.getElementById('addProviderOverlay');
  const ap_step1 = document.getElementById('ap_step1');
  const ap_step2 = document.getElementById('ap_step2');
  const ap_preset = document.getElementById('ap_preset');
  const ap_next = document.getElementById('ap_next');
  const ap_back = document.getElementById('ap_back');
  const ap_create = document.getElementById('ap_create');
  const ap_cancel1 = document.getElementById('ap_cancel1');
  const ap_fields = document.getElementById('ap_fields');
  
  // Provider editor elements
  const providerEditorOverlay = document.getElementById('providerEditorOverlay');
  const pe_apiKey = document.getElementById('pe_apiKey');
  const pe_apiEndpoint = document.getElementById('pe_apiEndpoint');
  const pe_modelSelect = document.getElementById('pe_modelSelect');
  const pe_modelInput = document.getElementById('pe_modelInput');
  const pe_modelLabel = document.getElementById('pe_modelLabel');
  const pe_requestLimit = document.getElementById('pe_requestLimit');
  const pe_tokenLimit = document.getElementById('pe_tokenLimit');
  const pe_charLimit = document.getElementById('pe_charLimit');
  const pe_strategy = document.getElementById('pe_strategy');
  const pe_costPerInputToken = document.getElementById('pe_costPerInputToken');
  const pe_costPerOutputToken = document.getElementById('pe_costPerOutputToken');
  const pe_weight = document.getElementById('pe_weight');
  const pe_save = document.getElementById('pe_save');
  const pe_cancel = document.getElementById('pe_cancel');
  const pe_advanced = document.getElementById('pe_advanced');
  
  // Current provider being edited
  let currentProvider = null;
  
  // Provider configuration templates
  const providerTemplates = {
    openai: {
      name: 'OpenAI',
      fields: ['apiKey', 'apiEndpoint', 'model'],
      defaults: {
        apiEndpoint: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo'
      }
    },
    deepl: {
      name: 'DeepL',
      fields: ['apiKey', 'apiEndpoint'],
      defaults: {
        apiEndpoint: 'https://api.deepl.com/v2'
      }
    },
    ollama: {
      name: 'Ollama',
      fields: ['apiEndpoint', 'model'],
      defaults: {
        apiEndpoint: 'http://localhost:11434/api',
        model: 'llama2'
      }
    },
    macos: {
      name: 'macOS',
      fields: [],
      defaults: {}
    },
    custom: {
      name: 'Custom',
      fields: ['apiKey', 'apiEndpoint', 'model'],
      defaults: {
        apiEndpoint: '',
        model: ''
      }
    }
  };
  
  // Initialize provider list
  function renderProviders() {
    if (!providerList) return;
    
    providerList.innerHTML = '';
    
    // Render built-in providers
    if (window.qwenProviders && window.qwenProviders.listProviders) {
      const builtinProviders = window.qwenProviders.listProviders();
      builtinProviders.forEach(provider => {
        const card = document.createElement('div');
        card.className = 'provider-card';
        card.innerHTML = `
          <h4>${provider.label || provider.name}</h4>
          <p>Built-in provider</p>
          <button class="configure-btn" data-provider="${provider.name}">Configure</button>
        `;
        providerList.appendChild(card);
      });
    }
    
    // Render local providers
    if (store.localProviders && Array.isArray(store.localProviders)) {
      store.localProviders.forEach((provider, index) => {
        const card = document.createElement('div');
        card.className = 'provider-card local';
        card.innerHTML = `
          <h4>${provider.name || 'Custom Provider'}</h4>
          <p>Local provider</p>
          <button class="configure-btn" data-local-index="${index}">Configure</button>
          <button class="delete-btn" data-local-index="${index}">Delete</button>
        `;
        providerList.appendChild(card);
      });
    }
    
    // Add event listeners to configure buttons
    providerList.querySelectorAll('.configure-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const providerName = btn.dataset.provider;
        const localIndex = btn.dataset.localIndex;
        
        if (providerName) {
          // Configure built-in provider
          configureBuiltinProvider(providerName);
        } else if (localIndex !== undefined) {
          // Configure local provider
          configureLocalProvider(parseInt(localIndex));
        }
      });
    });
    
    // Add event listeners to delete buttons
    providerList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const localIndex = parseInt(btn.dataset.localIndex);
        deleteLocalProvider(localIndex);
      });
    });
  }
  
  // Configure built-in provider
  function configureBuiltinProvider(providerName) {
    // For now, just show an alert - built-in providers are configured differently
    alert(`Built-in provider ${providerName} configuration would go here.`);
  }
  
  // Configure local provider
  function configureLocalProvider(index) {
    currentProvider = {
      index: index,
      ...store.localProviders[index]
    };
    
    // Populate the editor fields
    pe_apiKey.value = currentProvider.apiKey || '';
    pe_apiEndpoint.value = currentProvider.apiEndpoint || '';
    pe_modelInput.value = currentProvider.model || '';
    pe_requestLimit.value = currentProvider.requestLimit || '';
    pe_tokenLimit.value = currentProvider.tokenLimit || '';
    pe_charLimit.value = currentProvider.charLimit || '';
    pe_strategy.value = currentProvider.strategy || 'balanced';
    pe_costPerInputToken.value = currentProvider.costPerInputToken || '';
    pe_costPerOutputToken.value = currentProvider.costPerOutputToken || '';
    pe_weight.value = currentProvider.weight || '';
    
    // Show the editor
    providerEditorOverlay.style.display = 'flex';
  }
  
  // Delete local provider
  function deleteLocalProvider(index) {
    if (!confirm('Are you sure you want to delete this provider?')) return;
    
    const localProviders = [...(store.localProviders || [])];
    localProviders.splice(index, 1);
    
    chrome.storage.sync.set({ localProviders }, () => {
      store.localProviders = localProviders;
      renderProviders();
    });
  }
  
  // Add provider button click handler
  if (addProvider) {
    addProvider.addEventListener('click', () => {
      if (addProviderOverlay) {
        addProviderOverlay.style.display = 'flex';
        ap_step1.style.display = 'block';
        ap_step2.style.display = 'none';
      }
    });
  }
  
  // Add provider step 1 next button
  if (ap_next) {
    ap_next.addEventListener('click', () => {
      const preset = ap_preset.value;
      const template = providerTemplates[preset];
      
      if (!template) {
        alert('Invalid provider preset');
        return;
      }
      
      // Generate fields for step 2
      ap_fields.innerHTML = '';
      
      template.fields.forEach(field => {
        const label = document.createElement('label');
        label.setAttribute('data-field', field);
        
        let fieldLabel = '';
        let inputHTML = '';
        
        switch (field) {
          case 'apiKey':
            fieldLabel = 'API Key';
            inputHTML = `<input id="ap_${field}" value="${template.defaults[field] || ''}">`;
            break;
          case 'apiEndpoint':
            fieldLabel = 'API Endpoint';
            inputHTML = `<input id="ap_${field}" value="${template.defaults[field] || ''}">`;
            break;
          case 'model':
            fieldLabel = 'Model';
            inputHTML = `<input id="ap_${field}" value="${template.defaults[field] || ''}">`;
            break;
        }
        
        label.innerHTML = `${fieldLabel} ${inputHTML}`;
        ap_fields.appendChild(label);
      });
      
      // Show step 2
      ap_step1.style.display = 'none';
      ap_step2.style.display = 'block';
    });
  }
  
  // Add provider step 2 back button
  if (ap_back) {
    ap_back.addEventListener('click', () => {
      ap_step2.style.display = 'none';
      ap_step1.style.display = 'block';
    });
  }
  
  // Add provider step 2 create button
  if (ap_create) {
    ap_create.addEventListener('click', () => {
      const preset = ap_preset.value;
      const template = providerTemplates[preset];
      
      if (!template) {
        alert('Invalid provider preset');
        return;
      }
      
      // Collect field values
      const providerData = {
        id: `local-${Date.now()}`,
        name: template.name,
        type: preset,
        ...template.defaults
      };
      
      template.fields.forEach(field => {
        const input = document.getElementById(`ap_${field}`);
        if (input) {
          providerData[field] = input.value;
        }
      });
      
      // Add to local providers
      const localProviders = [...(store.localProviders || []), providerData];
      
      chrome.storage.sync.set({ localProviders }, () => {
        store.localProviders = localProviders;
        renderProviders();
        
        // Hide overlay
        if (addProviderOverlay) {
          addProviderOverlay.style.display = 'none';
        }
      });
    });
  }
  
  // Cancel buttons
  if (ap_cancel1) {
    ap_cancel1.addEventListener('click', () => {
      if (addProviderOverlay) {
        addProviderOverlay.style.display = 'none';
      }
    });
  }
  
  // Provider editor save button
  if (pe_save) {
    pe_save.addEventListener('click', () => {
      if (!currentProvider) return;
      
      // Update provider data
      const updatedProvider = {
        ...currentProvider,
        apiKey: pe_apiKey.value,
        apiEndpoint: pe_apiEndpoint.value,
        model: pe_modelInput.value,
        requestLimit: pe_requestLimit.value ? parseInt(pe_requestLimit.value) : undefined,
        tokenLimit: pe_tokenLimit.value ? parseInt(pe_tokenLimit.value) : undefined,
        charLimit: pe_charLimit.value ? parseInt(pe_charLimit.value) : undefined,
        strategy: pe_strategy.value,
        costPerInputToken: pe_costPerInputToken.value ? parseFloat(pe_costPerInputToken.value) : undefined,
        costPerOutputToken: pe_costPerOutputToken.value ? parseFloat(pe_costPerOutputToken.value) : undefined,
        weight: pe_weight.value ? parseFloat(pe_weight.value) : undefined
      };
      
      // Update in storage
      const localProviders = [...(store.localProviders || [])];
      localProviders[currentProvider.index] = updatedProvider;
      
      chrome.storage.sync.set({ localProviders }, () => {
        store.localProviders = localProviders;
        renderProviders();
        
        // Hide editor
        if (providerEditorOverlay) {
          providerEditorOverlay.style.display = 'none';
        }
        
        currentProvider = null;
      });
    });
  }
  
  // Provider editor cancel button
  if (pe_cancel) {
    pe_cancel.addEventListener('click', () => {
      if (providerEditorOverlay) {
        providerEditorOverlay.style.display = 'none';
      }
      currentProvider = null;
    });
  }
  
  // Initialize the provider list
  renderProviders();
})();