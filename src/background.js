<<<<<<< HEAD
importScripts('lib/logger.js', 'lib/providers.js', 'providers/openai.js', 'providers/deepl.js', 'providers/dashscope.js', 'lib/tm.js', 'throttle.js', 'translator.js', 'usageColor.js');

const logger = (self.qwenLogger && self.qwenLogger.create)
  ? self.qwenLogger.create('background')
  : console;

function getApiKeyFromStorage() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ apiKey: '' }, cfg => resolve(cfg.apiKey || ''));
  });
}

function getDetectApiKeyFromStorage() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ detectApiKey: '' }, cfg => resolve(cfg.detectApiKey || ''));
  });
}

function localDetectLanguage(text) {
  const s = String(text || '');
  const total = s.length || 1;
  const counts = {
    ja: (s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length,
    ko: (s.match(/[\uac00-\ud7af]/g) || []).length,
    ru: (s.match(/[\u0400-\u04FF]/g) || []).length,
    ar: (s.match(/[\u0600-\u06FF]/g) || []).length,
    hi: (s.match(/[\u0900-\u097F]/g) || []).length,
    en: (s.match(/[A-Za-z]/g) || []).length,
  };
  let best = 'en', max = 0;
  for (const [k, v] of Object.entries(counts)) { if (v > max) { max = v; best = k; } }
  const confidence = Math.min(1, max / total);
  return { lang: best, confidence };
}
async function googleDetectLanguage(text, debug) {
  const key = await getDetectApiKeyFromStorage();
  if (!key) throw new Error('No API key configured for Google detection');
  const url = `https://translation.googleapis.com/language/translate/v2/detect?key=${encodeURIComponent(key)}`;
  const body = new URLSearchParams({ q: String(text || '').slice(0, 2000) });
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`Detect HTTP ${resp.status} ${errText || ''}`.trim());
    if (resp.status >= 500 || resp.status === 429) err.retryable = true;
    throw err;
  }
  const data = await resp.json();
  const det = data && data.data && data.data.detections && data.data.detections[0] && data.data.detections[0][0];
  if (!det || !det.language) throw new Error('Invalid detect response');
  return { lang: det.language, confidence: det.confidence || 0 };
}

function urlEligible(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' || x.protocol === 'file:'; }
  catch { return false; }
}
function originPattern(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'file:') return 'file:///*';
    return `${x.protocol}//${x.host}/*`;
  } catch { return null; }
}
function hasOriginPermission(pattern) {
  return new Promise(resolve => chrome.permissions.contains({ origins: [pattern] }, g => resolve(!!g)));
}
function requestOriginPermission(pattern) {
  return new Promise(resolve => chrome.permissions.request({ origins: [pattern] }, g => resolve(!!g)));
}
async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ['styles/cyberpunk.css'],
    });
  } catch (e) {
    // best-effort; contentScript will also attempt to add a <link> fallback
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['lib/logger.js', 'lib/messaging.js', 'lib/batchDelim.js', 'lib/providers.js', 'providers/openai.js', 'providers/deepl.js', 'providers/dashscope.js', 'lib/tm.js', 'lib/detect.js', 'config.js', 'throttle.js', 'translator.js', 'contentScript.js'],
  });
}
async function ensureInjected(tabId) {
  const present = await new Promise(res => {
    try { chrome.tabs.sendMessage(tabId, { action: 'test-read' }, r => res(!!(r && r.title))); }
    catch { res(false); }
  });
  if (!present) await injectContentScripts(tabId);
}
async function ensureInjectedAndStart(tabId) {
  await ensureInjected(tabId);
  try { chrome.tabs.sendMessage(tabId, { action: 'start' }); } catch {}
}
async function maybeAutoInject(tabId, url) {
  if (!urlEligible(url)) return;
  const pattern = originPattern(url);
  if (!pattern) return;
  const cfg = await new Promise(r => chrome.storage.sync.get({ autoTranslate: false }, r));
  if (!cfg.autoTranslate) return;
  const has = await hasOriginPermission(pattern);
  if (!has) return;
  await ensureInjectedAndStart(tabId);
}
=======
importScripts(
  'throttle.js',
  'lz-string.min.js',
  'cache.js',
  'providers/index.js',
  'providers/qwen.js',
  'translator.js',
  'usageColor.js',
  'config.js'
);

