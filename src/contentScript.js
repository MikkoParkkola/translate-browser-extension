let observer;
let currentConfig;

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

function isMarked(node) {
  return node.dataset && node.dataset.qwenTranslated === 'true';
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
    node.textContent = translated;
    mark(node);
  } catch (e) {
    showError(`${e.message}. See console for details.`);
    console.error('QTERROR: translation error', e);
  }
}

function scan() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (parent && !isMarked(parent) && node.textContent.trim()) {
      nodes.push(node);
    }
  }
  nodes.forEach(n => translateNode(n.parentElement));
}

function observe() {
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(n => {
        if (n.nodeType === Node.ELEMENT_NODE) {
          const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, null);
          let node;
          while ((node = walker.nextNode())) {
            translateNode(node.parentElement);
          }
        }
      });
    }
  });
  observer.observe(document.body, {childList: true, subtree: true});
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
    const original = 'Hello world';
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
