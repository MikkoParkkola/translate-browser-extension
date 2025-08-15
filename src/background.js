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
const inflight = new Map(); // requestId -> { controller, timeout, port }

// Test-accessible state
let usingPlus = false;
let config = { providerOrder: [], requestThreshold: 0 };
const usageStats = { models: {} };

function setUsingPlus(v) { usingPlus = !!v; }
function _setActiveTranslations(n) { activeTranslations = n; }
function _setConfig(c) { config = { ...config, ...c }; }

async function updateIcon() {
  await ensureThrottle();
  if (typeof OffscreenCanvas === 'undefined') return;
  const { requests, requestLimit, tokens, tokenLimit } = self.qwenThrottle.getUsage();
  const reqPct = requestLimit ? requests / requestLimit : 0;
  const tokPct = tokenLimit ? tokens / tokenLimit : 0;
  const pct = Math.min(Math.max(reqPct, tokPct), 1);
  const busy = activeTranslations > 0;

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
  const color = self.qwenUsageColor ? self.qwenUsageColor(pct) : '#d0d4da';

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, 2 * Math.PI);
  ctx.fill();

  // central emoji icon
  if (ctx.fillText) {
    ctx.font = `${size * 0.6}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🤖', size / 2, size / 2 + 4);

    // activity bolt
    if (busy) {
      ctx.font = `${size * 0.35}px serif`;
      ctx.fillText('⚡', size * 0.8, size * 0.2);
    }
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon({ imageData: { 128: imageData } });
}

function updateBadge() {
  const busy = activeTranslations > 0;
  const text = busy ? (usingPlus ? 'P' : '…') : '';
  chrome.action.setBadgeText({ text });
  if (chrome.action.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: busy ? '#ff4500' : '#00000000' });
  }
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

const COST_RATES = { 'qwen-mt-turbo': 0.00000016, 'google-nmt': 0.00002 };

async function selectProvider(p) {
  const order = config.providerOrder && config.providerOrder.length
    ? config.providerOrder.slice(config.providerOrder.indexOf(p))
    : [p];
  for (const name of order) {
    const prov = self.qwenProviders && self.qwenProviders.getProvider && self.qwenProviders.getProvider(name);
    if (prov && prov.getQuota) {
      try {
        const q = await prov.getQuota();
        if (!q || !q.remaining || q.remaining.requests > (config.requestThreshold || 0)) return name;
      } catch {}
    } else {
      return name;
    }
  }
  return p;
}

async function handleTranslate(opts) {
  const { endpoint, apiKey, model, text, source, target, debug } = opts;
  const ep = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  const provider = await selectProvider(opts.provider || 'qwen');
  if (debug) logger.debug('background translating via', ep, 'provider', provider);

  await ensureThrottle();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  activeTranslations++;
  updateBadge();

  try {
    const storedKey = await getApiKeyFromStorage();
    const result = await self.qwenTranslate({
      endpoint: ep,
      apiKey: storedKey,
      model,
      provider,
      text,
      source,
      target,
      debug,
      signal: controller.signal,
      stream: false,
    });
    const tokens = self.qwenThrottle.approxTokens(text || '');
    usageStats.models[model] = usageStats.models[model] || { requests: 0 };
    usageStats.models[model].requests++;
    const cost = tokens * (COST_RATES[model] || 0);
    chrome.storage.local.get({ usageHistory: [] }, data => {
      const hist = data.usageHistory || [];
      hist.push({ ts: Date.now(), model, provider: 'qwen', cost });
      chrome.storage.local.set({ usageHistory: hist });
    });
    if (debug) logger.debug('background translation completed');
    return result;
  } catch (err) {
    logger.error('background translation error', err);
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
    if (msg.debug) logger.debug('ping received');
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'usage') {
    ensureThrottle().then(() => {
      const stats = self.qwenThrottle.getUsage();
      chrome.storage.local.get({ usageHistory: [] }, data => {
        const now = Date.now();
        const costs = { total: { '24h': 0, '7d': 0 } };
        (data.usageHistory || []).forEach(rec => {
          const age = now - rec.ts;
          const entry = costs[rec.model] || { '24h': 0, '7d': 0 };
          if (age <= 86400000) { entry['24h'] += rec.cost; costs.total['24h'] += rec.cost; }
          if (age <= 86400000 * 7) { entry['7d'] += rec.cost; costs.total['7d'] += rec.cost; }
          costs[rec.model] = entry;
        });
        sendResponse({ ...stats, models: usageStats.models, costs });
      });
    });
    return true;
  }
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
    setUsingPlus,
    _setActiveTranslations,
    handleTranslate,
    _setConfig,
  };
}
