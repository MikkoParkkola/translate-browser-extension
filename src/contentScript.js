if (typeof window !== 'undefined' && window.__qwenCSLoaded) {
  // Already loaded; reuse previous module exports
  if (typeof module !== 'undefined') {
    module.exports = window.__qwenCSModule;
  }
} else {
  if (typeof window !== 'undefined') {
    window.__qwenCSLoaded = true;
  }

  const skipInit = chrome && chrome.runtime && chrome.runtime.getURL && 
    location.href.startsWith(chrome.runtime.getURL('pdfViewer.html'));
  
  // Load core modules
  const loadCoreModules = async () => {
    // Detect test environment
    const isJestEnvironment = typeof jest !== 'undefined' || 
                              typeof window !== 'undefined' && window.jest ||
                              typeof global !== 'undefined' && global.expect ||
                              typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test';
    
    // Check for test environment (no chrome.runtime or jest environment)
    if (!chrome || !chrome.runtime || !chrome.runtime.getURL || isJestEnvironment) {
      return false;
    }
    
    const moduleLoaders = [
      { src: 'core/dom-scanner.js', global: 'qwenDOMScanner' },
      { src: 'core/ui-manager.js', global: 'qwenUIManager' },
      { src: 'core/translation-batcher.js', global: 'qwenTranslationBatcher' },
      { src: 'core/translation-processor.js', global: 'qwenTranslationProcessor' },
      { src: 'core/content-script-coordinator.js', global: 'qwenContentScriptCoordinator' }
    ];
    
    console.log('[DEBUG] Creating load promises for', moduleLoaders.length, 'modules');
    const loadPromises = moduleLoaders.map(({ src, global }) => {
      return new Promise((resolve, reject) => {
        if (window[global]) {
          console.log('[DEBUG] Module already loaded:', global);
          resolve(window[global]);
          return;
        }
        
        console.log('[DEBUG] Loading module:', src);
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(src);
        script.onload = () => {
          console.log('[DEBUG] Module loaded successfully:', global);
          resolve(window[global]);
        };
        script.onerror = () => {
          console.log('[DEBUG] Module failed to load:', src);
          reject(new Error(`Failed to load ${src}`));
        };
        document.head.appendChild(script);
      });
    });
    
    try {
      console.log('[DEBUG] Waiting for all modules to load...');
      await Promise.all(loadPromises);
      console.log('[DEBUG] All modules loaded successfully');
      return true;
    } catch (error) {
      console.error('[DEBUG] Failed to load core modules:', error);
      return false;
    }
  };
  
  // Legacy security module loading for backward compatibility
  let security = null;
  try {
    if (window.qwenSecurity) {
      security = window.qwenSecurity;
    } else {
      // Import security module
      const securityScript = document.createElement('script');
      securityScript.src = chrome.runtime.getURL('core/security.js');
      document.head.appendChild(securityScript);
    }
  } catch (e) {
    console.warn('Failed to load security module:', e);
    // Fallback minimal security
    security = {
      sanitizeTranslationText: (text) => typeof text === 'string' ? text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') : text,
      logSecurityEvent: (event, details) => console.warn('[Security]', event, details)
    };
  }

  // Legacy error handler module loading for backward compatibility
  let errorHandler = null;
  try {
    if (window.qwenErrorHandler) {
      errorHandler = window.qwenErrorHandler;
    } else {
      // Import error handler module
      const errorHandlerScript = document.createElement('script');
      errorHandlerScript.src = chrome.runtime.getURL('core/error-handler.js');
      document.head.appendChild(errorHandlerScript);
    }
  } catch (e) {
    console.warn('Failed to load error handler module:', e);
    // Fallback minimal error handler
    errorHandler = {
      handle: (error, context = {}, customFallback) => {
        console.error('Error:', error?.message || error);
        return customFallback || null;
      },
      safe: (fn, context = {}, customFallback) => {
        return function(...args) {
          try {
            const result = fn.apply(this, args);
            if (result && typeof result.catch === 'function') {
              return result.catch(error => {
                console.error('Async error:', error?.message || error);
                return customFallback || null;
              });
            }
            return result;
          } catch (error) {
            console.error('Sync error:', error?.message || error);
            return customFallback || null;
          }
        };
      },
      isNetworkError: (error) => {
        const message = error?.message || '';
        return /fetch|network|connection|timeout|cors|offline/i.test(message);
      }
    };
  }
  // Modern modular coordinator
  let coordinator = null;
  let currentConfig = null;
  
  // Legacy support variables for backward compatibility
  let observers = [];
  const batchQueue = [];
  let processing = false;
  let statusTimer;
  const pending = new Set();
  let flushTimer;
  const controllers = new Set();
  let progress = { total: 0, done: 0 };
  let started = false;
  let progressHud;
  let selectionBubble;
  let selectionPinned = false;
  const i18nReady = window.qwenI18n && window.qwenI18n.ready ? window.qwenI18n.ready : Promise.resolve();
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let pageRecognizer;
  let prefetchObserver;
  const visibilityMap = new Map();
  const { isOfflineError } = (typeof require === 'function' ? require('./lib/offline.js') : window);
  
  // Legacy DOM optimizer for backward compatibility
  let domOptimizer = null;
  
  // Flexible logger: prefer injected qwenLogger when available
  const baseLogger = (typeof window !== 'undefined' && window.qwenLogger && typeof window.qwenLogger.create === 'function')
    ? window.qwenLogger.create('content')
    : null;

  const logger = {
    debug: (...args) => (baseLogger && baseLogger.debug ? baseLogger.debug(...args) : console.debug('[Qwen]', ...args)),
    info: (...args) => (baseLogger && baseLogger.info ? baseLogger.info(...args) : console.info('[Qwen]', ...args)),
    warn: (...args) => (baseLogger && baseLogger.warn ? baseLogger.warn(...args) : console.warn('[Qwen]', ...args)),
    error: (...args) => (baseLogger && baseLogger.error ? baseLogger.error(...args) : console.error('[Qwen]', ...args)),
    logQueueLatency: false, // Legacy property
  };
  
  // Legacy loadDOMOptimizer function for backward compatibility
  async function loadDOMOptimizer() {
    if (domOptimizer) return domOptimizer;
    
    // Simple fallback DOM optimizer
    domOptimizer = {
      replaceText: (node, text, preserveWhitespace = false) => {
        if (node && typeof text === 'string') {
          node.textContent = text;
        }
      },
      batchReplace: (replacements) => {
        replacements.forEach(({ node, newText }) => {
          if (node && typeof newText === 'string') {
            node.textContent = newText;
          }
        });
      }
    };
    
    return domOptimizer;
  }

  function cleanupControllers() {
    controllers.forEach(c => {
      try { c.abort(); } catch {}
    });
    controllers.clear();
  }

  function onBeforeUnload() {
    cleanupControllers();
    window.removeEventListener('beforeunload', onBeforeUnload);
  }
  window.addEventListener('beforeunload', onBeforeUnload);

function handleLastError(cb) {
  return (...args) => {
    const err = chrome.runtime.lastError;
    // Only log meaningful errors, not routine communication cleanup
    if (err && !err.message.includes('Receiving end does not exist')) {
      console.warn('[CONTENT-SCRIPT]', 'Runtime error:', err.message);
    }
    if (typeof cb === 'function') cb(...args);
  };
}

function safeSendMessage(msg, cb) {
  try {
    chrome.runtime.sendMessage(msg, handleLastError(cb));
  } catch (err) {
    // Only log meaningful errors, not routine context cleanup
    if (err && !err.message.includes('Extension context invalidated')) {
      console.warn('[CONTENT-SCRIPT]', 'Message send error:', err.message);
    }
  }
}

function ensureThemeCss(style) {
  const theme = style || 'apple';
  try {
    document.querySelectorAll('link[data-qwen-theme]').forEach(l => {
      if (l.dataset.qwenTheme !== theme) l.remove();
    });
    if (!document.querySelector(`link[data-qwen-theme="${theme}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL(`styles/${theme}.css`);
      link.dataset.qwenTheme = theme;
      (document.head || document.documentElement).appendChild(link);
    }
    // Ensure content script CSS is loaded for modern UI components
    if (!document.querySelector('link[data-qwen-content-css]')) {
      const contentLink = document.createElement('link');
      contentLink.rel = 'stylesheet';
      contentLink.href = chrome.runtime.getURL('styles/contentScript.css');
      contentLink.dataset.qwenContentCss = 'true';
      (document.head || document.documentElement).appendChild(contentLink);
    }
    // Apply theme styling only to extension elements to avoid overriding page styles
    // The status HUD will carry the data-qwen-theme attribute instead of the document root
  } catch {}
}

function replacePdfEmbeds() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  const viewerBase = chrome.runtime.getURL('pdfViewer.html');
  document
    .querySelectorAll(
      'embed[type="application/pdf"],embed[src$=".pdf"],iframe[src$=".pdf"]'
    )
    .forEach(el => {
      const url = el.src;
      if (!url || url.startsWith('about:') || url.startsWith('chrome')) return;
      const iframe = document.createElement('iframe');
      iframe.src = viewerBase + '?file=' + encodeURIComponent(url);
      iframe.style.width = el.style.width || el.getAttribute('width') || '100%';
      iframe.style.height = el.style.height || el.getAttribute('height') || '600px';
      el.replaceWith(iframe);
    });
}
replacePdfEmbeds();

const storageHelpers = (typeof require === 'function' ? require('./lib/storage') : window.qwenStorageHelpers);

async function loadGlossary() {
  if (!window.qwenGlossary) return;

  if (storageHelpers && typeof storageHelpers.createStorage === 'function' && self.qwenAsyncChrome) {
    try {
      const storage = storageHelpers.createStorage(self.qwenAsyncChrome);
      const data = await storage.get('sync', { glossary: {}, tone: 'formal' });
      window.qwenGlossary.parse(document, data.glossary || {});
      if (window.qwenGlossary.setTone) window.qwenGlossary.setTone(data.tone || 'formal');
      return;
    } catch {}
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    await new Promise(resolve => {
      chrome.storage.sync.get({ glossary: {}, tone: 'formal' }, data => {
        try {
          window.qwenGlossary.parse(document, data.glossary || {});
          if (window.qwenGlossary.setTone) window.qwenGlossary.setTone(data.tone || 'formal');
        } catch {}
        resolve();
      });
    });
  }
}

function setStatus(message, isError = false) {
  let el = document.getElementById('qwen-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'qwen-status';
    el.className = 'qwen-hud qwen-hud--status';
    // Scope theme to the HUD so page styles remain untouched
    el.setAttribute('data-qwen-theme', (currentConfig && currentConfig.themeStyle) || 'apple');
    el.setAttribute('data-qwen-color', (currentConfig && currentConfig.theme) || 'dark');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // Create DOM elements securely instead of using innerHTML
    const dot = document.createElement('span');
    dot.className = 'qwen-hud__dot';
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'qwen-hud__text';
    el.appendChild(dot);
    el.appendChild(text);
    document.body.appendChild(el);
  }
  el.dataset.variant = isError ? 'error' : '';
  const textNode = el.querySelector('.qwen-hud__text') || el;
  textNode.textContent = `TRANSLATE! by Mikko: ${message}`;
  safeSendMessage({ action: 'popup-status', text: message, error: isError });
  if (statusTimer) clearTimeout(statusTimer);
  if (isError) statusTimer = setTimeout(clearStatus, 5000);
}

function clearStatus() {
  const el = document.getElementById('qwen-status');
  if (el) el.remove();
}

function updateProgressHud() {
  if (!progress.total) return;
  if (!progressHud) {
    progressHud = document.createElement('div');
    progressHud.id = 'qwen-progress';
    progressHud.className = 'qwen-hud qwen-hud--progress';
    progressHud.setAttribute('data-qwen-theme', (currentConfig && currentConfig.themeStyle) || 'apple');
    progressHud.setAttribute('data-qwen-color', (currentConfig && currentConfig.theme) || 'dark');
    // Create DOM elements securely instead of using innerHTML
    const text = document.createElement('span');
    text.className = 'qwen-hud__text';
    progressHud.appendChild(text);
    progressHud.style.bottom = '40px';
    document.body.appendChild(progressHud);
  }
  const textNode = progressHud.querySelector('.qwen-hud__text') || progressHud;
  textNode.textContent = `${progress.done}/${progress.total}`;
  
  // Update top progress bar
  updateTopProgressBar();
  
  if (progress.done >= progress.total) {
    setTimeout(() => {
      if (progressHud) {
        progressHud.style.opacity = '0';
        setTimeout(() => {
          if (progressHud) {
            progressHud.remove();
            progressHud = null;
          }
        }, 300);
      }
      hideTopProgressBar();
    }, 1000);
  }
}

function updateTopProgressBar() {
  let topProgressBar = document.getElementById('qwen-top-progress');
  if (!topProgressBar) {
    topProgressBar = document.createElement('div');
    topProgressBar.id = 'qwen-top-progress';
    topProgressBar.className = 'qwen-progress-bar';
    topProgressBar.setAttribute('data-qwen-color', (currentConfig && currentConfig.theme) || 'dark');
    // Create DOM elements securely instead of using innerHTML
    const fill = document.createElement('div');
    fill.className = 'qwen-progress-bar__fill';
    topProgressBar.appendChild(fill);
    document.body.appendChild(topProgressBar);
  }
  
  const fill = topProgressBar.querySelector('.qwen-progress-bar__fill');
  const percentage = progress.total ? (progress.done / progress.total) * 100 : 0;
  fill.style.width = `${Math.min(percentage, 100)}%`;
}

function hideTopProgressBar() {
  const topProgressBar = document.getElementById('qwen-top-progress');
  if (topProgressBar) {
    topProgressBar.style.opacity = '0';
    setTimeout(() => {
      if (topProgressBar) topProgressBar.remove();
    }, 300);
  }
}

function showError(message) {
  setStatus(message, true);
}

function setupPrefetchObserver() {
  if (prefetchObserver !== undefined) return;
  if (typeof IntersectionObserver === 'undefined') {
    prefetchObserver = null;
    return;
  }
  prefetchObserver = new IntersectionObserver(entries => {
    const toTranslate = [];
    entries.forEach(e => {
      if (e.isIntersecting) {
        const nodes = visibilityMap.get(e.target);
        if (nodes) {
          visibilityMap.delete(e.target);
          prefetchObserver.unobserve(e.target);
          nodes.forEach(n => toTranslate.push(n));
        }
      }
    });
    if (toTranslate.length) batchNodes(toTranslate);
  }, { rootMargin: '200px' });
}

function prefetchNodes(nodes) {
  setupPrefetchObserver();
  if (!prefetchObserver) { batchNodes(nodes); return; }
  const immediate = [];
  nodes.forEach(n => {
    const el = n.parentElement;
    if (!el) { immediate.push(n); return; }
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      let list = visibilityMap.get(el);
      if (!list) {
        list = [];
        visibilityMap.set(el, list);
        prefetchObserver.observe(el);
      }
      list.push(n);
    } else {
      immediate.push(n);
    }
  });
  if (immediate.length) batchNodes(immediate);
}


chrome.runtime.onMessage.addListener(msg => {
  if (!msg) return;
  if (msg.action === 'speak-text') {
    if (typeof msg.text === 'string') {
      try {
        const u = new SpeechSynthesisUtterance(msg.text);
        setStatus('Speaking...');
        u.onend = () => clearStatus();
        speechSynthesis.speak(u);
      } catch {}
    }
  } else if (msg.action === 'start-recording') {
    if (!SpeechRecognition) return;
    if (pageRecognizer) {
      try { pageRecognizer.stop(); } catch {}
    }
    pageRecognizer = new SpeechRecognition();
    pageRecognizer.interimResults = true;
    setStatus('Recording...');
    pageRecognizer.onresult = e => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) safeSendMessage({ action: 'voice-interim', text: interim });
      if (final) safeSendMessage({ action: 'voice-final', text: final });
    };
    pageRecognizer.onend = () => {
      clearStatus();
      pageRecognizer = null;
      safeSendMessage({ action: 'voice-end' });
    };
    try { pageRecognizer.start(); } catch {}
  } else if (msg.action === 'stop-recording') {
    if (pageRecognizer) {
      try { pageRecognizer.stop(); } catch {}
      pageRecognizer = null;
      clearStatus();
    }
  } else if (msg.action === 'update-theme') {
    currentConfig = currentConfig || {};
    if (msg.theme) {
      currentConfig.theme = msg.theme;
      document.querySelectorAll('[data-qwen-color]').forEach(el => {
        el.setAttribute('data-qwen-color', msg.theme);
      });
    }
    if (msg.themeStyle) {
      currentConfig.themeStyle = msg.themeStyle;
      ensureThemeCss(msg.themeStyle);
      document.querySelectorAll('[data-qwen-theme]').forEach(el => {
        el.setAttribute('data-qwen-theme', msg.themeStyle);
      });
    }
  }
});
function mark(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.__qwenTranslated = true;
    // Add fade-in animation to parent element
    if (node.parentElement) {
      node.parentElement.dataset.qwenTranslated = 'true';
      // Remove highlight class after animation
      setTimeout(() => {
        if (node.parentElement) {
          node.parentElement.dataset.qwenHighlighted = 'true';
        }
      }, 2000);
    }
  } else if (node.dataset) {
    node.dataset.qwenTranslated = 'true';
    // Remove highlight class after animation
    setTimeout(() => {
      if (node.dataset) {
        node.dataset.qwenHighlighted = 'true';
      }
    }, 2000);
  }
}

function markUntranslatable(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.__qwenUntranslatable = true;
  } else if (node.dataset) {
    node.dataset.qwenUntranslatable = 'true';
  }
}

function scoreConfidence(src, translated) {
  const s = String(src || '');
  const t = String(translated || '');
  if (!s || !t) return 0;
  const ratio = Math.min(s.length, t.length) / Math.max(s.length, t.length);
  return Math.round(ratio * 100) / 100;
}

function addFeedbackUI(el, original, translated, confidence) {
  if (!currentConfig || !currentConfig.showFeedback) return;
  
  try {
    const wrap = document.createElement('span');
    wrap.className = 'qwen-feedback';
    wrap.setAttribute('data-qwen-theme', (currentConfig && currentConfig.themeStyle) || 'apple');
    wrap.setAttribute('data-qwen-color', (currentConfig && currentConfig.theme) || 'dark');
    
    const good = document.createElement('button');
    good.textContent = '👍';
    good.title = `Good translation (${Math.round((confidence || 0) * 100)}% confidence)`;
    
    const bad = document.createElement('button');
    bad.textContent = '👎';
    bad.title = 'Translation needs improvement';
    
    good.addEventListener('click', () => {
      try { 
        window.qwenFeedback && window.qwenFeedback.save({ original, translated, rating: 'good', confidence });
        good.textContent = '✓';
        good.style.color = 'var(--color-success-600)';
        setTimeout(() => wrap.remove(), 1500);
      } catch {}
    });
    
    bad.addEventListener('click', () => {
      try { 
        window.qwenFeedback && window.qwenFeedback.save({ original, translated, rating: 'needs-fix', confidence });
        bad.textContent = '✗';
        bad.style.color = 'var(--color-error-600)';
        setTimeout(() => wrap.remove(), 1500);
      } catch {}
    });
    
    wrap.appendChild(good);
    wrap.appendChild(bad);
    
    // Add with a slight delay for better UX
    setTimeout(() => {
      el.insertAdjacentElement('afterend', wrap);
    }, 500);
    
    // Auto-remove after 10 seconds if no interaction
    setTimeout(() => {
      if (wrap.parentNode) wrap.remove();
    }, 10000);
  } catch {}
}

function removeSelectionBubble() {
  if (selectionBubble && !selectionPinned) {
    selectionBubble.remove();
    selectionBubble = null;
  }
}

async function showSelectionBubble(range, text) {
  removeSelectionBubble();
  selectionPinned = false;
  await i18nReady;
  const t = window.qwenI18n ? window.qwenI18n.t.bind(window.qwenI18n) : k => k;
  selectionBubble = document.createElement('div');
  selectionBubble.className = 'qwen-bubble';
  selectionBubble.setAttribute('data-qwen-theme', (currentConfig && currentConfig.themeStyle) || 'apple');
  selectionBubble.setAttribute('data-qwen-color', (currentConfig && currentConfig.theme) || 'dark');
  selectionBubble.setAttribute('tabindex', '-1');
  selectionBubble.setAttribute('role', 'dialog');
  selectionBubble.setAttribute('aria-label', t('bubble.ariaLabel') || 'Translation bubble');
  
  const result = document.createElement('div');
  result.className = 'qwen-bubble__result';
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  result.textContent = 'Select an action below';
  selectionBubble.appendChild(result);
  
  const actions = document.createElement('div');
  actions.className = 'qwen-bubble__actions';
  
  const translateBtn = document.createElement('button');
  translateBtn.textContent = '🌐 Translate';
  translateBtn.setAttribute('aria-label', t('bubble.translate') || 'Translate text');
  
  const pinBtn = document.createElement('button');
  pinBtn.textContent = '📌 Pin';
  pinBtn.setAttribute('aria-label', t('bubble.pin') || 'Pin bubble');
  
  const copyBtn = document.createElement('button');
  copyBtn.textContent = '📋 Copy';
  copyBtn.setAttribute('aria-label', t('bubble.copy') || 'Copy translation');
  copyBtn.style.display = 'none'; // Hide until translation is available
  
  actions.append(translateBtn, pinBtn, copyBtn);
  selectionBubble.appendChild(actions);
  
  let currentTranslation = '';
  
  translateBtn.addEventListener('click', async () => {
    // Create DOM elements securely instead of using innerHTML
    result.textContent = ''; // Clear existing content
    const skeleton = document.createElement('span');
    skeleton.className = 'qwen-loading-skeleton';
    const loadingText = document.createTextNode(' Translating...');
    result.appendChild(skeleton);
    result.appendChild(loadingText);
    translateBtn.disabled = true;
    selectionBubble.classList.remove('qwen-bubble--error');
    
    const cfg = currentConfig || (await window.qwenLoadConfig());
    await loadGlossary();
    
    try {
      const res = await window.qwenTranslate({
        endpoint: cfg.apiEndpoint,
        model: cfg.model,
        text,
        source: cfg.sourceLanguage,
        target: cfg.targetLanguage,
        providerOrder: cfg.providerOrder,
        endpoints: cfg.endpoints,
        detector: cfg.detector,
        failover: cfg.failover,
        debug: cfg.debug,
      });
      
      currentTranslation = res.text;
      result.textContent = currentTranslation;
      copyBtn.style.display = 'block';
      
      // Add confidence indicator if available
      if (res.confidence) {
        const confidence = document.createElement('span');
        confidence.className = 'qwen-confidence-indicator';
        confidence.textContent = ` (${Math.round(res.confidence * 100)}%)`;
        confidence.style.opacity = '0.7';
        confidence.style.fontSize = '0.85em';
        result.appendChild(confidence);
      }
      
    } catch (e) {
      const offline = isOfflineError(e);
      selectionBubble.classList.add('qwen-bubble--error');
      
      if (offline) {
        result.textContent = t('bubble.offline') || 'Offline - check connection';
        safeSendMessage({ action: 'translation-status', status: { offline: true } });
      } else {
        result.textContent = `${t('bubble.error') || 'Error'}${e && e.message ? `: ${e.message}` : ''}`;
      }
    } finally {
      translateBtn.disabled = false;
    }
  });
  
  pinBtn.addEventListener('click', () => {
    selectionPinned = !selectionPinned;
    pinBtn.classList.toggle('active', selectionPinned);
    pinBtn.textContent = selectionPinned ? '📍 Pinned' : '📌 Pin';
  });
  
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentTranslation || result.textContent || '');
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1500);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  });
  
  // Position bubble with smart placement
  const rect = range.getBoundingClientRect ? range.getBoundingClientRect() : { top: 0, left: 0, bottom: 0, right: 0 };
  const bubbleHeight = 120; // Approximate bubble height
  const bubbleWidth = 280; // Approximate bubble width
  
  let top = window.scrollY + rect.bottom + 10;
  let left = window.scrollX + rect.left;
  
  // Adjust if bubble would go off-screen
  if (left + bubbleWidth > window.innerWidth) {
    left = window.innerWidth - bubbleWidth - 20;
  }
  if (left < 10) {
    left = 10;
  }
  
  // Place above selection if no room below
  if (top + bubbleHeight > window.innerHeight + window.scrollY) {
    top = window.scrollY + rect.top - bubbleHeight - 10;
  }
  
  selectionBubble.style.top = `${top}px`;
  selectionBubble.style.left = `${left}px`;
  document.body.appendChild(selectionBubble);
  selectionBubble.focus();
}

function handleSelection() {
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel && sel.toString().trim();
    if (text) {
      try { showSelectionBubble(sel.getRangeAt(0), text); } catch {}
    } else {
      removeSelectionBubble();
    }
  }, 0);
}

function isMarked(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.__qwenTranslated || node.__qwenUntranslatable;
  }
  return (
    node.dataset &&
    (node.dataset.qwenTranslated === 'true' || node.dataset.qwenUntranslatable === 'true')
  );
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

function isVisible(el) {
  if (!el) return false;
  if (el.closest('[hidden],[aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (!el.getClientRects().length) return false;
  return true;
}

function shouldTranslate(node) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el) return false;
  if (el.tagName === 'SUP' || el.closest('sup')) return false;
  return !isMarked(node) && !SKIP_TAGS.has(el.tagName) && isVisible(el);
}

async function translateNode(node) {
  // Ensure DOM optimizer is loaded
  if (!domOptimizer) {
    domOptimizer = await loadDOMOptimizer();
  }
  const original = node.textContent || '';
  const leading = original.match(/^\s*/)[0];
  const trailing = original.match(/\s*$/)[0];
  const text = original.trim();
  if (!text) return;
  try {
    logger.info('translating node', text.slice(0, 50));
    if (currentConfig.debug) logger.debug('QTDEBUG: translating node', text.slice(0, 20));
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      (currentConfig && currentConfig.translateTimeoutMs) || window.qwenTranslateTimeoutMs || 20000
    );
    const { text: translated } = await window.qwenTranslate({
      endpoint: currentConfig.apiEndpoint,
      model: currentConfig.model,
      text,
      source: currentConfig.sourceLanguage,
      target: currentConfig.targetLanguage,
      providerOrder: currentConfig.providerOrder,
      endpoints: currentConfig.endpoints,
      detector: currentConfig.detector,
      failover: currentConfig.failover,
      signal: controller.signal,
      debug: currentConfig.debug,
    });
    clearTimeout(timeout);
    logger.info('translated node', { original: text.slice(0, 50), translated: translated.slice(0, 50) });
    if (currentConfig.debug) {
      logger.debug('QTDEBUG: node translation result', { original: text.slice(0, 50), translated: translated.slice(0, 50) });
      if (translated.trim().toLowerCase() === text.trim().toLowerCase()) {
        logger.warn('QTWARN: text already in target language; check source and target settings');
      }
    }
    
    // Sanitize translated text before DOM insertion
    let safeTranslated = translated;
    if (security && security.sanitizeTranslationText) {
      safeTranslated = security.sanitizeTranslationText(translated);
      if (safeTranslated !== translated) {
        security.logSecurityEvent('Translation text sanitized', { 
          node: node.tagName || 'TEXT',
          issues: 'dangerous content removed'
        });
      }
    }
    
    // Use DOM optimizer for batched text replacement
    if (domOptimizer && domOptimizer.replaceText) {
      domOptimizer.replaceText(node, leading + safeTranslated + trailing, true);
    } else {
      node.textContent = leading + safeTranslated + trailing;
    }
    mark(node);
  } catch (e) {
    const fallbackError = errorHandler ? errorHandler.handle(e, {
      operation: 'node_translation',
      nodeType: node.tagName || 'TEXT',
      textLength: text?.length || 0
    }, null) : null;
    
    const t = window.qwenI18n ? window.qwenI18n.t.bind(window.qwenI18n) : k => k;
    const offline = errorHandler ? errorHandler.isNetworkError(e) : isOfflineError(e);
    if (offline) {
      showError(t('popup.offline'));
      safeSendMessage({ action: 'translation-status', status: { offline: true } });
    } else {
      showError(`${e.message}. See console for details.`);
    }
    logger.error('QTERROR: translation error', e);
  } finally {
    controllers.delete(controller);
  }
}

async function translateBatch(elements, stats, force = false) {
  // Ensure DOM optimizer is loaded
  if (!domOptimizer) {
    domOptimizer = await loadDOMOptimizer();
  }
  logger.info('starting batch translation', { count: elements.length });
  const batchStart = Date.now();
  const originals = elements.map(el => el.textContent || '');
  const texts = originals.map(t => t.trim());
  const controller = new AbortController();
  controllers.add(controller);
  const timeout = setTimeout(
    () => controller.abort(),
    (currentConfig && currentConfig.translateTimeoutMs) || window.qwenTranslateTimeoutMs || 20000
  );
  let res;
  try {
    const opts = {
      endpoint: currentConfig.apiEndpoint,
      model: currentConfig.model,
      texts,
      source: currentConfig.sourceLanguage,
      target: currentConfig.targetLanguage,
      providerOrder: currentConfig.providerOrder,
      endpoints: currentConfig.endpoints,
      detector: currentConfig.detector,
      failover: currentConfig.failover,
      parallel: currentConfig.parallel,
      signal: controller.signal,
      debug: currentConfig.debug,
    };
    if (force) opts.force = true;
    if (stats) {
      opts.onProgress = p => {
        safeSendMessage({ action: 'translation-status', status: { active: true, ...p, progress } });
      };
      opts._stats = stats;
    }
    res = await window.qwenTranslateBatch(opts);
  } finally {
    clearTimeout(timeout);
    controllers.delete(controller);
  }
  // Prepare batch replacements for DOM optimizer
  const batchReplacements = [];
  const elementsToMark = [];
  const feedbackElements = [];
  
  res.texts.forEach((t, i) => {
    const el = elements[i];
    const orig = originals[i];
    const leading = orig.match(/^\s*/)[0];
    const trailing = orig.match(/\s*$/)[0];
    if (currentConfig.debug) {
      logger.debug('QTDEBUG: node translation result', { original: texts[i].slice(0, 50), translated: t.slice(0, 50) });
    }
    if (t.trim().toLowerCase() === texts[i].trim().toLowerCase()) {
      markUntranslatable(el);
      if (currentConfig.debug) {
        logger.warn('QTWARN: text already in target language; marking as untranslatable');
      }
    } else {
      // Queue for batch replacement
      batchReplacements.push({
        node: el,
        newText: leading + t + trailing,
        preserveWhitespace: true
      });
      elementsToMark.push(el);
      feedbackElements.push({ el, original: texts[i], translated: t, confidence: scoreConfidence(texts[i], t) });
    }
  });
  
  // Execute batch DOM replacements
  if (domOptimizer && domOptimizer.batchReplace && batchReplacements.length > 0) {
    domOptimizer.batchReplace(batchReplacements);
  } else {
    // Fallback to individual replacements
    batchReplacements.forEach(({ node, newText }) => {
      node.textContent = newText;
    });
  }
  
  // Mark elements and add feedback UI after DOM operations
  elementsToMark.forEach(el => mark(el));
  feedbackElements.forEach(({ el, original, translated, confidence }) => {
    addFeedbackUI(el, original, translated, confidence);
  });
  const batchTime = Date.now() - batchStart;
  logger.info('finished batch translation', { count: elements.length });
  if (logger.logBatchTime) logger.logBatchTime(batchTime);
  progress.done += elements.length;
  updateProgressHud();
  const elapsedMs = stats ? Date.now() - stats.start : 0;
  const avg = progress.done ? elapsedMs / progress.done : 0;
  const etaMs = avg * (progress.total - progress.done);
  safeSendMessage({
    action: 'translation-status',
    status: {
      active: true,
      phase: 'translate',
      request: stats ? stats.requests : 0,
      requests: stats ? stats.totalRequests : 0,
      sample: texts[0],
      elapsedMs,
      etaMs,
      progress,
    },
  });
}

function enqueueBatch(batch) {
  batchQueue.push({ nodes: batch, enqueued: Date.now() });
  progress.total += batch.length;
  updateProgressHud();
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  setStatus('Translating...');
  const stats = { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0 };
  safeSendMessage({ action: 'translation-status', status: { active: true, phase: 'translate', progress } });
  while (batchQueue.length) {
    setStatus(`Translating (${batchQueue.length} left)...`);
    const item = batchQueue.shift();
    if (logger.logQueueLatency) logger.logQueueLatency(Date.now() - item.enqueued);
    try {
      await translateBatch(item.nodes, stats);
    } catch (e) {
      const t = window.qwenI18n ? window.qwenI18n.t.bind(window.qwenI18n) : k => k;
      const offline = isOfflineError(e);
      if (offline) {
        showError(t('popup.offline'));
        safeSendMessage({ action: 'translation-status', status: { offline: true } });
      } else {
        showError(`${e.message}. See console for details.`);
      }
      logger.error('QTERROR: batch translation error', e && e.message, e);
      item.enqueued = Date.now();
      batchQueue.push(item);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  stats.elapsedMs = Date.now() - stats.start;
  stats.wordsPerSecond = stats.words / (stats.elapsedMs / 1000 || 1);
  stats.wordsPerRequest = stats.words / (stats.requests || 1);
  stats.tokensPerRequest = stats.tokens / (stats.requests || 1);
  stats.cache = {
    size: (window.qwenGetCacheSize && window.qwenGetCacheSize()) || 0,
    max: (window.qwenConfig && window.qwenConfig.memCacheMax) || 0,
    ...(window.qwenGetCacheStats ? window.qwenGetCacheStats() : {}),
  };
  stats.tm = window.qwenTM && window.qwenTM.stats ? window.qwenTM.stats() : {};
  safeSendMessage({ action: 'translation-status', status: { active: false, summary: stats } });
  processing = false;
  clearStatus();
}

function batchNodes(nodes) {
  // Dynamic token budget based on config or performance
  const dynamicTokenBudget = (currentConfig && currentConfig.tokenBudget) || 
                             (window.qwenTranslateBatch && window.qwenTranslateBatch._getTokenBudget) ?
                             window.qwenTranslateBatch._getTokenBudget() : 6000;
  
  const maxTokens = Math.min(dynamicTokenBudget, 12000); // Cap at 12K for safety
  const batches = [];
  let current = [];
  let tokens = 0;
  const approx = window.qwenThrottle ? window.qwenThrottle.approxTokens : t => Math.ceil(t.length / 4);
  const textMap = new Map(); // Use Map for better deduplication performance
  
  // Pre-process text extraction and deduplication
  const processedNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const text = el.textContent.trim();
    
    if (!text) continue; // Skip empty nodes
    
    let tokCount;
    if (textMap.has(text)) {
      tokCount = 0; // No token cost for duplicates
    } else {
      tokCount = approx(text);
      textMap.set(text, tokCount);
    }
    
    processedNodes.push({ el, text, tokens: tokCount });
  }
  
  // Efficient batching with look-ahead optimization
  for (let i = 0; i < processedNodes.length; i++) {
    const { el, tokens: nodeTokens } = processedNodes[i];
    
    // Check if adding this node would exceed limit
    if (current.length && tokens + nodeTokens > maxTokens) {
      // Look ahead to see if we can optimize batch size
      if (current.length < 10 && i < processedNodes.length - 1) {
        const nextNodeTokens = processedNodes[i + 1].tokens;
        if (tokens + nodeTokens + nextNodeTokens <= maxTokens * 1.1) {
          // Allow slight overage if it creates better batch sizes
          current.push(el);
          tokens += nodeTokens;
          continue;
        }
      }
      
      batches.push(current);
      current = [el];
      tokens = nodeTokens;
    } else {
      current.push(el);
      tokens += nodeTokens;
    }
  }
  
  if (current.length > 0) batches.push(current);
  
  // Enqueue batches with performance timing
  batches.forEach(b => enqueueBatch(b));
}

function collectNodes(root, out) {
  // Pre-allocate array to avoid dynamic resizing and use iterative approach
  const textNodes = [];
  const stack = [root];
  const seen = new Set();
  
  // Iterative traversal to avoid recursion overhead and stack depth issues
  while (stack.length > 0) {
    const current = stack.pop();
    
    // Skip if already processed (prevents infinite loops in shadow DOM)
    if (seen.has(current)) continue;
    seen.add(current);
    
    // Direct text node collection without TreeWalker overhead
    if (current.nodeType === Node.TEXT_NODE) {
      const text = current.textContent;
      if (text && text.trim() && shouldTranslate(current)) {
        textNodes.push(current);
      }
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      // Add child nodes to stack in reverse order for correct traversal
      const children = current.childNodes;
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
      
      // Handle shadow DOM efficiently
      if (current.shadowRoot) {
        stack.push(current.shadowRoot);
      }
    }
  }
  
  // Batch add to output array to minimize array operations
  if (textNodes.length > 0) {
    out.push(...textNodes);
  }
  
  // Handle iframe/embed content separately for security and performance
  if (root.querySelectorAll) {
    const embeddedElements = root.querySelectorAll('iframe,object,embed');
    for (let i = 0; i < embeddedElements.length; i++) {
      const el = embeddedElements[i];
      try {
        const doc = el.contentDocument || el.getSVGDocument?.();
        if (doc && !seen.has(doc)) {
          collectNodes(doc, out);
        }
      } catch {}
    }
  }
}

function flushPending() {
  const nodes = [];
  pending.forEach(n => collectNodes(n, nodes));
  pending.clear();
  flushTimer = null;
  if (nodes.length) prefetchNodes(nodes);
}

function scheduleScan(node) {
  if (!node) return;
  pending.add(node);
  if (!flushTimer) flushTimer = setTimeout(flushPending, 50);
}

function scan(root = document.body) {
  const nodes = [];
  collectNodes(root, nodes);
  if (nodes.length) prefetchNodes(nodes);
}

function observe(root = document.body) {
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(n => {
        if (n.nodeType === Node.ELEMENT_NODE) {
          scheduleScan(n);
        }
        if (n.shadowRoot) observe(n.shadowRoot);
      });
    }
  });
  obs.observe(root, { childList: true, subtree: true });
  observers.push(obs);
  if (root.querySelectorAll) {
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) observe(el.shadowRoot);
    });
  }
}

function stop() {
  observers.forEach(o => { try { o.disconnect(); } catch {} });
  observers = [];
  batchQueue.length = 0;
  pending.clear();
  if (prefetchObserver) { try { prefetchObserver.disconnect(); } catch {} prefetchObserver = null; }
  visibilityMap.clear();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  cleanupControllers();
  processing = false;
  started = false;
  progress = { total: 0, done: 0 };
  if (progressHud) { progressHud.remove(); progressHud = null; }
  clearStatus();
  safeSendMessage({ action: 'translation-status', status: { active: false } });
}

async function start() {
  if (started) return;
  started = true;
  currentConfig = await window.qwenLoadConfig();
  ensureThemeCss(currentConfig && currentConfig.themeStyle);
  await loadGlossary();
  progress = { total: 0, done: 0 };
  if (window.qwenSetTokenBudget) {
    window.qwenSetTokenBudget(currentConfig.tokenBudget || 0);
  }
  if (currentConfig.debug) logger.debug('QTDEBUG: starting automatic translation');
  setStatus('Scanning page...');
  scanDocument();
}

async function scanDocument() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const chunk = [];
  const chunkSize = 200;
  let node;
  let processed = 0;
  
  while (started && (node = walker.nextNode())) {
    if (node.textContent.trim() && shouldTranslate(node)) {
      chunk.push(node);
      if (chunk.length >= chunkSize) {
        prefetchNodes(chunk.splice(0));
      }
    }
    processed++;
    
    // Use requestIdleCallback for better performance when available
    if (processed % 200 === 0) { // Reduced from 500 to 200 for more responsive yielding
      await new Promise(resolve => {
        if (window.requestIdleCallback) {
          requestIdleCallback(resolve, { timeout: 16 }); // 16ms timeout for 60fps
        } else {
          setTimeout(resolve, 0);
        }
      });
      if (!started) return;
    }
  }
  
  if (started && chunk.length) prefetchNodes(chunk);
  if (!started) return;
  observe();
  if (!batchQueue.length) clearStatus();
}

if (!skipInit) {
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'start') {
    if (currentConfig && currentConfig.debug) logger.debug('QTDEBUG: start message received');
    if (msg.force) {
      const nodes = [];
      collectNodes(document.body, nodes);
      if (nodes.length) translateBatch(nodes, undefined, true);
    } else {
      start();
    }
  }
  if (msg.action === 'stop') {
    stop();
  }
  if (msg.action === 'test-read') {
    sendResponse({ title: document.title });
  }
  if (msg.action === 'test-e2e') {
    const cfg = msg.cfg || {};
    const original = msg.original || 'Hello world';
    const el = document.createElement('span');
    el.id = 'qwen-test-element';
    if (domOptimizer && domOptimizer.replaceText) {
      domOptimizer.replaceText(el, original, true);
    } else {
      el.textContent = original;
    }
    document.body.appendChild(el);
    if (cfg.debug) logger.debug('QTDEBUG: test-e2e request received');
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      cfg.translateTimeoutMs || (currentConfig && currentConfig.translateTimeoutMs) || window.qwenTranslateTimeoutMs || 20000
    );
    window
      .qwenTranslate({
        endpoint: cfg.endpoint,
        model: cfg.model,
        text: original,
        source: cfg.source,
        target: cfg.target,
        debug: cfg.debug,
        stream: false,
        signal: controller.signal,
        providerOrder: cfg.providerOrder,
        endpoints: cfg.endpoints,
        detector: cfg.detector,
        failover: cfg.failover,
      })
      .then(res => {
        clearTimeout(timer);
        if (cfg.debug) logger.debug('QTDEBUG: test-e2e translation result', res);
        if (!res || typeof res.text !== 'string') {
          throw new Error('invalid response');
        }
        if (domOptimizer && domOptimizer.replaceText) {
          domOptimizer.replaceText(el, res.text, true);
        } else {
          el.textContent = res.text;
        }
        if (cfg.debug) logger.debug('QTDEBUG: test-e2e sending response');
        sendResponse({ text: res.text });
        setTimeout(() => el.remove(), 1000);
      })
      .catch(err => {
        clearTimeout(timer);
        if (cfg.debug) logger.debug('QTDEBUG: test-e2e sending error', err);
        el.remove();
        const offline = isOfflineError(err);
        if (offline) {
          safeSendMessage({ action: 'translation-status', status: { offline: true } });
        }
        sendResponse({ error: offline ? 'offline' : err.message, stack: err.stack });
      });
    return true;
  }
  if (msg.action === 'translate-selection') {
    (async () => {
      const sel = window.getSelection();
      const text = sel && sel.toString().trim();
      if (!text) return;
      const cfg = currentConfig || (await window.qwenLoadConfig());
      await loadGlossary();
      try {
        const res = await window.qwenTranslate({
          endpoint: cfg.apiEndpoint,
          model: cfg.model,
          text,
          source: cfg.sourceLanguage,
          target: cfg.targetLanguage,
          providerOrder: cfg.providerOrder,
          endpoints: cfg.endpoints,
          detector: cfg.detector,
          failover: cfg.failover,
          debug: cfg.debug,
        });
        const translated = res.text;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(translated);
        range.insertNode(node);
        mark(node);
        addFeedbackUI(node, text, translated, res.confidence);
        sel.removeAllRanges();
      } catch (e) {
        const t = window.qwenI18n ? window.qwenI18n.t.bind(window.qwenI18n) : k => k;
        const offline = isOfflineError(e);
        if (offline) {
          showError(t('popup.offline'));
          safeSendMessage({ action: 'translation-status', status: { offline: true } });
        } else {
          showError(`${t('bubble.error')}${e && e.message ? `: ${e.message}` : ''}`);
        }
      }
    })();
  }
});

  async function initConfig() {
    try {
      console.log('[DEBUG] initConfig() starting');
      
      // Load core modules first
      console.log('[DEBUG] Loading core modules...');
      const modulesLoaded = await loadCoreModules();
      console.log('[DEBUG] loadCoreModules result:', modulesLoaded);
      
      if (modulesLoaded) {
        // Initialize modern coordinator
        console.log('[DEBUG] Checking for coordinator class...');
        const CoordinatorClass = window.qwenContentScriptCoordinator || self.qwenContentScriptCoordinator;
        console.log('[DEBUG] CoordinatorClass found:', !!CoordinatorClass);
        if (CoordinatorClass) {
          coordinator = new CoordinatorClass();
          console.log('[DEBUG] Coordinator instantiated');
        }
      }
      
      // Load configuration
      console.log('[DEBUG] About to call qwenLoadConfig...');
      const cfg = await window.qwenLoadConfig();
      console.log('[DEBUG] qwenLoadConfig returned:', cfg);
      currentConfig = cfg;
      
      if (coordinator) {
        // Use modern coordinator
        await coordinator.initialize(cfg);
        
        // Set up message listener for coordinator
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (message.action === 'translate' && coordinator) {
            coordinator.startTranslation()
              .then(() => sendResponse({ success: true }))
              .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
          } else if (message.action === 'stop' && coordinator) {
            coordinator.stopTranslation();
            sendResponse({ success: true });
          } else if (message.action === 'getStats' && coordinator) {
            sendResponse(coordinator.getStats());
          }
        });
        
        // Handle auto-translation with visibility changes
        if (cfg.autoTranslate) {
          if (!document.hidden) {
            coordinator.startTranslation();
          } else {
            const onVisible = () => {
              if (!document.hidden) {
                document.removeEventListener('visibilitychange', onVisible);
                coordinator.startTranslation();
              }
            };
            document.addEventListener('visibilitychange', onVisible);
          }
        }
        
      } else {
        // Fallback to legacy implementation
        console.warn('Using legacy content script implementation');
        ensureThemeCss(cfg && cfg.themeStyle);
        
        if (cfg.selectionPopup) {
          document.addEventListener('mouseup', handleSelection);
          document.addEventListener('keyup', handleSelection);
          document.addEventListener('mousedown', e => {
            if (selectionBubble && !selectionBubble.contains(e.target) && !selectionPinned) removeSelectionBubble();
          });
          document.addEventListener('keydown', e => { if (e.key === 'Escape') removeSelectionBubble(); });
        }
        
        if (cfg.autoTranslate) {
          if (!document.hidden) {
            start();
          } else {
            const onVisible = () => {
              if (!document.hidden) {
                document.removeEventListener('visibilitychange', onVisible);
                start();
              }
            };
            document.addEventListener('visibilitychange', onVisible);
          }
        }
      }
    } catch (error) {
      console.error('[DEBUG] Failed to initialize content script:', error);
      console.log('[DEBUG] Falling back to legacy implementation');
      // Fallback to legacy implementation on error
      const cfg = await window.qwenLoadConfig();
      console.log('[DEBUG] Legacy qwenLoadConfig returned:', cfg);
      currentConfig = cfg;
      ensureThemeCss(cfg && cfg.themeStyle);
    }
  }

  // Global error handler to prevent crashes
  window.addEventListener('error', (event) => {
    if (event.filename && event.filename.includes('chrome-extension://')) {
      const error = new Error(event.message);
      error.filename = event.filename;
      error.lineno = event.lineno;
      error.colno = event.colno;
      
      if (errorHandler) {
        errorHandler.handle(error, {
          operation: 'content_script',
          filename: event.filename,
          location: `${event.lineno}:${event.colno}`
        });
      } else {
        console.error('Content script error:', {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      }
      
      // Log security event if available
      if (security && security.logSecurityEvent) {
        security.logSecurityEvent('Content script error', {
          message: event.message,
          location: `${event.filename}:${event.lineno}:${event.colno}`
        });
      }
      event.preventDefault(); // Prevent error from bubbling
    }
  });
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (coordinator) {
      coordinator.cleanup();
    }
    cleanupControllers();
  });

  console.log('[DEBUG] Document ready state:', document.readyState);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log('[DEBUG] Document ready, calling initConfig() immediately');
    initConfig();
  } else {
    console.log('[DEBUG] Document not ready, waiting for DOMContentLoaded');
    window.addEventListener('DOMContentLoaded', () => {
      console.log('[DEBUG] DOMContentLoaded fired, calling initConfig()');
      initConfig();
    });
  }
  if (typeof module !== 'undefined') {
    module.exports = {
      // Modern coordinator interface
      getCoordinator: () => coordinator,
      
      // Legacy interface for backward compatibility
      translateBatch: typeof translateBatch !== 'undefined' ? translateBatch : () => {},
      collectNodes: typeof collectNodes !== 'undefined' ? collectNodes : () => [],
      setCurrentConfig: cfg => {
        currentConfig = cfg;
        if (coordinator) {
          coordinator.updateConfiguration(cfg);
        }
      },
      __controllerCount: () => coordinator ? coordinator.getStats().activeRequests : controllers.size,
    };
    if (typeof window !== 'undefined') {
      window.__qwenCSModule = module.exports;
    }
  }
}
}
