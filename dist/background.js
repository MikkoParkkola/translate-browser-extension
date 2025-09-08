importScripts('lib/logger.js', 'lib/providers.js', 'providers/openai.js', 'providers/openrouter.js', 'providers/deepl.js', 'providers/dashscope.js', 'providers/mistral.js', 'lib/tm.js', 'lib/feedback.js', 'lib/qualityCheck.js', 'lib/offline.js', 'lib/messaging.js', 'config.js', 'throttle.js', 'translator.js', 'usageColor.js', 'findLimit.js', 'limitDetector.js', 'backgroundBenchmark.js');

// Ensure helper is available when importScripts is stubbed (tests)
if (typeof self.isOfflineError === 'undefined' && typeof require === 'function') {
  self.isOfflineError = require('./lib/offline.js').isOfflineError;
}

const logger = (self.qwenLogger && self.qwenLogger.create)
  ? self.qwenLogger.create('background')
  : console;


const TRANSLATE_TIMEOUT_MS = (self.qwenDefaultConfig && self.qwenDefaultConfig.translateTimeoutMs) || 20000;


function handleLastError(cb) {
  return (...args) => {
    const err = chrome.runtime.lastError;
    if (err && !err.message.includes('Receiving end does not exist')) logger.debug(err);
    if (typeof cb === 'function') cb(...args);
  };
}


const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let pendingVersion;
try { chrome.runtime.requestUpdateCheck?.(() => {}); } catch {}
setInterval(() => {
  try { chrome.runtime.requestUpdateCheck?.(() => {}); } catch {}
}, UPDATE_CHECK_INTERVAL);
if (chrome.runtime?.onUpdateAvailable?.addListener) {
  chrome.runtime.onUpdateAvailable.addListener(details => {
    pendingVersion = details.version;
    try { chrome.runtime.reload(); } catch {}
  });
}

chrome.commands?.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try { chrome.tabs.sendMessage(tab.id, { action: command }, handleLastError()); } catch {}
});

// Load basic config (e.g., memCacheMax) so translator cache limits apply in background
self.qwenConfig = self.qwenConfig || {};
try {
  chrome.storage.sync.get({ memCacheMax: 5000, tmSync: false, translateTimeoutMs: TRANSLATE_TIMEOUT_MS }, cfg => {
    const n = parseInt(cfg.memCacheMax, 10);
    if (n > 0) self.qwenConfig.memCacheMax = n;
    if (self.qwenTM && self.qwenTM.enableSync) { self.qwenTM.enableSync(!!cfg.tmSync); }
    const t = parseInt(cfg.translateTimeoutMs, 10);
    if (Number.isFinite(t) && t > 0) config.translateTimeoutMs = t;
  });
} catch {}

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

function safeSendMessage(msg) {
  try {
    chrome.runtime.sendMessage(msg, handleLastError());
  } catch {}
}

function calibrateLimits(force) {
  if (!self.qwenLimitDetector || !chrome?.storage?.sync) return;
  chrome.storage.sync.get({ apiEndpoint: '', model: '', requestLimit: 60, tokenLimit: 100000, calibratedAt: 0 }, async cfg => {
    try {
      const now = Date.now();
      if (!force && cfg.calibratedAt && now - cfg.calibratedAt < 86400000) return;
      if (!cfg.apiEndpoint || !cfg.model) return;
      const apiKey = await getApiKeyFromStorage();
      if (!apiKey) return;
      if (self.qwenProviders && self.qwenProviders.ensureProviders) {
        try { await self.qwenProviders.ensureProviders(); } catch {}
      }
      const translate = async txt => {
        await self.qwenTranslate({ endpoint: cfg.apiEndpoint, apiKey, model: cfg.model, provider: 'qwen', text: txt, source: 'en', target: 'en', stream: false, noProxy: true });
      };
      let reqLim = cfg.requestLimit;
      let tokLim = cfg.tokenLimit;
      try { reqLim = await self.qwenLimitDetector.detectRequestLimit(translate, { start: 5, max: 20 }); }
      catch (e) { logger.warn('request limit calibration failed', e.message); }
      try { tokLim = await self.qwenLimitDetector.detectTokenLimit(translate, { start: 512, max: 8192 }); }
      catch (e) { logger.warn('token limit calibration failed', e.message); }
      const update = { requestLimit: reqLim, tokenLimit: tokLim, calibratedAt: now };
      chrome.storage.sync.set(update, () => {});
      ensureThrottle().then(() => { self.qwenThrottle.configure({ requestLimit: reqLim, tokenLimit: tokLim }); });
      safeSendMessage({ action: 'calibration-result', result: update });
    } catch (e) { logger.warn('calibration error', e); }
  });
}

