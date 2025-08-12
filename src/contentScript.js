if (!location.href.startsWith(chrome.runtime.getURL('pdfViewer.html'))) {
let observers = [];
let currentConfig;
const batchQueue = [];
let processing = false;
let statusTimer;
const pending = new Set();
let flushTimer;

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

function setStatus(message, isError = false) {
  let el = document.getElementById('qwen-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'qwen-status';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      background: 'rgba(0,0,0,0.6)',
      color: '#fff',
      padding: '5px 10px',
      zIndex: 2147483647,
      fontSize: '12px',
    });
    document.body.appendChild(el);
  }
  el.style.background = isError ? 'rgba(255,0,0,0.8)' : 'rgba(0,0,0,0.6)';
  el.textContent = `Qwen Translator: ${message}`;
  try {
    chrome.runtime.sendMessage({ action: 'popup-status', text: message, error: isError });
  } catch {}
  if (statusTimer) clearTimeout(statusTimer);
  if (isError) statusTimer = setTimeout(clearStatus, 5000);
}

function clearStatus() {
  const el = document.getElementById('qwen-status');
  if (el) el.remove();
  try { chrome.runtime.sendMessage({ action: 'popup-clear-status' }); } catch {}
}

function showError(message) {
  setStatus(message, true);
}

function mark(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.__qwenTranslated = true;
  } else if (node.dataset) {
    node.dataset.qwenTranslated = 'true';
  }
}

function markUntranslatable(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.__qwenUntranslatable = true;
  } else if (node.dataset) {
    node.dataset.qwenUntranslatable = 'true';
  }
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
  return !isMarked(node) && !SKIP_TAGS.has(el.tagName) && isVisible(el);
}

async function translateNode(node) {
  const original = node.textContent || '';
  const leading = original.match(/^\s*/)[0];
  const trailing = original.match(/\s*$/)[0];
  const text = original.trim();
  if (!text) return;
  try {
    if (currentConfig.debug) console.log('QTDEBUG: translating node', text.slice(0, 20));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const { text: translated } = await window.qwenTranslate({
      endpoint: currentConfig.apiEndpoint,
      apiKey: currentConfig.apiKey,
      model: currentConfig.model,
      text,
      source: currentConfig.sourceLanguage,
      target: currentConfig.targetLanguage,
      signal: controller.signal,
      debug: currentConfig.debug,
    });
    clearTimeout(timeout);
    if (currentConfig.debug) {
      console.log('QTDEBUG: node translation result', { original: text.slice(0, 50), translated: translated.slice(0, 50) });
      if (translated.trim().toLowerCase() === text.trim().toLowerCase()) {
        console.warn('QTWARN: translated text is identical to source; check language configuration');
      }
    }
    node.textContent = leading + translated + trailing;
    mark(node);
  } catch (e) {
    showError(`${e.message}. See console for details.`);
    console.error('QTERROR: translation error', e);
  }
}

async function translateBatch(elements, stats) {
  const originals = elements.map(el => el.textContent || '');
  const texts = originals.map(t => t.trim());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    const opts = {
      endpoint: currentConfig.apiEndpoint,
      apiKey: currentConfig.apiKey,
      model: currentConfig.model,
      texts,
      source: currentConfig.sourceLanguage,
      target: currentConfig.targetLanguage,
      signal: controller.signal,
      debug: currentConfig.debug,
    };
    if (stats) {
      opts.onProgress = p => {
        chrome.runtime.sendMessage({ action: 'translation-status', status: { active: true, ...p } });
      };
      opts._stats = stats;
    }
    res = await window.qwenTranslateBatch(opts);
  } finally {
    clearTimeout(timeout);
  }
  res.texts.forEach((t, i) => {
    const el = elements[i];
    const orig = originals[i];
    const leading = orig.match(/^\s*/)[0];
    const trailing = orig.match(/\s*$/)[0];
    if (currentConfig.debug) {
      console.log('QTDEBUG: node translation result', { original: texts[i].slice(0, 50), translated: t.slice(0, 50) });
    }
    if (t.trim().toLowerCase() === texts[i].trim().toLowerCase()) {
      markUntranslatable(el);
      if (currentConfig.debug) {
        console.warn('QTWARN: translated text is identical to source; marking as untranslatable');
      }
    } else {
      el.textContent = leading + t + trailing;
      mark(el);
    }
  });
}

