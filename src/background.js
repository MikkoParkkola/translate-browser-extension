importScripts('throttle.js', 'translator.js', 'usageColor.js');

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
const modelUsage = {
  'qwen-mt-turbo': { requests: 0, tokens: 0, requestLimit: 60, tokenLimit: 31980 },
  'qwen-mt-plus': { requests: 0, tokens: 0, requestLimit: 60, tokenLimit: 23797 },
};

const costRates = {
  'qwen-mt-turbo': { in: 0.16 / 1e6, out: 0.49 / 1e6 },
  'qwen-mt-plus': { in: 2.46 / 1e6, out: 7.37 / 1e6 },
};
const usageHistory = [];

function recordCost(model, inTok, outTok, ts = Date.now()) {
  usageHistory.push({ model, inTok, outTok, ts });
}

function getCostStats(now = Date.now()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const periods = {
    day: { turbo: 0, plus: 0, total: 0 },
    week: { turbo: 0, plus: 0, total: 0 },
    month: { turbo: 0, plus: 0, total: 0 },
  };
  const calendarMap = new Map();
  usageHistory.forEach(ev => {
    if (now - ev.ts > 30 * dayMs) return;
    const rates = costRates[ev.model];
    if (!rates) return;
    const cost = ev.inTok * rates.in + ev.outTok * rates.out;
    const target = ev.model === 'qwen-mt-plus' ? 'plus' : 'turbo';
    if (now - ev.ts <= dayMs) {
      periods.day[target] += cost;
      periods.day.total += cost;
    }
    if (now - ev.ts <= 7 * dayMs) {
      periods.week[target] += cost;
      periods.week.total += cost;
    }
    periods.month[target] += cost;
    periods.month.total += cost;
    const date = new Date(ev.ts).toISOString().slice(0, 10);
    if (!calendarMap.has(date)) {
      calendarMap.set(date, { turbo: 0, plus: 0, total: 0 });
    }
    const dayStats = calendarMap.get(date);
    dayStats[target] += cost;
    dayStats.total += cost;
  });
  const calendar = Array.from(calendarMap.entries())
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ...periods, calendar };
}

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

async function handleTranslate(opts) {
  const { endpoint, apiKey, model, models, text, source, target, debug } = opts;
  const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  if (debug) console.log('QTDEBUG: background translating via', ep);

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
      endpoint: ep,
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
        const inTok = self.qwenThrottle.approxTokens(text);
        const outTok = self.qwenThrottle.approxTokens(result.text || '');
        modelUsage[usedModel].tokens += inTok + outTok;
        recordCost(usedModel, inTok, outTok);
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
      const stats = self.qwenThrottle.getUsage();
      stats.models = modelUsage;
      stats.costs = getCostStats();
      sendResponse(stats);
    });
    return true;
  }
  if (msg.action === 'config-changed') {
    throttleReady = null;
    ensureThrottle().then(() => sendResponse({ ok: true }));
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
    recordCost,
    getCostStats,
  };
}