chrome.storage.sync.get(
  { cacheMaxEntries: 1000, cacheTTL: 30 * 24 * 60 * 60 * 1000 },
  cfg => {
    if (self.qwenSetCacheLimit) self.qwenSetCacheLimit(cfg.cacheMaxEntries);
    if (self.qwenSetCacheTTL) self.qwenSetCacheTTL(cfg.cacheTTL);
  }
);
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f

chrome.runtime.onInstalled.addListener(() => {
  logger.info('Qwen Translator installed');
  chrome.contextMenus.create({
    id: 'qwen-translate-selection',
    title: 'Translate selection',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'qwen-translate-page',
    title: 'Translate page',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'qwen-enable-site',
    title: 'Enable auto-translate on this site',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;
  if (info.menuItemId === 'qwen-translate-selection') {
    await ensureInjected(tabId);
    try { chrome.tabs.sendMessage(tabId, { action: 'translate-selection' }); } catch {}
    return;
  }
  if (info.menuItemId === 'qwen-translate-page') {
    await ensureInjectedAndStart(tabId);
    return;
  }
  if (info.menuItemId === 'qwen-enable-site') {
    if (!tab.url || !urlEligible(tab.url)) return;
    const pattern = originPattern(tab.url);
    if (!pattern) return;
    const granted = await requestOriginPermission(pattern);
    if (granted) {
      chrome.storage.sync.set({ autoTranslate: true }, () => {});
      await ensureInjectedAndStart(tabId);
    }
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
<<<<<<< HEAD
const inflight = new Map(); // requestId -> { controller, timeout, port }
=======
let usingPlus = false;
const PRICES = {
  'qwen-mt-turbo': { type: 'token', in: 0.16, out: 0.49 },
  'google-nmt': { type: 'char', char: 20 },
  'google-llm': { type: 'char', char: 30 },
  'deepl-free': { type: 'char', char: 0 },
  'deepl-pro': { type: 'char', char: 25 },
};
const modelUsage = {};
Object.keys(PRICES).forEach(m => {
  modelUsage[m] = {
    requests: 0,
    tokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    chars: 0,
    charsIn: 0,
    charsOut: 0,
    requestLimit: 60,
    tokenLimit: m.startsWith('qwen') ? 31980 : 0,
  };
});


let config = { providerOrder: ['qwen'], requestThreshold: 0, tokenThreshold: 0 };
let providerIndex = 0;
function loadConfig() {
  if (self.qwenLoadConfig) {
    self.qwenLoadConfig().then(c => {
      const order = Array.isArray(c.providerOrder) && c.providerOrder.length ? c.providerOrder : ['qwen'];
      config.providerOrder = order;
      config.requestThreshold = c.requestThreshold || 0;
      config.tokenThreshold = c.tokenThreshold || 0;
      if (providerIndex >= order.length) providerIndex = 0;
    });
  }
}
loadConfig();

>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f

async function updateIcon() {
  await ensureThrottle();
  if (typeof OffscreenCanvas === 'undefined') return;
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

function recordUsage(provider, model, tokensIn, tokensOut, charsIn, charsOut) {
  return new Promise(resolve => {
    const entry = {
      time: Date.now(),
      provider,
      model,
      tokensIn,
      tokensOut,
      charsIn,
      charsOut,
    };
    chrome.storage.local.get('usageHistory', data => {
      const history = Array.isArray(data.usageHistory) ? data.usageHistory : [];
      history.push(entry);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const filtered = history.filter(e => e.time >= cutoff);
      chrome.storage.local.set({ usageHistory: filtered }, resolve);
    });
  });
}

async function chooseProvider(opts) {
  const order = Array.isArray(config.providerOrder) && config.providerOrder.length ? config.providerOrder : [opts.provider || 'qwen'];
  let current = order[providerIndex % order.length];
  const prov = self.qwenProviders && self.qwenProviders.getProvider ? self.qwenProviders.getProvider(current) : null;
  let switchProvider = false;
  if (prov && prov.getQuota && (config.requestThreshold || config.tokenThreshold)) {
    try {
      const quota = await prov.getQuota({ endpoint: opts.endpoint, apiKey: opts.apiKey, model: opts.model });
      const remainReq = quota.remaining && typeof quota.remaining.requests === 'number' ? quota.remaining.requests : Infinity;
      const remainTok = quota.remaining && typeof quota.remaining.tokens === 'number' ? quota.remaining.tokens : Infinity;
      const local = modelUsage[opts.model] || {};
      const localReq = (local.requestLimit || 0) - (local.requests || 0);
      const localTok = (local.tokenLimit || 0) - (local.tokens || 0);
      const minReq = Math.min(remainReq, localReq);
      const minTok = Math.min(remainTok, localTok);
      if ((config.requestThreshold && minReq <= config.requestThreshold) || (config.tokenThreshold && minTok <= config.tokenThreshold)) {
        switchProvider = true;
      }
    } catch (e) {
      // ignore quota errors
    }
  }
  if (switchProvider && order.length > 1) {
    providerIndex = (providerIndex + 1) % order.length;
    current = order[providerIndex];
  }
  return current;
}

async function handleTranslate(opts) {
<<<<<<< HEAD
  const { endpoint, apiKey, model, text, source, target, debug } = opts;
  const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  if (debug) logger.debug('background translating via', ep);
=======
  const { provider = 'qwen', endpoint, apiKey, model, models, failover, text, source, target, debug } = opts;
  if (debug) console.log('QTDEBUG: background translating via', endpoint);
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f

  await ensureThrottle();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  activeTranslations++;
  usingPlus =
    model === 'qwen-mt-plus' ||
    (Array.isArray(models) && models[0] === 'qwen-mt-plus');
  updateBadge();

  try {
<<<<<<< HEAD
    const storedKey = await getApiKeyFromStorage();
    const result = await self.qwenTranslate({
      endpoint: ep,
      apiKey: storedKey,
=======
    const chosenProvider = await chooseProvider({ provider, endpoint, apiKey, model });
    const result = await self.qwenTranslate({
      provider: chosenProvider,
      endpoint,
      apiKey,
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
      model,
      models,
      failover,
      text,
      source,
      target,
      debug,
      signal: controller.signal,
      stream: false,
    });
<<<<<<< HEAD
    if (debug) logger.debug('background translation completed');
=======
    const usedModel = model;
    if (modelUsage[usedModel]) {
      modelUsage[usedModel].requests++;
      try {
        let tokensIn = 0,
          tokensOut = 0,
          charsIn = 0,
          charsOut = 0;
        if (provider === 'qwen') {
          tokensIn = self.qwenThrottle.approxTokens(text);
          tokensOut = self.qwenThrottle.approxTokens(result.text || '');
          modelUsage[usedModel].tokens += tokensIn + tokensOut;
          modelUsage[usedModel].tokensIn += tokensIn;
          modelUsage[usedModel].tokensOut += tokensOut;
        } else {
          charsIn = (text || '').length;
          charsOut = (result.text || '').length;
          modelUsage[usedModel].chars += charsIn + charsOut;
          modelUsage[usedModel].charsIn += charsIn;
          modelUsage[usedModel].charsOut += charsOut;
        }
        await recordUsage(chosenProvider, usedModel, tokensIn, tokensOut, charsIn, charsOut);
      } catch {}
    }
    if (debug) console.log('QTDEBUG: background translation completed');
    console.log('QTCOST: provider', chosenProvider);
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
    return result;
  } catch (err) {
    logger.error('background translation error', err);
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
    if (msg.debug) logger.debug('ping received');
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
        const costs = { total: { '24h': 0, '7d': 0, '30d': 0 }, daily: [] };
        Object.keys(PRICES).forEach(m => {
          costs[m] = { '24h': 0, '7d': 0, '30d': 0 };
        });
        history.forEach(h => {
          const price = PRICES[h.model] || {};
          let cost = 0;
          if (price.type === 'char') {
            cost = ((h.charsIn || 0) * (price.char || 0)) / 1e6;
          } else {
            cost =
              ((h.tokensIn || 0) * (price.in || 0) + (h.tokensOut || 0) * (price.out || 0)) /
              1e6;
          }
          ['24h', '7d', '30d'].forEach(w => {
            if (now - h.time <= windows[w]) {
              if (costs[h.model]) costs[h.model][w] += cost;
              costs.total[w] += cost;
            }
          });
        });
        for (let i = 29; i >= 0; i--) {
          const dayStart = new Date(now - i * 24 * 60 * 60 * 1000);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000;
          const dayCost = history.reduce((sum, h) => {
            if (h.time >= dayStart.getTime() && h.time < dayEnd) {
              const price = PRICES[h.model] || {};
              let c = 0;
              if (price.type === 'char') {
                c = ((h.charsIn || 0) * (price.char || 0)) / 1e6;
              } else {
                c =
                  ((h.tokensIn || 0) * (price.in || 0) +
                    (h.tokensOut || 0) * (price.out || 0)) /
                  1e6;
              }
              return sum + c;
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
<<<<<<< HEAD
  if (msg.action === 'detect') {
    const opts = msg.opts || {};
    (async () => {
      try {
        const out = opts.detector === 'google'
          ? await googleDetectLanguage(opts.text, opts.debug)
          : localDetectLanguage(opts.text);
        sendResponse(out);
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
=======
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
        loadConfig();
        ensureThrottle().then(() => sendResponse({ ok: true }));
      }
    );
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
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
  if (msg.action === 'ensure-start') {
    (async () => {
      try {
        const { tabId, url } = msg;
        if (!tabId) { sendResponse({ ok: false, error: 'no tabId' }); return; }
        let ok = true;
        if (url && urlEligible(url)) {
          const pattern = originPattern(url);
          if (pattern && !(await hasOriginPermission(pattern))) {
            ok = await requestOriginPermission(pattern);
          }
        }
        if (ok) {
          await ensureInjectedAndStart(tabId);
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'permission denied' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || 'failed' });
      }
    })();
    return true;
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'qwen-translate') return;
  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.action === 'translate') {
      const { requestId, opts } = msg;
      if (!requestId || !opts) return;
      await ensureThrottle();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts && opts.stream ? 60000 : 20000);
      activeTranslations++;
      updateBadge();
      inflight.set(requestId, { controller, timeout, port });
      const ep = opts.endpoint && opts.endpoint.endsWith('/') ? opts.endpoint : (opts.endpoint ? opts.endpoint + '/' : opts.endpoint);
      const storedKey = await getApiKeyFromStorage();
      const safeOpts = { ...opts, endpoint: ep, apiKey: storedKey, signal: controller.signal };
      try {
        if (opts && opts.stream) {
          const result = await self.qwenTranslateStream(safeOpts, chunk => {
            try { port.postMessage({ requestId, chunk }); } catch {}
          });
          try { port.postMessage({ requestId, result }); } catch {}
        } else {
          const result = await self.qwenTranslate(safeOpts);
          try { port.postMessage({ requestId, result }); } catch {}
        }
      } catch (err) {
        logger.error('background port translation error', err);
        try { port.postMessage({ requestId, error: err.message }); } catch {}
      } finally {
        clearTimeout(timeout);
        inflight.delete(requestId);
        activeTranslations--;
        updateBadge();
      }
      return;
    }
    if (msg.action === 'detect') {
      const { requestId, opts } = msg;
      if (!requestId || !opts) return;
      try {
        const out = opts.detector === 'google'
          ? await googleDetectLanguage(opts.text, opts.debug)
          : localDetectLanguage(opts.text);
        try { port.postMessage({ requestId, result: out }); } catch {}
      } catch (err) {
        try { port.postMessage({ requestId, error: err.message }); } catch {}
      }
      return;
    } else if (msg.action === 'cancel' && msg.requestId) {
      const rec = inflight.get(msg.requestId);
      if (rec) {
        try { rec.controller.abort(); } catch {}
        clearTimeout(rec.timeout);
        inflight.delete(msg.requestId);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    for (const [id, rec] of inflight.entries()) {
      if (rec.port === port) {
        try { rec.controller.abort(); } catch {}
        clearTimeout(rec.timeout);
        inflight.delete(id);
      }
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab && tab.url) {
    maybeAutoInject(tabId, tab.url);
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
    _setConfig: c => {
      config = { ...config, ...c };
    },
  };
}
