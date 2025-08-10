importScripts('throttle.js', 'translator.js');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
});

// Redirect top-level PDF navigations to our custom viewer
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (!url) return;
  if (url.startsWith(chrome.runtime.getURL('pdfViewer.html'))) return;
  try {
    const u = new URL(url);
    if ((u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') && u.pathname.toLowerCase().endsWith('.pdf')) {
      const viewer = chrome.runtime.getURL('pdfViewer.html') + '?file=' + encodeURIComponent(url);
      chrome.tabs.update(tabId, { url: viewer });
    }
  } catch (e) {
    // ignore invalid URLs
  }
});

let throttleReady;
let activeTranslations = 0;

async function updateIcon() {
  await ensureThrottle();
  const { requests, tokens, requestLimit, tokenLimit } = self.qwenThrottle.getUsage();
  function color(rem, limit) {
    if (rem <= 0) return '#d9534f';
    if (rem / limit < 0.2) return '#f0ad4e';
    return '#5cb85c';
  }
  const reqColor = color(requestLimit - requests, requestLimit);
  const tokColor = color(tokenLimit - tokens, tokenLimit);
  const canvas = new OffscreenCanvas(19, 19);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 19, 19);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 19, 19);
  if (activeTranslations > 0) {
    ctx.strokeStyle = '#0d6efd';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 17, 17);
  } else {
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 19, 19);
  }
  ctx.fillStyle = reqColor;
  ctx.beginPath();
  ctx.arc(6, 9.5, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tokColor;
  ctx.beginPath();
  ctx.arc(13, 9.5, 4, 0, Math.PI * 2);
  ctx.fill();
  const imageData = ctx.getImageData(0, 0, 19, 19);
  chrome.action.setIcon({ imageData: { 19: imageData } });
}

function updateBadge() {
  if (activeTranslations > 0) {
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#0d6efd' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
  updateIcon();
}
updateBadge();
setInterval(updateIcon, 5000);
function ensureThrottle() {
  if (!throttleReady) {
    throttleReady = new Promise(resolve => {
      chrome.storage.sync.get(
        { requestLimit: 60, tokenLimit: 100000 },
        cfg => {
          self.qwenThrottle.configure({
            requestLimit: cfg.requestLimit,
            tokenLimit: cfg.tokenLimit,
            windowMs: 60000,
          });
          resolve();
        }
      );
    });
  }
  return throttleReady;
}

async function handleTranslate(opts) {
  const { endpoint, apiKey, model, text, source, target, debug } = opts;
  const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  if (debug) console.log('QTDEBUG: background translating via', ep);

  await ensureThrottle();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  activeTranslations++;
  updateBadge();

  try {
    const result = await self.qwenTranslate({
      endpoint: ep,
      apiKey,
      model,
      text,
      source,
      target,
      debug,
      signal: controller.signal,
      stream: false,
    });
    if (debug) console.log('QTDEBUG: background translation completed');
    return result;
  } catch (err) {
    console.error('QTERROR: background translation error', err);
    return { error: err.message };
  } finally {
    clearTimeout(timeout);
    activeTranslations--;
    updateBadge();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate') {
    handleTranslate(msg.opts)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.action === 'ping') {
    if (msg.debug) console.log('QTDEBUG: ping received');
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'usage') {
    ensureThrottle().then(() => {
      const stats = self.qwenThrottle.getUsage();
      sendResponse(stats);
    });
    return true;
  }
});
