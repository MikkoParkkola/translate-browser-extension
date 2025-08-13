importScripts('throttle.js', 'lz-string.min.js', 'cache.js', 'providers/index.js', 'providers/qwen.js', 'transport.js', 'translator.js', 'usageColor.js');

chrome.storage.sync.get(
  { cacheMaxEntries: 1000, cacheTTL: 30 * 24 * 60 * 60 * 1000 },
  cfg => {
    if (self.qwenSetCacheLimit) self.qwenSetCacheLimit(cfg.cacheMaxEntries);
    if (self.qwenSetCacheTTL) self.qwenSetCacheTTL(cfg.cacheTTL);
  }
);

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
let translationStatus = { active: false };
let usingPlus = false;
const PRICES = {
  'qwen-mt-turbo': { in: 0.16, out: 0.49 },
  'qwen-mt-plus': { in: 2.46, out: 7.37 },
};
const modelUsage = {
  'qwen-mt-turbo': {
    requests: 0,
    tokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    requestLimit: 60,
    tokenLimit: 31980,
  },
  'qwen-mt-plus': {
    requests: 0,
    tokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    requestLimit: 60,
    tokenLimit: 23797,
  },
};


async function updateIcon() {
  await ensureThrottle();
  const { requests, requestLimit, tokens, tokenLimit } = self.qwenThrottle.getUsage();
  const reqPct = requestLimit ? requests / requestLimit : 0;
  const tokPct = tokenLimit ? tokens / tokenLimit : 0;
  const pct = Math.min(Math.max(reqPct, tokPct), 1);

  const size = 128;
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // outer ring
  const ringWidth = 12;
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = '#c0c0c0';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - ringWidth, 0, 2 * Math.PI);
  ctx.stroke();

  // inner circle reflects highest quota usage
  const minR = 10;
  const maxR = size / 2 - ringWidth - 4;
  const radius = minR + pct * (maxR - minR);
  const color = usingPlus
    ? '#e74c3c'
    : self.qwenUsageColor
    ? self.qwenUsageColor(pct)
    : '#d0d4da';

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, 2 * Math.PI);
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon({ imageData: { 128: imageData } });
}

function updateBadge() {
  const busy = activeTranslations > 0;
  const text = usingPlus ? 'P' : busy ? '…' : '';
  chrome.action.setBadgeText({ text });
  if (chrome.action.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({
      color: usingPlus ? '#ff4500' : busy ? '#ff4500' : '#00000000',
    });
  }
  updateIcon();
}
updateBadge();
setInterval(updateIcon, 500);
function ensureThrottle() {
  if (!throttleReady) {
    throttleReady = new Promise(resolve => {
      chrome.storage.sync.get(
        { requestLimit: 60, tokenLimit: 31980 },
        cfg => {
          self.qwenThrottle.configure({
            requestLimit: cfg.requestLimit,
            tokenLimit: cfg.tokenLimit,
            windowMs: 60000,
          });
          Object.keys(modelUsage).forEach(m => {
            modelUsage[m].requestLimit = cfg.requestLimit;
            modelUsage[m].tokenLimit = cfg.tokenLimit;
          });
          resolve();
        }
      );
    });
  }
  return throttleReady;
}

function recordUsage(model, tokensIn, tokensOut) {
  return new Promise(resolve => {
    const entry = { time: Date.now(), model, tokensIn, tokensOut };
    chrome.storage.local.get('usageHistory', data => {
      const history = Array.isArray(data.usageHistory) ? data.usageHistory : [];
      history.push(entry);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const filtered = history.filter(e => e.time >= cutoff);
      chrome.storage.local.set({ usageHistory: filtered }, resolve);
    });
  });
}

