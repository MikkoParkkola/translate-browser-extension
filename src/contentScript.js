let observers = [];
let currentConfig;
const batchQueue = [];
let processing = false;

function showError(message) {
  let el = document.getElementById('qwen-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'qwen-error';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      background: 'rgba(255,0,0,0.8)',
      color: '#fff',
      padding: '5px 10px',
      zIndex: 2147483647,
      fontSize: '12px',
    });
    document.body.appendChild(el);
  }
  el.textContent = `Qwen Translator: ${message}`;
}

function mark(node) {
  node.dataset.qwenTranslated = 'true';
}

function markUntranslatable(node) {
  node.dataset.qwenUntranslatable = 'true';
}

function isMarked(node) {
  return (
    node.dataset &&
    (node.dataset.qwenTranslated === 'true' || node.dataset.qwenUntranslatable === 'true')
  );
}

async function translateNode(node) {
  const text = node.textContent.trim();
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
    node.textContent = translated;
    mark(node);
  } catch (e) {
    showError(`${e.message}. See console for details.`);
    console.error('QTERROR: translation error', e);
  }
}

async function translateBatch(elements) {
  const texts = elements.map(el => el.textContent.trim());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await window.qwenTranslateBatch({
      endpoint: currentConfig.apiEndpoint,
      apiKey: currentConfig.apiKey,
      model: currentConfig.model,
      texts,
      source: currentConfig.sourceLanguage,
      target: currentConfig.targetLanguage,
      signal: controller.signal,
      debug: currentConfig.debug,
    });
  } finally {
    clearTimeout(timeout);
  }
  res.texts.forEach((t, i) => {
    const el = elements[i];
    if (currentConfig.debug) {
      console.log('QTDEBUG: node translation result', { original: texts[i].slice(0, 50), translated: t.slice(0, 50) });
    }
    if (t.trim().toLowerCase() === texts[i].trim().toLowerCase()) {
      markUntranslatable(el);
      if (currentConfig.debug) {
        console.warn('QTWARN: translated text is identical to source; marking as untranslatable');
      }
    } else {
      el.textContent = t;
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
  while (batchQueue.length) {
    const batch = batchQueue.shift();
    try {
      await translateBatch(batch);
    } catch (e) {
      showError(`${e.message}. See console for details.`);
      console.error('QTERROR: batch translation error', e);
      batchQueue.push(batch);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  processing = false;
}

function batchNodes(nodes) {
  const maxTokens = 1000;
  const batches = [];
  let current = [];
  let tokens = 0;
  const approx = window.qwenThrottle ? window.qwenThrottle.approxTokens : t => Math.ceil(t.length / 4);
  nodes.forEach(el => {
    const text = el.textContent.trim();
    const tok = approx(text);
    if (current.length && tokens + tok > maxTokens) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(el);
    tokens += tok;
  });
  if (current.length) batches.push(current);
  batches.forEach(b => enqueueBatch(b));
}

function scan(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (parent && !isMarked(parent) && node.textContent.trim()) {
      nodes.push(parent);
    }
  }
  if (nodes.length) batchNodes(nodes);
  if (root.querySelectorAll) {
    root.querySelectorAll('iframe,object,embed').forEach(el => {
      try {
        const doc = el.contentDocument || el.getSVGDocument?.();
        if (doc) scan(doc);
      } catch {}
    });
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) scan(el.shadowRoot);
    });
  }
}

function observe(root = document.body) {
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(n => {
        if (n.nodeType === Node.ELEMENT_NODE) {
          scan(n);
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
  if (!currentConfig.apiKey) {
    console.warn('QTWARN: API key not configured.');
    return;
  }
  if (currentConfig.debug) console.log('QTDEBUG: starting automatic translation');
  scan();
  observe();
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
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  window.qwenLoadConfig().then(cfg => { if (cfg.autoTranslate) start(); });
} else {
  window.addEventListener('DOMContentLoaded', () => {
    window.qwenLoadConfig().then(cfg => { if (cfg.autoTranslate) start(); });
  });
}
