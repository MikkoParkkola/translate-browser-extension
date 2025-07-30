let observer;
let currentConfig;

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
    const {text: translated, detected_language} = await window.qwenTranslate({
      endpoint: currentConfig.apiEndpoint,
      apiKey: currentConfig.apiKey,
      model: currentConfig.model,
      text,
      target: currentConfig.targetLanguage
    });
    if (currentConfig.ignoredLanguages.includes(detected_language) || detected_language === currentConfig.targetLanguage) {
      return;
    }
    node.textContent = translated;
    mark(node);
  } catch (e) {
    console.error('Translation error:', e);
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
    console.warn('Qwen Translator: API key not configured.');
    return;
  }
  scan();
  observe();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'start') {
    start();
  }
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  window.qwenLoadConfig().then(cfg => { if (cfg.autoTranslate) start(); });
} else {
  window.addEventListener('DOMContentLoaded', () => {
    window.qwenLoadConfig().then(cfg => { if (cfg.autoTranslate) start(); });
  });
}