async function handleTranslate(opts) {
  const { provider = 'qwen', endpoint, apiKey, model, models, text, source, target, debug } = opts;
  if (debug) console.log('QTDEBUG: background translating via', endpoint);

  await ensureThrottle();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  activeTranslations++;
  usingPlus =
    model === 'qwen-mt-plus' ||
    (Array.isArray(models) && models[0] === 'qwen-mt-plus');
  updateBadge();

  try {
    const result = await self.qwenTranslate({
      provider,
      endpoint,
      apiKey,
      model,
      models,
      text,
      source,
      target,
      debug,
      signal: controller.signal,
      stream: false,
    });
    const usedModel = model;
    if (modelUsage[usedModel]) {
      modelUsage[usedModel].requests++;
      try {
        const tokensIn = self.qwenThrottle.approxTokens(text);
        const tokensOut = self.qwenThrottle.approxTokens(result.text || '');
        modelUsage[usedModel].tokens += tokensIn + tokensOut;
        modelUsage[usedModel].tokensIn += tokensIn;
        modelUsage[usedModel].tokensOut += tokensOut;
        await recordUsage(usedModel, tokensIn, tokensOut);
      } catch {}
    }
    if (debug) console.log('QTDEBUG: background translation completed');
    return result;
  } catch (err) {
    console.error('QTERROR: background translation error', err);
    return { error: err.message };
  } finally {
    clearTimeout(timeout);
    activeTranslations--;
    usingPlus = false;
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
      chrome.storage.local.get('usageHistory', data => {
        const stats = self.qwenThrottle.getUsage();
        stats.models = modelUsage;
        const history = Array.isArray(data.usageHistory) ? data.usageHistory : [];
        const now = Date.now();
        const windows = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };
        const costs = {
          'qwen-mt-turbo': { '24h': 0, '7d': 0, '30d': 0 },
          'qwen-mt-plus': { '24h': 0, '7d': 0, '30d': 0 },
          total: { '24h': 0, '7d': 0, '30d': 0 },
          daily: [],
        };
        history.forEach(h => {
          const price = PRICES[h.model] || { in: 0, out: 0 };
          const cost = (h.tokensIn * price.in + h.tokensOut * price.out) / 1e6;
          if (now - h.time <= windows['24h']) {
            costs[h.model]['24h'] += cost;
            costs.total['24h'] += cost;
          }
          if (now - h.time <= windows['7d']) {
            costs[h.model]['7d'] += cost;
            costs.total['7d'] += cost;
          }
          if (now - h.time <= windows['30d']) {
            costs[h.model]['30d'] += cost;
            costs.total['30d'] += cost;
          }
        });
        for (let i = 29; i >= 0; i--) {
          const dayStart = new Date(now - i * 24 * 60 * 60 * 1000);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000;
          const dayCost = history.reduce((sum, h) => {
            if (h.time >= dayStart.getTime() && h.time < dayEnd) {
              const price = PRICES[h.model] || { in: 0, out: 0 };
              return sum + (h.tokensIn * price.in + h.tokensOut * price.out) / 1e6;
            }
            return sum;
          }, 0);
          costs.daily.push({ date: dayStart.toISOString().slice(0, 10), cost: dayCost });
        }
        stats.costs = costs;
        sendResponse(stats);
      });
    });
    return true;
  }
  if (msg.action === 'clear-cache') {
    if (self.qwenClearCache) self.qwenClearCache();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'clear-cache-domain') {
    if (self.qwenClearCacheDomain) self.qwenClearCacheDomain(msg.domain);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'clear-cache-pair') {
    if (self.qwenClearCacheLangPair) self.qwenClearCacheLangPair(msg.source, msg.target);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'config-changed') {
    throttleReady = null;
    chrome.storage.sync.get(
      { cacheMaxEntries: 1000, cacheTTL: 30 * 24 * 60 * 60 * 1000 },
      cfg => {
        if (self.qwenSetCacheLimit) self.qwenSetCacheLimit(cfg.cacheMaxEntries);
        if (self.qwenSetCacheTTL) self.qwenSetCacheTTL(cfg.cacheTTL);
        ensureThrottle().then(() => sendResponse({ ok: true }));
      }
    );
    return true;
  }
  if (msg.action === 'translation-status') {
    translationStatus = msg.status || { active: false };
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'get-status') {
    sendResponse(translationStatus);
    return true;
  }
});

if (typeof module !== 'undefined') {
  module.exports = {
    updateBadge,
    updateIcon,
    handleTranslate,
    setUsingPlus: v => {
      usingPlus = v;
    },
    _setActiveTranslations: v => {
      activeTranslations = v;
    },
  };
}