if (chrome?.storage?.sync) {
  chrome.storage.sync.get({ calibratedAt: 0 }, ({ calibratedAt }) => {
    if (!calibratedAt) calibrateLimits(true);
  });
}

function localDetectLanguage(text, minLength = 0) {
  const s = String(text || '');
  const total = s.replace(/\s+/g, '').length;
  if (total < minLength) return { lang: undefined, confidence: 0 };
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
  if (max === 0) return { lang: undefined, confidence: 0 };
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

function scoreConfidence(src, translated) {
  const s = String(src || '');
  const t = String(translated || '');
  if (!s || !t) return 0;
  const ratio = Math.min(s.length, t.length) / Math.max(s.length, t.length);
  return Math.round(ratio * 100) / 100;
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
      files: ['styles/apple.css'],
    });
  } catch (e) {
    // best-effort; contentScript will also attempt to add a <link> fallback
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['i18n/index.js', 'lib/logger.js', 'lib/messaging.js', 'lib/batchDelim.js', 'lib/providers.js', 'providers/openai.js', 'providers/openrouter.js', 'providers/deepl.js', 'providers/dashscope.js', 'lib/glossary.js', 'lib/tm.js', 'lib/detect.js', 'lib/feedback.js', 'lib/offline.js', 'config.js', 'throttle.js', 'translator.js', 'contentScript.js'],
    });
  } catch (e) {
    // Tab may have been closed; ignore injection failure
  }
}
async function ensureInjected(tabId) {
  const present = await new Promise(res => {
    try { chrome.tabs.sendMessage(tabId, { action: 'test-read' }, handleLastError(r => res(!!(r && r.title)))); }
    catch { res(false); }
  });
  if (!present) await injectContentScripts(tabId);
}
async function ensureInjectedAndStart(tabId) {
  await ensureInjected(tabId);
  try { chrome.tabs.sendMessage(tabId, { action: 'start' }, handleLastError()); } catch {}
}
async function maybeAutoInject(tabId, url) {
  if (!urlEligible(url)) return;
  const tabInfo = await new Promise(resolve => {
    try {
      chrome.tabs.get(tabId, t => {
        if (chrome.runtime.lastError) resolve(null); else resolve(t);
      });
    } catch {
      resolve(null);
    }
  });
  if (!tabInfo || !tabInfo.active) return;
  const pattern = originPattern(url);
  if (!pattern) return;
  const cfg = await new Promise(r => chrome.storage.sync.get({ autoTranslate: false }, r));
  if (!cfg.autoTranslate) return;
  const has = await hasOriginPermission(pattern);
  if (!has) return;
  await ensureInjectedAndStart(tabId);
}

function createContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
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
  } catch {}
}

createContextMenus();

