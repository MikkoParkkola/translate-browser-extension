importScripts('throttle.js', 'translator.js');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Qwen Translator installed');
  chrome.contextMenus.create({
    id: 'qwen-translate-selection',
    title: 'Translate selection',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'qwen-translate-selection' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'translate-selection' });
  }
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

  const size = 128; // Use a higher resolution canvas for better quality
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';

  // Base icon: a simple, modern "Q"
  ctx.fillStyle = '#4285F4'; // Google blue, as a placeholder
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Q', size / 2, size / 2 + 5);

  // Busy indicator: a subtle pulsating glow
  if (activeTranslations > 0) {
    const pulse = (Math.sin(iconFrame / 5) + 1) / 2; // 0 to 1
    ctx.shadowColor = 'rgba(66, 133, 244, 0.7)';
    ctx.shadowBlur = pulse * 15;
    ctx.fillStyle = 'rgba(66, 133, 244, 0.2)';
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2 - 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow
  }

  // Rate limit status: two concentric progress rings
  const reqPct = Math.max(0, requests / requestLimit);
  const tokPct = Math.max(0, tokens / tokenLimit);

  function getColor(pct) {
    if (pct >= 1) return '#d9534f'; // red
    if (pct > 0.8) return '#f0ad4e'; // yellow
    return '#5cb85c'; // green
  }

  // Draw request ring
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#e9ecef'; // background
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 - 8, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.strokeStyle = getColor(reqPct);
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 - 8, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * reqPct);
  ctx.stroke();

  // Draw token ring
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#e9ecef'; // background
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 - 22, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.strokeStyle = getColor(tokPct);
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 - 22, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * tokPct);
  ctx.stroke();


  // Set icon for multiple sizes
  const imageData = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon({
    imageData: {
      128: imageData,
      // Chrome will scale down the 128px icon for other sizes
    }
  });
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
