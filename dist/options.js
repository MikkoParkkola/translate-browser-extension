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
          quotaText += `${provider}:\n`;
          quotaText += `  Requests (last minute): ${usage.requests}\n`;
          quotaText += `  Tokens (last minute): ${usage.tokens}\n`;
          quotaText += `  Total requests: ${usage.totalRequests}\n`;
          quotaText += `  Total tokens: ${usage.totalTokens}\n\n`;
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
})();
