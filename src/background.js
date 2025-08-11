importScripts('throttle.js', 'translator.js');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
});

// Redirect PDF navigations before the browser's viewer loads
chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.url.startsWith(chrome.runtime.getURL('pdfViewer.html'))) return;
    try {
      const u = new URL(details.url);
      if (
        (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') &&
        u.pathname.toLowerCase().endsWith('.pdf')
      ) {
        const viewer =
          chrome.runtime.getURL('pdfViewer.html') + '?file=' + encodeURIComponent(details.url);
        return { redirectUrl: viewer };
      }
    } catch {}
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['blocking']
);

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
let iconFrame = 0;

async function updateIcon() {
  iconFrame++;
  await ensureThrottle();
  const { requests, tokens, requestLimit, tokenLimit } = self.qwenThrottle.getUsage();
  function color(rem, limit) {
    if (rem <= 0) return '#d9534f';
    if (rem / limit < 0.2) return '#f0ad4e';
    return '#5cb85c';
  }
  const reqColor = color(requestLimit - requests, requestLimit);
  const tokColor = color(tokenLimit - tokens, tokenLimit);
  const reqPct = Math.min(1, Math.max(0, (requestLimit - requests) / requestLimit));
  const tokPct = Math.min(1, Math.max(0, (tokenLimit - tokens) / tokenLimit));
  const size = 19;
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const pulse = activeTranslations > 0 ? 0.6 + 0.4 * Math.sin(iconFrame / 3) : 1;
  // outer activity ring
  ctx.strokeStyle = activeTranslations > 0 ? `rgba(13,110,253,${pulse})` : '#adb5bd';
  ctx.lineWidth = activeTranslations > 0 ? 4 : 3;
  ctx.beginPath();
  ctx.arc(9.5, 9.5, 8, 0, Math.PI * 2);
  ctx.stroke();
  // usage rings
  const blink = iconFrame % 20 < 10;
  ctx.lineCap = 'butt';
  ctx.lineWidth = 4;
  ctx.strokeStyle = requestLimit - requests <= 0 && blink ? '#fff' : reqColor;
  ctx.beginPath();
  ctx.arc(9.5, 9.5, 6, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * reqPct);
  ctx.stroke();
  ctx.strokeStyle = tokenLimit - tokens <= 0 && blink ? '#fff' : tokColor;
  ctx.beginPath();
  ctx.arc(9.5, 9.5, 3, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * tokPct);
  ctx.stroke();
  if (activeTranslations > 0) {
    ctx.fillStyle = '#0d6efd';
    ctx.beginPath();
    ctx.arc(9.5, 9.5, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const imageData = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon({ imageData: { 19: imageData } });
}

function updateBadge() {
  chrome.action.setBadgeText({ text: '' });
  updateIcon();
}
updateBadge();
setInterval(updateIcon, 500);
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