function enqueueBatch(batch) {
  batchQueue.push(batch);
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  setStatus('Translating...');
  const stats = { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0 };
  chrome.runtime.sendMessage({ action: 'translation-status', status: { active: true, phase: 'translate' } });
  while (batchQueue.length) {
    setStatus(`Translating (${batchQueue.length} left)...`);
    const batch = batchQueue.shift();
    try {
      await translateBatch(batch, stats);
    } catch (e) {
      showError(`${e.message}. See console for details.`);
      console.error('QTERROR: batch translation error', e);
      batchQueue.push(batch);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  stats.elapsedMs = Date.now() - stats.start;
  stats.wordsPerSecond = stats.words / (stats.elapsedMs / 1000 || 1);
  stats.wordsPerRequest = stats.words / (stats.requests || 1);
  stats.tokensPerRequest = stats.tokens / (stats.requests || 1);
  chrome.runtime.sendMessage({ action: 'translation-status', status: { active: false, summary: stats } });
  processing = false;
  clearStatus();
}

function batchNodes(nodes) {
  const maxTokens = 6000;
  const batches = [];
  let current = [];
  let tokens = 0;
  const approx = window.qwenThrottle ? window.qwenThrottle.approxTokens : t => Math.ceil(t.length / 4);
  const seen = new Set();
  nodes.forEach(el => {
    const text = el.textContent.trim();
    const tok = approx(text);
    const unique = !seen.has(text);
    if (current.length && tokens + (unique ? tok : 0) > maxTokens) {
      batches.push(current);
      current = [];
      tokens = 0;
      seen.clear();
    }
    current.push(el);
    if (unique) {
      tokens += tok;
      seen.add(text);
    }
  });
  if (current.length) batches.push(current);
  batches.forEach(b => enqueueBatch(b));
}

function collectNodes(root, out) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.trim() && shouldTranslate(node)) {
      out.push(node);
    }
  }
  if (root.querySelectorAll) {
    root.querySelectorAll('iframe,object,embed').forEach(el => {
      try {
        const doc = el.contentDocument || el.getSVGDocument?.();
        if (doc) collectNodes(doc, out);
      } catch {}
    });
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) collectNodes(el.shadowRoot, out);
    });
  }
}

function flushPending() {
  const nodes = [];
  pending.forEach(n => collectNodes(n, nodes));
  pending.clear();
  flushTimer = null;
  if (nodes.length) batchNodes(nodes);
}

function scheduleScan(node) {
  if (!node) return;
  pending.add(node);
  if (!flushTimer) flushTimer = setTimeout(flushPending, 50);
}

function scan(root = document.body) {
  const nodes = [];
  collectNodes(root, nodes);
  if (nodes.length) batchNodes(nodes);
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

async function start() {
  currentConfig = await window.qwenLoadConfig();
  if (window.qwenSetTokenBudget) {
    window.qwenSetTokenBudget(currentConfig.tokenBudget || 0);
  }
  if (!currentConfig.apiKey) {
    console.warn('QTWARN: API key not configured.');
    return;
  }
  if (currentConfig.debug) console.log('QTDEBUG: starting automatic translation');
  setStatus('Scanning page...');
  const nodes = [];
  collectNodes(document.body, nodes);
  if (nodes.length) batchNodes(nodes);
  observe();
  if (!batchQueue.length) clearStatus();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'start') {
    if (currentConfig && currentConfig.debug) console.log('QTDEBUG: start message received');
    start();
  }
  if (msg.action === 'test-read') {
    sendResponse({ title: document.title });
  }
  if (msg.action === 'test-e2e') {
    const cfg = msg.cfg || {};
    const original = msg.original || 'Hello world';
    const el = document.createElement('span');
    el.id = 'qwen-test-element';
    el.textContent = original;
    document.body.appendChild(el);
    if (cfg.debug) console.log('QTDEBUG: test-e2e request received');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    window
      .qwenTranslate({
        endpoint: cfg.endpoint,
        apiKey: cfg.apiKey,
        model: cfg.model,
        text: original,
        source: cfg.source,
        target: cfg.target,
        debug: cfg.debug,
        stream: false,
        signal: controller.signal,
      })
      .then(res => {
        clearTimeout(timer);
        if (cfg.debug) console.log('QTDEBUG: test-e2e translation result', res);
        if (!res || typeof res.text !== 'string') {
          throw new Error('invalid response');
        }
        el.textContent = res.text;
        if (cfg.debug) console.log('QTDEBUG: test-e2e sending response');
        sendResponse({ text: res.text });
        setTimeout(() => el.remove(), 1000);
      })
      .catch(err => {
        clearTimeout(timer);
        if (cfg.debug) console.log('QTDEBUG: test-e2e sending error', err);
        el.remove();
        sendResponse({ error: err.message, stack: err.stack });
      });
    return true;
  }
  if (msg.action === 'translate-selection') {
    (async () => {
      const sel = window.getSelection();
      const text = sel && sel.toString().trim();
      if (!text) return;
      const cfg = currentConfig || (await window.qwenLoadConfig());
      try {
        const { text: translated } = await window.qwenTranslate({
          endpoint: cfg.apiEndpoint,
          apiKey: cfg.apiKey,
          model: cfg.model,
          text,
          source: cfg.sourceLanguage,
          target: cfg.targetLanguage,
          debug: cfg.debug,
        });
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(translated);
        range.insertNode(node);
        mark(node);
        sel.removeAllRanges();
      } catch (e) {
        showError('Translation failed');
      }
    })();
  }
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  window.qwenLoadConfig().then(cfg => { if (cfg.autoTranslate) start(); });
} else {
  window.addEventListener('DOMContentLoaded', () => {
    window.qwenLoadConfig().then(cfg => { if (cfg.autoTranslate) start(); });
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    translateBatch,
    collectNodes,
    setCurrentConfig: cfg => {
      currentConfig = cfg;
    },
  };
}
}