chrome.runtime.onInstalled.addListener(details => {
  createContextMenus();
  if (details?.reason === 'update') {
    const version = chrome.runtime.getManifest?.().version;
    logger.info('TRANSLATE! by Mikko updated', version);
    if (chrome.notifications?.create) {
      const id = 'qwen-update';
      try {
        chrome.notifications.onClicked?.addListener(nid => {
          if (nid === id) {
            try { chrome.tabs?.create({ url: 'https://github.com/QwenLM/translate-by-mikko/releases/latest' }); } catch {}
          }
        });
        chrome.notifications.create(id, {
          type: 'basic',
          iconUrl: 'icon-128.png',
          title: 'TRANSLATE! by Mikko updated',
          message: `Updated to version ${version}`,
        });
      } catch {}
    } else if (chrome.action?.setBadgeText) {
      try {
        chrome.action.setBadgeText({ text: version });
        setTimeout(() => { try { chrome.action.setBadgeText({ text: '' }); } catch {} }, 5000);
      } catch {}
    }
  } else {
    logger.info('TRANSLATE! by Mikko installed');
  }
});
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(createContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;
  if (info.menuItemId === 'qwen-translate-selection') {
    await ensureInjected(tabId);
    try { chrome.tabs.sendMessage(tabId, { action: 'translate-selection' }, handleLastError()); } catch {}
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
let iconError = false;
let translationStatus = { active: false };
let etaMs = null;
const inflight = new Map(); // requestId -> { controller, timeout, port }
const providersUsage = new Map(); // provider -> { reqTimes:[], tokTimes:[], totalReq:0, totalTok:0, avoidedReq:0, avoidedTok:0 }

// Test-accessible state
let usingPlus = false;
let config = { providerOrder: [], requestThreshold: 0, qualityVerify: false, translateTimeoutMs: TRANSLATE_TIMEOUT_MS };
const usageStats = { models: {} };
const usageLog = [];
let lastQuality = 0;
let cacheStats = {};
let tmStats = {};

function logUsage(tokens, latency) {
  const entry = { ts: Date.now(), tokens, latency };
  usageLog.push(entry);
  try { self.qwenThrottle.recordUsage(tokens); } catch {}
  safeSendMessage({ action: 'usage-metrics', data: entry });
  try {
    chrome.storage.local.get({ usageLog: [] }, data => {
      const log = data.usageLog || [];
      log.push(entry);
      // keep the log from growing without bound
      if (log.length > 1000) log.shift();
      chrome.storage.local.set({ usageLog: log });
    });
  } catch {}
}

function setUsingPlus(v) { usingPlus = !!v; }
function _setActiveTranslations(n) { activeTranslations = n; }
function _setConfig(c) { config = { ...config, ...c }; }

function getAggregatedStats() {
  const { totalRequests, totalTokens, tokenLimit, tokens } = self.qwenThrottle.getUsage();
  const remaining = Math.max(0, tokenLimit - tokens);
  const totalLatency = usageLog.reduce((sum, e) => sum + (e.latency || 0), 0);
  const totalLoggedTokens = usageLog.reduce((sum, e) => sum + (e.tokens || 0), 0);
  const avgThroughput = totalLatency ? totalLoggedTokens / totalLatency : 0; // tokens per ms
  const eta = avgThroughput ? (remaining / avgThroughput) / 1000 : 0; // seconds
  const avgLatency = usageLog.length ? totalLatency / usageLog.length : 0;
  const lat = usageLog.map(e => e.latency || 0).filter(n => Number.isFinite(n) && n >= 0).slice(-200).sort((a,b)=>a-b);
  const pct = p => lat.length ? lat[Math.min(lat.length-1, Math.max(0, Math.floor(p*(lat.length-1))))] : 0;
  const p50 = pct(0.5), p95 = pct(0.95);
  return { requests: totalRequests, tokens: totalTokens, eta, avgLatency, p50, p95, quality: lastQuality };
}

function broadcastStats() {
  ensureThrottle().then(() => {
    const usage = self.qwenThrottle.getUsage();
    const cache = {
      size: cacheStats.size != null ? cacheStats.size : (self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0),
      max: cacheStats.max != null ? cacheStats.max : ((self.qwenConfig && self.qwenConfig.memCacheMax) || 0),
      hits: cacheStats.hits || 0,
      misses: cacheStats.misses || 0,
      hitRate: cacheStats.hitRate || 0,
    };
    const tm = Object.keys(tmStats).length ? tmStats : ((self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {});
    const models = {};
    const now = Date.now();
    Object.entries(usageStats.models).forEach(([name, s]) => {
      s.requestTimes = (s.requestTimes || []).filter(t => now - t < 60000);
      s.tokenTimes = (s.tokenTimes || []).filter(t => now - t.time < 60000);
      models[name] = {
        requests: s.requestTimes.length,
        requestLimit: s.requestLimit,
        tokens: s.tokenTimes.reduce((sum, t) => sum + t.tokens, 0),
        tokenLimit: s.tokenLimit,
      };
    });
    const prov = {};
    const now2 = Date.now();
    for (const [name, p] of providersUsage.entries()) {
      p.reqTimes = (p.reqTimes || []).filter(t => now2 - t < 60000);
      p.tokTimes = (p.tokTimes || []).filter(t => now2 - t.time < 60000);
      prov[name] = {
        requests: p.reqTimes.length,
        tokens: (p.tokTimes || []).reduce((s, t) => s + (t.tokens || 0), 0),
        totalRequests: p.totalReq || 0,
        totalTokens: p.totalTok || 0,
        avoidedRequests: p.avoidedReq || 0,
        avoidedTokens: p.avoidedTok || 0,
      };
    }
    safeSendMessage({ action: 'stats', usage, cache, tm, models, providers: prov });
    safeSendMessage({ action: 'home:update-usage', usage, active: translationStatus.active, models, providers: prov });
  });
}

function broadcastEta() {
  safeSendMessage({ action: 'translation-status', etaMs });
}

async function updateIcon() {
  await ensureThrottle();
  const { requests, requestLimit, tokens, tokenLimit } = self.qwenThrottle.getUsage();
  const reqPct = requestLimit ? requests / requestLimit : 0;
  const tokPct = tokenLimit ? tokens / tokenLimit : 0;
  const pct = Math.min(Math.max(reqPct, tokPct), 1);
  const busy = activeTranslations > 0;

  const size = 128;
  let c, ctx;
  if (typeof OffscreenCanvas !== 'undefined') {
    c = new OffscreenCanvas(size, size);
    ctx = c.getContext('2d');
  } else if (typeof document !== 'undefined') {
    c = document.createElement('canvas');
    c.width = c.height = size;
    ctx = c.getContext('2d');
  } else return;
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);

  // background ring
  const ringWidth = 12;
  const ringR = size / 2 - ringWidth;
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = '#c0c0c0';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, ringR, 0, 2 * Math.PI);
  ctx.stroke();

  // usage progress ring
  const progressColor = self.qwenUsageColor ? self.qwenUsageColor(pct) : '#00ff00';
  ctx.strokeStyle = progressColor;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, ringR, -Math.PI / 2, -Math.PI / 2 + pct * 2 * Math.PI);
  ctx.stroke();

  // central translation icon
  if (ctx.fillText) {
    ctx.font = `${size * 0.55}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText('🌐', size / 2, size / 2 + 4);
  }

  // status dot overlay
  const dotR = size * 0.12;
  let statusColor = '#808080';
  if (iconError) statusColor = '#ff1744';
  else if (busy) statusColor = '#00c853';
  ctx.fillStyle = statusColor;
  ctx.beginPath();
  ctx.arc(size * 0.85, size * 0.15, dotR, 0, 2 * Math.PI);
  ctx.fill();

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
broadcastStats();
setInterval(broadcastStats, 1000);
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

async function selectProvider(p, providerOrder) {
  const base = providerOrder && providerOrder.length ? providerOrder : config.providerOrder;
  const order = base && base.length
    ? base.slice(base.indexOf(p))
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
  const { endpoint, apiKey, model, secondaryModel, text, source, target, debug, providerOrder, endpoints, failover, parallel } = opts;
  const provider = await selectProvider(opts.provider || 'qwen', providerOrder);
  const epBase = (endpoints && endpoints[provider]) || endpoint;
  const ep = epBase.endsWith('/') ? epBase : `${epBase}/`;
  if (debug) logger.debug('background translating via', ep, 'provider', provider);

  await ensureThrottle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.translateTimeoutMs || TRANSLATE_TIMEOUT_MS);
  activeTranslations++;
  updateBadge();

  const start = Date.now();
  const tokens = self.qwenThrottle.approxTokens(text || '');
  // Track per-provider usage including avoided via cache
  const pu = providersUsage.get(provider) || { reqTimes: [], tokTimes: [], totalReq: 0, totalTok: 0, avoidedReq: 0, avoidedTok: 0 };
  providersUsage.set(provider, pu);
  let servedFromCache = false;
  try { servedFromCache = !!(self.qwenIsCached && self.qwenIsCached({ source, target, text })); } catch {}
  const chars = Array.isArray(text)
    ? text.reduce((s, t) => s + (t ? t.length : 0), 0)
    : (text || '').length;
  const globalUsage = self.qwenThrottle.getUsage ? self.qwenThrottle.getUsage() : {};
  usageStats.models[model] =
    usageStats.models[model] || {
      requests: 0,
      chars: 0,
      requestTimes: [],
      tokenTimes: [],
      requestLimit: globalUsage.requestLimit,
      tokenLimit: globalUsage.tokenLimit,
    };
  const m = usageStats.models[model];
  m.requests++;
  m.chars += chars;
  const now = Date.now();
  m.requestTimes.push(now);
  m.tokenTimes.push({ time: now, tokens });
  try {
    const storedKey = await getApiKeyFromStorage();
    const result = await self.qwenTranslate({
      endpoint: ep,
      apiKey: storedKey,
      model,
      secondaryModel,
      provider,
      text,
      source,
      target,
      debug,
      signal: controller.signal,
      stream: false,
      noProxy: true,
      providerOrder,
      endpoints,
      failover,
      parallel,
    });
    const cost = tokens * (COST_RATES[model] || 0);
    chrome.storage.local.get({ usageHistory: [] }, data => {
      const hist = data.usageHistory || [];
      hist.push({ ts: Date.now(), model, provider: 'qwen', cost });
      chrome.storage.local.set({ usageHistory: hist });
    });
    if (debug) logger.debug('background translation completed');
    // Update per-provider counters
    if (servedFromCache) {
      pu.avoidedReq += 1;
      pu.avoidedTok += tokens;
    } else {
      const now3 = Date.now();
      pu.reqTimes.push(now3);
      pu.tokTimes.push({ time: now3, tokens });
      pu.totalReq += 1;
      pu.totalTok += tokens;
    }
    logUsage(tokens, Date.now() - start);
    let confidence = scoreConfidence(text, result && result.text);
    if (config.qualityVerify && self.qwenQualityCheck && self.qwenQualityCheck.verify) {
      try {
        const qc = await self.qwenQualityCheck.verify({ text, source, target, provider, endpoint: ep, model, apiKey: storedKey, providerOrder: config.providerOrder, endpoints });
        if (qc && typeof qc.score === 'number') {
          confidence = qc.score;
          lastQuality = confidence;
        } else {
          lastQuality = 0;
        }
      } catch (e) {
        logger.warn('quality check failed', e);
        lastQuality = 0;
      }
    } else {
      lastQuality = 0;
    }
    iconError = false;
    return { ...result, confidence };
  } catch (err) {
    logger.error('background translation error', err);
    logUsage(tokens, Date.now() - start);
    iconError = true;
    const offline = isOfflineError(err);
    if (offline) {
      try { chrome.runtime.sendMessage({ action: 'translation-status', status: { offline: true } }); } catch {}
      return { error: 'offline' };
    }
    return { error: err.message };
  } finally {
    clearTimeout(timeout);
    activeTranslations--;
    updateBadge();
    broadcastStats();
  }
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  try {
    const v = (self.qwenMessaging && self.qwenMessaging.validateMessage) ? self.qwenMessaging.validateMessage(raw) : { ok:true, msg: raw };
    if (!v.ok) { sendResponse({ error: v.error || 'invalid message' }); return true; }
    var msg = v.msg;
  } catch {
    sendResponse({ error: 'invalid message' });
    return true;
  }
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
  if (msg.action === 'get-usage-log') {
    sendResponse({ log: usageLog });
    return true;
  }
  if (msg.action === 'set-config') {
    const c = msg.config || {};
    if (typeof c.memCacheMax === 'number' && c.memCacheMax > 0) {
      self.qwenConfig = self.qwenConfig || {};
      self.qwenConfig.memCacheMax = c.memCacheMax;
    }
    if (typeof c.requestLimit === 'number' || typeof c.tokenLimit === 'number') {
      ensureThrottle().then(() => {
        const opts = {};
        if (typeof c.requestLimit === 'number') opts.requestLimit = c.requestLimit;
        if (typeof c.tokenLimit === 'number') opts.tokenLimit = c.tokenLimit;
        self.qwenThrottle.configure(opts);
      });
    }
    if (typeof c.qualityVerify === 'boolean') config.qualityVerify = c.qualityVerify;
    if (typeof c.translateTimeoutMs === 'number') config.translateTimeoutMs = c.translateTimeoutMs;
    if (typeof c.tmSync === 'boolean' && self.qwenTM && self.qwenTM.enableSync) {
      self.qwenTM.enableSync(c.tmSync);
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'clear-remote-tm') {
    if (self.qwenTM && self.qwenTM.clearRemote) { self.qwenTM.clearRemote(); }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'tm-get-all') {
    (async () => {
      const entries = self.qwenTM && self.qwenTM.getAll ? await self.qwenTM.getAll() : [];
      const stats = self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : {};
      sendResponse({ entries, stats });
    })();
    return true;
  }
  if (msg.action === 'tm-stats') {
    (async () => {
      const stats = self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : {};
      sendResponse({ stats });
    })();
    return true;
  }
  if (msg.action === 'tm-clear') {
    (async () => {
      if (self.qwenTM && self.qwenTM.clear) { await self.qwenTM.clear(); }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg.action === 'tm-import') {
    (async () => {
      const list = (msg && msg.entries && Array.isArray(msg.entries)) ? msg.entries : [];
      if (self.qwenTM && self.qwenTM.clear && self.qwenTM.set) {
        try {
          await self.qwenTM.clear();
          for (const item of list) {
            if (item && typeof item.k === 'string' && typeof item.text === 'string') {
              await self.qwenTM.set(item.k, item.text);
            }
          }
        } catch {}
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg.action === 'debug') {
    const cache = {
      size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
      max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
    };
    const tm = (self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {};
    sendResponse({ cache, tm });
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
  if (msg.action === 'metrics') {
    ensureThrottle().then(() => {
      const usage = self.qwenThrottle.getUsage();
      const cache = {
        size: cacheStats.size != null ? cacheStats.size : (self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0),
        max: cacheStats.max != null ? cacheStats.max : ((self.qwenConfig && self.qwenConfig.memCacheMax) || 0),
        hits: cacheStats.hits || 0,
        misses: cacheStats.misses || 0,
        hitRate: cacheStats.hitRate || 0,
      };
      const tm = Object.keys(tmStats).length ? tmStats : ((self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {});
      chrome.storage.sync.get({ providers: {} }, cfg => {
        const providers = {};
        Object.entries(cfg.providers || {}).forEach(([id, p]) => {
          providers[id] = {
            apiKey: !!p.apiKey,
            model: p.model || '',
            endpoint: p.apiEndpoint || '',
          };
        });
        // Build providers usage snapshot
        const provUsage = {};
        const now = Date.now();
        for (const [name, pu] of providersUsage.entries()) {
          const rt = (pu.reqTimes || []).filter(t => now - t < 60000);
          const tt = (pu.tokTimes || []).filter(t => now - t.time < 60000);
          provUsage[name] = {
            requests: rt.length,
            tokens: tt.reduce((s, t) => s + (t.tokens || 0), 0),
            totalRequests: pu.totalReq || 0,
            totalTokens: pu.totalTok || 0,
            avoidedRequests: pu.avoidedReq || 0,
            avoidedTokens: pu.avoidedTok || 0,
          };
        }
          sendResponse({ usage, cache, tm, providers, providersUsage: provUsage, status: translationStatus });
      });
    });
    return true;
  }
  if (msg.action === 'metrics-v1') {
    ensureThrottle().then(() => {
      const usage = self.qwenThrottle.getUsage();
      const cache = {
        size: cacheStats.size != null ? cacheStats.size : (self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0),
        max: cacheStats.max != null ? cacheStats.max : ((self.qwenConfig && self.qwenConfig.memCacheMax) || 0),
        hits: cacheStats.hits || 0,
        misses: cacheStats.misses || 0,
        hitRate: cacheStats.hitRate || 0,
      };
      const tm = Object.keys(tmStats).length ? tmStats : ((self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {});
      const providers = {};
      const now = Date.now();
      for (const [name, pu] of providersUsage.entries()) {
        const rt = (pu.reqTimes || []).filter(t => now - t < 60000);
        const tt = (pu.tokTimes || []).filter(t => now - t.time < 60000);
        providers[name] = {
          window: { requests: rt.length, tokens: tt.reduce((s, t) => s + (t.tokens || 0), 0) },
          totals: { requests: pu.totalReq || 0, tokens: pu.totalTok || 0 },
          saved: { requests: pu.avoidedReq || 0, tokens: pu.avoidedTok || 0 },
        };
      }
      const agg = getAggregatedStats();
      const out = {
        version: 1,
        usage,
        providers,
        cache,
        tm,
        quality: { last: agg.quality, avgLatencyMs: agg.avgLatency, p50Ms: agg.p50, p95Ms: agg.p95, etaSeconds: Math.round(agg.eta || 0) },
        errors: {},
        status: translationStatus,
      };
      sendResponse(out);
    });
    return true;
  }
  if (msg.action === 'getProviders') {
    // Ensure providers are initialized
    if (self.qwenProviders && self.qwenProviders.ensureProviders) {
      self.qwenProviders.ensureProviders();
    }
    
    // Get list of available providers
    let providers = [];
    if (self.qwenProviders && self.qwenProviders.listProviders) {
      providers = self.qwenProviders.listProviders().map(p => ({
        id: p.name,
        name: p.label || p.name
      }));
    } else {
      // Fallback to default providers
      providers = [
        { id: 'qwen', name: 'Qwen' },
        { id: 'google', name: 'Google' },
        { id: 'deepl', name: 'DeepL' },
        { id: 'openai', name: 'OpenAI' }
      ];
    }
    
    sendResponse({ providers });
    return true;
  }
  if (msg.action === 'tm-cache-metrics') {
    const tmMetrics = (self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {};
    const cacheStats = self.qwenGetCacheStats ? self.qwenGetCacheStats() : {};
    sendResponse({ tmMetrics, cacheStats });
    return true;
  }
  if (msg.action === 'quota') {
    const model = msg.model;
    const cfg = self.qwenConfig || {};
    const prov = self.qwenProviders && self.qwenProviders.getProvider && self.qwenProviders.getProvider('qwen');
    if (prov && prov.getQuota) {
      prov.getQuota({
        endpoint: (cfg.providers && cfg.providers.qwen && cfg.providers.qwen.apiEndpoint) || cfg.apiEndpoint,
        apiKey: (cfg.providers && cfg.providers.qwen && cfg.providers.qwen.apiKey) || cfg.apiKey,
        model: model || cfg.model,
        debug: cfg.debug,
      }).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;
    }
    sendResponse({ error: 'provider unavailable' });
    return true;
  }
  if (msg.action === 'detect') {
    const opts = msg.opts || {};
    (async () => {
      try {
        const sample = String(opts.text || '');
        let out;
        if (sample.replace(/\s+/g, '').length < (opts.minLength || 0)) {
          out = { lang: undefined, confidence: 0 };
        } else {
          out = opts.detector === 'google'
            ? await googleDetectLanguage(opts.text, opts.debug)
            : localDetectLanguage(opts.text, opts.minLength);
        }
        sendResponse(out);
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  if (msg.action === 'translation-status') {
    translationStatus = msg.status || { active: false };
    if (msg.status && msg.status.summary) {
      const s = msg.status.summary;
      try {
        if (typeof s.tokens === 'number') {
          self.qwenThrottle.recordUsage(s.tokens, s.requests || 1);
        }
      } catch {}
      if (s.cache) cacheStats = s.cache;
      if (s.tm) tmStats = s.tm;
    }
    if (msg.status && typeof msg.status.etaMs === 'number') {
      etaMs = msg.status.etaMs;
      broadcastEta();
    } else if (!translationStatus.active) {
      etaMs = null;
      broadcastEta();
    }
    broadcastStats();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'get-status') {
    sendResponse(translationStatus);
    return true;
  }
  if (msg.action === 'get-stats') {
    ensureThrottle().then(() => {
      sendResponse(getAggregatedStats());
    });
    return true;
  }
  if (msg.action === 'recalibrate') {
    ensureThrottle().then(() => {
      self.qwenThrottle.configure({ requestLimit: 60, tokenLimit: 31980 });
    });
    calibrateLimits(true);
    sendResponse({ ok: true });
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
      const timeout = setTimeout(() => controller.abort(), config.translateTimeoutMs || TRANSLATE_TIMEOUT_MS);
      activeTranslations++;
      updateBadge();
      inflight.set(requestId, { controller, timeout, port });
      const ep = opts.endpoint && opts.endpoint.endsWith('/') ? opts.endpoint : (opts.endpoint ? opts.endpoint + '/' : opts.endpoint);
      const storedKey = await getApiKeyFromStorage();
      const safeOpts = { ...opts, endpoint: ep, apiKey: storedKey, signal: controller.signal, noProxy: true };
      const start = Date.now();
      const tokens = self.qwenThrottle.approxTokens(safeOpts.text || '');
      try {
        if (opts && opts.stream) {
          const result = await self.qwenTranslateStream(safeOpts, chunk => {
            try { port.postMessage({ requestId, chunk }); } catch {}
          });
          let confidence = scoreConfidence(opts.text, result && result.text);
          if (config.qualityVerify && self.qwenQualityCheck && self.qwenQualityCheck.verify) {
            try {
              const qc = await self.qwenQualityCheck.verify({ text: opts.text, source: opts.source, target: opts.target, provider: safeOpts.provider, endpoint: safeOpts.endpoint, model: safeOpts.model, apiKey: storedKey, providerOrder: config.providerOrder, endpoints: opts.endpoints });
              if (qc && typeof qc.score === 'number') {
                confidence = qc.score;
                lastQuality = confidence;
              } else {
                lastQuality = 0;
              }
            } catch (e) {
              logger.warn('quality check failed', e);
              lastQuality = 0;
            }
          } else {
            lastQuality = 0;
          }
          try { port.postMessage({ requestId, result: { ...result, confidence } }); } catch {}
        } else {
          const result = await self.qwenTranslate(safeOpts);
          let confidence = scoreConfidence(opts.text, result && result.text);
          if (config.qualityVerify && self.qwenQualityCheck && self.qwenQualityCheck.verify) {
            try {
              const qc = await self.qwenQualityCheck.verify({ text: opts.text, source: opts.source, target: opts.target, provider: safeOpts.provider, endpoint: safeOpts.endpoint, model: safeOpts.model, apiKey: storedKey, providerOrder: config.providerOrder, endpoints: opts.endpoints });
              if (qc && typeof qc.score === 'number') {
                confidence = qc.score;
                lastQuality = confidence;
              } else {
                lastQuality = 0;
              }
            } catch (e) {
              logger.warn('quality check failed', e);
              lastQuality = 0;
            }
          } else {
            lastQuality = 0;
          }
          try { port.postMessage({ requestId, result: { ...result, confidence } }); } catch {}
        }
        logUsage(tokens, Date.now() - start);
        iconError = false;
      } catch (err) {
        logger.error('background port translation error', err);
        logUsage(tokens, Date.now() - start);
        iconError = true;
        const offline = isOfflineError(err);
        try { port.postMessage({ requestId, error: offline ? 'offline' : err.message }); } catch {}
        if (offline) {
          try { chrome.runtime.sendMessage({ action: 'translation-status', status: { offline: true } }); } catch {}
        }
      } finally {
        clearTimeout(timeout);
        inflight.delete(requestId);
        activeTranslations--;
        updateBadge();
        broadcastStats();
      }
      return;
    }
    if (msg.action === 'detect') {
      const { requestId, opts } = msg;
      if (!requestId || !opts) return;
      try {
        const sample = String(opts.text || '');
        let out;
        if (sample.replace(/\s+/g, '').length < (opts.minLength || 0)) {
          out = { lang: undefined, confidence: 0 };
        } else {
          out = opts.detector === 'google'
            ? await googleDetectLanguage(opts.text, opts.debug)
            : localDetectLanguage(opts.text, opts.minLength);
        }
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
  
  // Home UI actions
  if (msg.action === 'home:init') {
    ensureThrottle().then(() => {
      const usage = self.qwenThrottle.getUsage();
      const cache = {
        size: cacheStats.size != null ? cacheStats.size : (self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0),
        max: cacheStats.max != null ? cacheStats.max : ((self.qwenConfig && self.qwenConfig.memCacheMax) || 0),
        hits: cacheStats.hits || 0,
        misses: cacheStats.misses || 0,
      };
      const tm = {
        hits: (self.qwenTM && self.qwenTM.getMetrics) ? self.qwenTM.getMetrics().hits : 0,
        misses: (self.qwenTM && self.qwenTM.getMetrics) ? self.qwenTM.getMetrics().misses : 0,
      };
      // Build providers usage snapshot
      const provUsage = {};
      const now = Date.now();
      for (const [name, pu] of providersUsage.entries()) {
        const rt = (pu.reqTimes || []).filter(t => now - t < 60000);
        const tt = (pu.tokTimes || []).filter(t => now - t.time < 60000);
        provUsage[name] = {
          requests: rt.length,
          tokens: tt.reduce((s, t) => s + (t.tokens || 0), 0),
          totalRequests: pu.totalReq || 0,
          totalTokens: pu.totalTok || 0,
          avoidedRequests: pu.avoidedReq || 0,
          avoidedTokens: pu.avoidedTok || 0,
        };
      }
      sendResponse({ usage, cache, tm, providers: provUsage, status: translationStatus });
    });
    return true;
  }
  
  if (msg.action === 'home:auto-translate') {
    (async () => {
      try {
        const enabled = !!msg.enabled;
        chrome.storage.sync.set({ autoTranslate: enabled });
        
        if (!enabled) {
          // Stop all active tabs
          chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
              chrome.tabs.sendMessage(tab.id, { action: 'stop' }, () => {
                // Ignore errors from tabs that can't receive messages
                chrome.runtime.lastError;
              });
            }
          });
        }
        sendResponse({ ok: true });
      } catch (error) {
        logger.error('Auto-translate toggle failed:', error);
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }
  
  if (msg.action === 'home:quick-translate') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'translate' }, () => {
            // Ignore errors from tabs that can't receive messages
            chrome.runtime.lastError;
          });
        }
        sendResponse({ ok: true });
      } catch (error) {
        logger.error('Quick translate failed:', error);
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab && tab.url && tab.active) {
    maybeAutoInject(tabId, tab.url);
  }
});

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await new Promise(resolve => {
        chrome.tabs.get(tabId, t => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(t);
        });
      });
      if (tab && tab.url && tab.status === 'complete') {
        maybeAutoInject(tabId, tab.url);
      }
    } catch {}
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    updateBadge,
    setUsingPlus,
    _setActiveTranslations,
    handleTranslate,
    _setConfig,
  };
}
