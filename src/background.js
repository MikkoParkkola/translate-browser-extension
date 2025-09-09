importScripts(
  'core/error-handler.js', 
  'core/provider-loader.js', 
  'core/security.js', 
  'core/secure-storage.js', 
  'core/command-dispatcher.js',
  'core/command-registry.js',
  'commands/translation-command.js',
  'commands/system-commands.js',
  'commands/config-commands.js',
  'commands/translation-memory-commands.js',
  'commands/metrics-commands.js',
  'commands/provider-commands.js',
  'lib/logger.js', 
  'lib/providers.js', 
  'lib/tm.js', 
  'lib/feedback.js', 
  'lib/qualityCheck.js', 
  'lib/offline.js', 
  'lib/messaging.js', 
  'config.js', 
  'throttle.js', 
  'translator.js', 
  'usageColor.js', 
  'findLimit.js', 
  'limitDetector.js', 
  'backgroundBenchmark.js'
);

// Ensure helper is available when importScripts is stubbed (tests)
if (typeof self.isOfflineError === 'undefined' && typeof require === 'function') {
  self.isOfflineError = require('./lib/offline.js').isOfflineError;
}

const logger = (self.qwenLogger && self.qwenLogger.create)
  ? self.qwenLogger.create('background')
  : console;

// Initialize error handler
const errorHandler = self.qwenErrorHandler || {
  handle: (error, _context = {}, fallback) => {
    console.error('Error handler not available:', error);
    return fallback || null;
  },
  handleAsync: async (promise, _context = {}, fallback) => {
    try {
      return await promise;
    } catch (error) {
      console.error('Error handler not available for async operation:', error);
      return fallback || null;
    }
  },
  safe: (fn, _context = {}, fallback) => {
    return (...args) => {
      try {
        return fn.apply(this, args);
      } catch (error) {
        console.error('Error handler not available for safe wrapper:', error);
        return fallback || null;
      }
    };
  },
  isNetworkError: (error) => {
    const message = error?.message || '';
    return message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch');
  },
};


const TRANSLATE_TIMEOUT_MS = (self.qwenDefaultConfig && self.qwenDefaultConfig.translateTimeoutMs) || 20000;


function handleLastError(cb) {
  return (...args) => {
    const err = chrome.runtime.lastError;
    if (err && !err.message.includes('Receiving end does not exist')) logger.debug(err);
    if (typeof cb === 'function') cb(...args);
  };
}


const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let _pendingVersion;
try { chrome.runtime.requestUpdateCheck?.(() => {}); } catch {}
setInterval(() => {
  try { chrome.runtime.requestUpdateCheck?.(() => {}); } catch {}
}, UPDATE_CHECK_INTERVAL);
if (chrome.runtime?.onUpdateAvailable?.addListener) {
  chrome.runtime.onUpdateAvailable.addListener(details => {
    _pendingVersion = details.version;
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

// Helper functions to promisify Chrome APIs
function getChromeStorageSync(keys) {
  return new Promise(resolve => {
    chrome.storage.sync.get(keys, resolve);
  });
}

function getChromeTabsQuery(queryInfo) {
  return new Promise(resolve => {
    chrome.tabs.query(queryInfo, resolve);
  });
}

async function getApiKeyFromStorage() {
  try {
    // Try secure storage first
    if (self.qwenSecureStorage) {
      const secureKey = await self.qwenSecureStorage.getSecureApiKey();
      if (secureKey) return secureKey;
    }

    // Fall back to legacy storage with migration
    const cfg = await getChromeStorageSync({ apiKey: '' });
    const legacyKey = cfg.apiKey || '';

    // If we have a legacy key and secure storage is available, migrate it
    if (legacyKey && self.qwenSecureStorage) {
      try {
        await self.qwenSecureStorage.setSecureApiKey(legacyKey);
        // Clean up legacy storage after successful migration
        chrome.storage.sync.remove(['apiKey']);
      } catch (error) {
        console.warn('Failed to migrate API key to secure storage:', error);
      }
    }

    return legacyKey;
  } catch (error) {
    console.error('Error retrieving API key:', error);
    return '';
  }
}

async function getDetectApiKeyFromStorage() {
  try {
    // Try secure storage first
    if (self.qwenSecureStorage?.secureStorage) {
      const secureKey = await self.qwenSecureStorage.secureStorage.getSecure('detectApiKey');
      if (secureKey) return secureKey;
    }

    // Fall back to legacy storage with migration
    const cfg = await getChromeStorageSync({ detectApiKey: '' });
    const legacyKey = cfg.detectApiKey || '';

    // If we have a legacy key and secure storage is available, migrate it
    if (legacyKey && self.qwenSecureStorage?.secureStorage) {
      try {
        await self.qwenSecureStorage.secureStorage.setSecure('detectApiKey', legacyKey);
        // Clean up legacy storage after successful migration
        chrome.storage.sync.remove(['detectApiKey']);
      } catch (error) {
        console.warn('Failed to migrate detect API key to secure storage:', error);
      }
    }

    return legacyKey;
  } catch (error) {
    console.error('Error retrieving detect API key:', error);
    return '';
  }
}

function safeSendMessage(msg) {
  try {
    chrome.runtime.sendMessage(msg, handleLastError());
  } catch {}
}

function calibrateLimits(force) {
  if (!self.qwenLimitDetector || !chrome?.storage?.sync) return;

  chrome.storage.sync.get({ apiEndpoint: '', model: '', requestLimit: 60, tokenLimit: 100000, calibratedAt: 0 }, async cfg => {
    const now = Date.now();
    if (!force && cfg.calibratedAt && now - cfg.calibratedAt < 86400000) return;
    if (!cfg.apiEndpoint || !cfg.model) return;

    const apiKey = await errorHandler.handleAsync(
      getApiKeyFromStorage(),
      { operation: 'getApiKey', module: 'background' },
      '',
      logger,
    );
    if (!apiKey) return;

    // Load required providers dynamically
    if (self.qwenProviderLoader && self.qwenProviderLoader.loadProvider) {
      await errorHandler.handleAsync(
        self.qwenProviderLoader.loadProvider('dashscope'),
        { operation: 'loadDashScopeProvider', module: 'background' },
        false,
        logger,
      );
    }

    // Ensure providers with error handling
    if (self.qwenProviders && self.qwenProviders.ensureProviders) {
      await errorHandler.handleAsync(
        self.qwenProviders.ensureProviders(),
        { operation: 'ensureProviders', module: 'background' },
        undefined,
        logger,
      );
    }

    const translate = async txt => {
      return errorHandler.handleAsync(
        self.qwenTranslate({
          endpoint: cfg.apiEndpoint,
          apiKey,
          model: cfg.model,
          provider: 'qwen',
          text: txt,
          source: 'en',
          target: 'en',
          stream: false,
          noProxy: true,
        }),
        { operation: 'translate', module: 'background' },
        null,
        logger,
      );
    };

    let reqLim = cfg.requestLimit;
    let tokLim = cfg.tokenLimit;

    // Detect limits with error handling
    const detectedReqLimit = await errorHandler.handleAsync(
      self.qwenLimitDetector.detectRequestLimit(translate, { start: 5, max: 20 }),
      { operation: 'detectRequestLimit', module: 'background' },
      reqLim,
      logger,
    );
    if (detectedReqLimit !== null) reqLim = detectedReqLimit;

    const detectedTokLimit = await errorHandler.handleAsync(
      self.qwenLimitDetector.detectTokenLimit(translate, { start: 512, max: 8192 }),
      { operation: 'detectTokenLimit', module: 'background' },
      tokLim,
      logger,
    );
    if (detectedTokLimit !== null) tokLim = detectedTokLimit;

    const update = { requestLimit: reqLim, tokenLimit: tokLim, calibratedAt: now };

    // Update storage and throttle with error handling
    errorHandler.safe(() => {
      chrome.storage.sync.set(update, () => {});
      ensureThrottle().then(() => {
        self.qwenThrottle.configure({ requestLimit: reqLim, tokenLimit: tokLim });
      });
      safeSendMessage({ action: 'calibration-result', result: update });
    }, { operation: 'updateCalibration', module: 'background' }, undefined, logger)();
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
async function googleDetectLanguage(text, _debug) {
  const key = await errorHandler.handleAsync(
    getDetectApiKeyFromStorage(),
    { operation: 'getDetectApiKey', module: 'background' },
    '',
    logger,
  );
  if (!key) {
    throw errorHandler.enrichError(
      new Error('No API key configured for Google detection'),
      { operation: 'googleDetectLanguage', module: 'background' },
    );
  }

  const url = `https://translation.googleapis.com/language/translate/v2/detect?key=${encodeURIComponent(key)}`;
  const body = new URLSearchParams({ q: String(text || '').slice(0, 2000) });

  const resp = await errorHandler.handleAsync(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }),
    { operation: 'detectLanguageRequest', module: 'background', critical: true },
    null,
    logger,
  );

  if (!resp || !resp.ok) {
    const errText = await errorHandler.handleAsync(
      resp?.text() || Promise.resolve(''),
      { operation: 'readErrorResponse', module: 'background' },
      '',
      logger,
    );
    const err = new Error(`Detect HTTP ${resp?.status || 'unknown'} ${errText || ''}`.trim());
    if (resp?.status >= 500 || resp?.status === 429) err.retryable = true;
    throw errorHandler.enrichError(err, {
      operation: 'googleDetectLanguage',
      module: 'background',
      httpStatus: resp?.status,
    });
  }

  const data = await errorHandler.handleAsync(
    resp.json(),
    { operation: 'parseDetectResponse', module: 'background' },
    {},
    logger,
  );

  const det = data?.data?.detections?.[0]?.[0];
  if (!det || !det.language) {
    throw errorHandler.enrichError(
      new Error('Invalid detect response'),
      { operation: 'googleDetectLanguage', module: 'background', responseData: data },
    );
  }

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
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' || x.protocol === 'file:'; } catch { return false; }
}
function originPattern(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'file:') return 'file:///*';
    return `${x.protocol}//${x.host}/*`;
  } catch { return null; }
}
function hasOriginPermission(pattern) {
  return new Promise(resolve => {
    chrome.permissions.contains({ origins: [pattern] }, g => resolve(!!g));
  });
}
function requestOriginPermission(pattern) {
  return new Promise(resolve => {
    chrome.permissions.request({ origins: [pattern] }, g => resolve(!!g));
  });
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
      files: ['i18n/index.js', 'lib/logger.js', 'lib/messaging.js', 'lib/batchDelim.js', 'lib/providers.js', 'core/provider-loader.js', 'lib/glossary.js', 'lib/tm.js', 'lib/detect.js', 'lib/feedback.js', 'lib/offline.js', 'config.js', 'throttle.js', 'translator.js', 'contentScript.js'],
    });
  } catch (e) {
    // Tab may have been closed; ignore injection failure
  }
}
async function ensureInjected(tabId) {
  const present = await new Promise(res => {
    try { chrome.tabs.sendMessage(tabId, { action: 'test-read' }, handleLastError(r => res(!!(r && r.title)))); } catch { res(false); }
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
  const cfg = await new Promise(r => {
    chrome.storage.sync.get({ autoTranslate: false }, r);
  });
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
      const viewer = `${chrome.runtime.getURL('pdfViewer.html')  }?file=${  encodeURIComponent(url)}`;
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
  const lat = usageLog.map(e => e.latency || 0).filter(n => Number.isFinite(n) && n >= 0).slice(-200).sort((a, b)=>a - b);
  const pct = p => lat.length ? lat[Math.min(lat.length - 1, Math.max(0, Math.floor(p * (lat.length - 1))))] : 0;
  const p50 = pct(0.5), p95 = pct(0.95);
  return { requests: totalRequests, tokens: totalTokens, eta, avgLatency, p50, p95, quality: lastQuality };
}

// Helper functions for broadcastStats
const getCacheStats = () => ({
  size: cacheStats.size != null ? cacheStats.size : (self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0),
  max: cacheStats.max != null ? cacheStats.max : ((self.qwenConfig && self.qwenConfig.memCacheMax) || 0),
  hits: cacheStats.hits || 0,
  misses: cacheStats.misses || 0,
  hitRate: cacheStats.hitRate || 0,
});

const getTranslationMemoryStats = () =>
  Object.keys(tmStats).length ? tmStats : ((self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {});

const processModelStats = () => {
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

  return models;
};

const processProviderStats = () => {
  const prov = {};
  const now = Date.now();

  for (const [name, p] of providersUsage.entries()) {
    p.reqTimes = (p.reqTimes || []).filter(t => now - t < 60000);
    p.tokTimes = (p.tokTimes || []).filter(t => now - t.time < 60000);
    prov[name] = {
      requests: p.reqTimes.length,
      tokens: (p.tokTimes || []).reduce((s, t) => s + (t.tokens || 0), 0),
      totalRequests: p.totalReq || 0,
      totalTokens: p.totalTok || 0,
      avoidedRequests: p.avoidedReq || 0,
      avoidedTokens: p.avoidedTok || 0,
    };
  }

  return prov;
};

const buildProvidersUsageSnapshot = () => processProviderStats();

function broadcastStats() {
  ensureThrottle().then(() => {
    const usage = self.qwenThrottle.getUsage();
    const cache = getCacheStats();
    const tm = getTranslationMemoryStats();
    const models = processModelStats();
    const providers = processProviderStats();

    safeSendMessage({ action: 'stats', usage, cache, tm, models, providers });
    safeSendMessage({ action: 'home:update-usage', usage, active: translationStatus.active, models, providers });
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
        },
      );
    });
  }
  return throttleReady;
}

const COST_RATES = { 'qwen-mt-turbo': 0.00000016, 'google-nmt': 0.00002 };

// Helper functions for selectProvider
const determineProviderOrder = (p, providerOrder) => {
  const base = providerOrder && providerOrder.length ? providerOrder : config.providerOrder;
  return base && base.length ? base.slice(base.indexOf(p)) : [p];
};

const loadProviderIfNeeded = async (name) => {
  if (self.qwenProviderLoader && self.qwenProviderLoader.loadProvider) {
    await errorHandler.handleAsync(
      self.qwenProviderLoader.loadProvider(name),
      { operation: 'loadProvider', module: 'background', provider: name },
      false,
      logger,
    );
  }
};

const checkProviderQuota = async (providerName) => {
  const prov = self.qwenProviders && self.qwenProviders.getProvider && self.qwenProviders.getProvider(providerName);
  if (!prov) return false;

  if (!prov.getQuota) return true; // No quota check needed

  try {
    const q = await prov.getQuota();
    return !q || !q.remaining || q.remaining.requests > (config.requestThreshold || 0);
  } catch {
    return false; // Quota check failed
  }
};

async function selectProvider(p, providerOrder) {
  const order = determineProviderOrder(p, providerOrder);

  for (const name of order) {
    await loadProviderIfNeeded(name);

    if (await checkProviderQuota(name)) {
      return name;
    }
  }

  return p;
}

// Helper functions for handleTranslate
const setupUsageTracking = (provider, model, text, tokens) => {
  const pu = providersUsage.get(provider) || { reqTimes: [], tokTimes: [], totalReq: 0, totalTok: 0, avoidedReq: 0, avoidedTok: 0 };
  providersUsage.set(provider, pu);

  let servedFromCache = false;
  try { servedFromCache = !!(self.qwenIsCached && self.qwenIsCached({ source: undefined, target: undefined, text })); } catch {}

  const chars = Array.isArray(text) ? text.reduce((s, t) => s + (t ? t.length : 0), 0) : (text || '').length;
  const globalUsage = self.qwenThrottle.getUsage ? self.qwenThrottle.getUsage() : {};

  usageStats.models[model] = usageStats.models[model] || {
    requests: 0, chars: 0, requestTimes: [], tokenTimes: [],
    requestLimit: globalUsage.requestLimit, tokenLimit: globalUsage.tokenLimit,
  };

  const m = usageStats.models[model];
  m.requests++;
  m.chars += chars;
  const now = Date.now();
  m.requestTimes.push(now);
  m.tokenTimes.push({ time: now, tokens });

  return { pu, servedFromCache };
};

const storeUsageHistory = (tokens, model, cost) => {
  errorHandler.safe(() => {
    chrome.storage.local.get({ usageHistory: [] }, data => {
      const hist = data.usageHistory || [];
      hist.push({ ts: Date.now(), model, provider: 'qwen', cost });
      chrome.storage.local.set({ usageHistory: hist });
    });
  }, { operation: 'storeUsageHistory', module: 'background' }, undefined, logger)();
};

const updateProviderCounters = (pu, tokens, servedFromCache) => {
  if (servedFromCache) {
    pu.avoidedReq += 1;
    pu.avoidedTok += tokens;
  } else {
    const now = Date.now();
    pu.reqTimes.push(now);
    pu.tokTimes.push({ time: now, tokens });
    pu.totalReq += 1;
    pu.totalTok += tokens;
  }
};

const performQualityCheck = async (text, result, storedKey, provider, ep, model, config) => {
  let confidence = scoreConfidence(text, result && result.text);

  if (config.qualityVerify && self.qwenQualityCheck && self.qwenQualityCheck.verify) {
    const qc = await errorHandler.handleAsync(
      self.qwenQualityCheck.verify({
        text, source: undefined, target: undefined, provider,
        endpoint: ep, model, apiKey: storedKey,
        providerOrder: config.providerOrder, endpoints: undefined,
      }),
      { operation: 'qualityCheck', module: 'background' },
      null,
      logger,
    );

    if (qc && typeof qc.score === 'number') {
      confidence = qc.score;
      lastQuality = confidence;
    } else {
      lastQuality = 0;
    }
  } else {
    lastQuality = 0;
  }

  return confidence;
};

async function handleTranslate(opts) {
  const { endpoint, apiKey: _apiKey, model, secondaryModel, text, source, target, debug, providerOrder, endpoints, failover, parallel } = opts;
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
  const { pu, servedFromCache } = setupUsageTracking(provider, model, text, tokens);

  try {
    const storedKey = await errorHandler.handleAsync(
      getApiKeyFromStorage(),
      { operation: 'getApiKey', module: 'background' },
      '',
      logger,
    );

    let result;
    try {
      result = await self.qwenTranslate({
        endpoint: ep, apiKey: storedKey, model, secondaryModel, provider,
        text, source, target, debug, signal: controller.signal,
        stream: false, noProxy: true, providerOrder, endpoints, failover, parallel,
      });
    } catch (translateError) {
      // Handle different error types
      const offline = errorHandler.isNetworkError(translateError) || isOfflineError(translateError);
      if (offline) {
        errorHandler.safe(() => {
          chrome.runtime.sendMessage({ action: 'translation-status', status: { offline: true } });
        }, { operation: 'sendOfflineStatus', module: 'background' }, undefined, logger)();
        return { error: 'offline' };
      }
      
      // Handle abort errors (timeouts)
      if (translateError.message === 'aborted' || translateError.name === 'AbortError') {
        return { error: 'aborted' };
      }
      
      // For other errors, use fallback
      result = { text: '', error: 'Translation failed' };
    }

    const cost = tokens * (COST_RATES[model] || 0);
    storeUsageHistory(tokens, model, cost);

    if (debug) logger.debug('background translation completed');

    updateProviderCounters(pu, tokens, servedFromCache);
    logUsage(tokens, Date.now() - start);

    const confidence = await performQualityCheck(text, result, storedKey, provider, ep, model, config);

    iconError = false;
    return { ...result, confidence };

  } catch (err) {
    const _handledError = errorHandler.handle(err, {
      operation: 'handleTranslate', module: 'background', provider, model,
    }, null, logger);

    logUsage(tokens, Date.now() - start);
    iconError = true;

    // Offline errors are already handled in the main try-catch above
    // This catch handles other errors like timeouts, validation failures, etc.

    return { error: err.message || 'Translation failed' };
  } finally {
    clearTimeout(timeout);
    activeTranslations--;
    updateBadge();
    broadcastStats();
  }
}

// Rate limiting system for message handler
const messageRateLimit = (() => {
  const requestCounts = new Map();
  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS_PER_WINDOW = 1000; // Aggressive rate limit

  return (senderId) => {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    if (!requestCounts.has(senderId)) {
      requestCounts.set(senderId, []);
    }

    const requests = requestCounts.get(senderId);

    // Remove old requests outside the window
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);
    requestCounts.set(senderId, recentRequests);

    // Check if rate limit exceeded
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
      return false;
    }

    // Add current request
    recentRequests.push(now);
    return true;
  };
})();

// Security monitoring and audit system
const securityAudit = (() => {
  const events = [];
  const MAX_EVENTS = 1000;

  const logEvent = (eventType, details) => {
    const event = {
      timestamp: Date.now(),
      type: eventType,
      details: details,
      userAgent: navigator.userAgent,
    };

    events.push(event);

    // Keep only recent events
    if (events.length > MAX_EVENTS) {
      events.shift();
    }

    // Log critical security events
    if (['malicious_input_blocked', 'rate_limit_exceeded', 'suspicious_pattern_detected'].includes(eventType)) {
      console.warn('[SECURITY ALERT]', eventType, details);
    }
  };

  const getAuditLog = () => events.slice(-100); // Return last 100 events

  const validateCSPCompliance = () => {
    try {
      // Check if we're running in a secure context
      if (!self.isSecureContext) {
        logEvent('csp_violation', { issue: 'not_secure_context' });
        return false;
      }

      // Validate that crypto is available (CSP allows unsafe-eval for crypto)
      if (!self.crypto || !self.crypto.subtle) {
        logEvent('csp_violation', { issue: 'crypto_unavailable' });
        return false;
      }

      return true;
    } catch (error) {
      logEvent('csp_validation_error', { error: error.message });
      return false;
    }
  };

  // Initialize CSP validation
  validateCSPCompliance();

  return { logEvent, getAuditLog, validateCSPCompliance };
})();

// Message Action Handlers
const messageHandlers = {
  async translate(msg, sendResponse) {
    const result = await errorHandler.handleAsync(
      handleTranslate(msg.opts),
      { operation: 'translateMessage', module: 'background' },
      { error: 'Translation request failed' },
      logger,
    );
    sendResponse(result);
    return true;
  },

  ping(msg, sendResponse) {
    if (msg.debug) logger.debug('ping received');
    sendResponse({ ok: true });
    return true;
  },

  'get-usage-log'(msg, sendResponse) {
    sendResponse({ log: usageLog });
    return true;
  },

  'get-security-audit'(msg, sendResponse) {
    sendResponse({
      auditLog: securityAudit.getAuditLog(),
      cspCompliant: securityAudit.validateCSPCompliance(),
      timestamp: Date.now(),
    });
    return true;
  },

  'set-config'(msg, sendResponse) {
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
  },

  'clear-remote-tm'(msg, sendResponse) {
    if (self.qwenTM && self.qwenTM.clearRemote) { self.qwenTM.clearRemote(); }
    sendResponse({ ok: true });
    return true;
  },

  async 'tm-get-all'(msg, sendResponse) {
    const entries = self.qwenTM && self.qwenTM.getAll ? await self.qwenTM.getAll() : [];
    const stats = self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : {};
    sendResponse({ entries, stats });
    return true;
  },

  async 'tm-stats'(msg, sendResponse) {
    const stats = self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : {};
    sendResponse({ stats });
    return true;
  },

  async 'tm-clear'(msg, sendResponse) {
    if (self.qwenTM && self.qwenTM.clear) { await self.qwenTM.clear(); }
    sendResponse({ ok: true });
    return true;
  },

  async 'tm-import'(msg, sendResponse) {
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
    return true;
  },

  debug(msg, sendResponse) {
    const cache = {
      size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
      max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
    };
    const tm = (self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {};
    sendResponse({ cache, tm });
    return true;
  },

  async usage(msg, sendResponse) {
    await ensureThrottle();
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
    return true;
  },

  async metrics(msg, sendResponse) {
    await ensureThrottle();
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
    return true;
  },

  async 'metrics-v1'(msg, sendResponse) {
    await ensureThrottle();
    const usage = self.qwenThrottle.getUsage();
    const cache = getCacheStats();
    const tm = getTranslationMemoryStats();

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
    return true;
  },

  getProviders(msg, sendResponse) {
    // Ensure providers are initialized
    if (self.qwenProviders && self.qwenProviders.ensureProviders) {
      self.qwenProviders.ensureProviders();
    }

    // Get list of available providers
    let providers = [];
    if (self.qwenProviders && self.qwenProviders.listProviders) {
      providers = self.qwenProviders.listProviders().map(p => ({
        id: p.name,
        name: p.label || p.name,
      }));
    } else {
      // Fallback to default providers
      providers = [
        { id: 'qwen', name: 'Qwen' },
        { id: 'google', name: 'Google' },
        { id: 'deepl', name: 'DeepL' },
        { id: 'openai', name: 'OpenAI' },
      ];
    }

    sendResponse({ providers });
    return true;
  },

  'tm-cache-metrics'(msg, sendResponse) {
    const tmMetrics = (self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {};
    const cacheStats = self.qwenGetCacheStats ? self.qwenGetCacheStats() : {};
    sendResponse({ tmMetrics, cacheStats });
    return true;
  },

  async quota(msg, sendResponse) {
    const model = msg.model;
    const cfg = self.qwenConfig || {};
    const prov = self.qwenProviders && self.qwenProviders.getProvider && self.qwenProviders.getProvider('qwen');
    if (prov && prov.getQuota) {
      try {
        const result = await prov.getQuota({
          endpoint: (cfg.providers && cfg.providers.qwen && cfg.providers.qwen.apiEndpoint) || cfg.apiEndpoint,
          apiKey: (cfg.providers && cfg.providers.qwen && cfg.providers.qwen.apiKey) || cfg.apiKey,
          model: model || cfg.model,
          debug: cfg.debug,
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err.message });
      }
      return true;
    }
    sendResponse({ error: 'provider unavailable' });
    return true;
  },

  async detect(msg, sendResponse) {
    try {
      const opts = msg.opts || {};
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
    return true;
  },

  'translation-status'(msg, sendResponse) {
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
  },

  'get-status'(msg, sendResponse) {
    sendResponse(translationStatus);
    return true;
  },

  async 'get-stats'(msg, sendResponse) {
    await ensureThrottle();
    sendResponse(getAggregatedStats());
    return true;
  },

  async recalibrate(msg, sendResponse) {
    await ensureThrottle();
    self.qwenThrottle.configure({ requestLimit: 60, tokenLimit: 31980 });
    calibrateLimits(true);
    sendResponse({ ok: true });
    return true;
  },

  async 'ensure-start'(msg, sendResponse) {
    try {
      const { tabId, url } = msg;
      if (!tabId) { sendResponse({ ok: false, error: 'no tabId' }); return true; }
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
    return true;
  },

  async 'home:init'(msg, sendResponse) {
    await ensureThrottle();
    const usage = self.qwenThrottle.getUsage();
    const cache = getCacheStats();
    const tm = getTranslationMemoryStats();
    const providers = buildProvidersUsageSnapshot();

    sendResponse({ usage, cache, tm, providers, status: translationStatus });
    return true;
  },

  async 'home:auto-translate'(msg, sendResponse) {
    const result = await errorHandler.handleAsync(
      (async () => {
        const enabled = !!msg.enabled;
        chrome.storage.sync.set({ autoTranslate: enabled });

        if (!enabled) {
          // Stop all active tabs with error handling
          const tabs = await errorHandler.handleAsync(
            getChromeTabsQuery({}),
            { operation: 'queryTabs', module: 'background' },
            [],
            logger,
          );

          for (const tab of tabs) {
            errorHandler.safe(() => {
              chrome.tabs.sendMessage(tab.id, { action: 'stop' }, () => {
                // Ignore errors from tabs that can't receive messages
                chrome.runtime.lastError;
              });
            }, { operation: 'sendStopMessage', module: 'background', tabId: tab.id }, undefined, logger)();
          }
        }
        return { ok: true };
      })(),
      { operation: 'autoTranslateToggle', module: 'background', enabled: !!msg.enabled },
      { error: 'Auto-translate toggle failed' },
      logger,
    );

    sendResponse(result);
    return true;
  },

  async 'home:quick-translate'(msg, sendResponse) {
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
    return true;
  },
};

// Helper functions for message security validation
const validateBasicMessageSecurity = (sender, raw) => {
  if (!sender || !sender.tab) {
    return { ok: false, error: 'Invalid sender context' };
  }

  if (!raw || typeof raw !== 'object' || !raw.action) {
    return { ok: false, error: 'Invalid message format' };
  }

  return { ok: true };
};

const validateTranslationSecurity = (raw, sender) => {
  if (raw.action !== 'translate' || !raw.opts) {
    return { ok: true }; // Not a translation request
  }

  const opts = raw.opts;

  // Input validation and sanitization
  if (opts.text && self.qwenSecurity) {
    const validation = self.qwenSecurity.validateInput(opts.text);
    if (!validation.valid) {
      self.qwenSecurity.logSecurityEvent('malicious_input_blocked', {
        issues: validation.issues,
        sender: sender.tab.url,
      });
      return { ok: false, error: 'Input validation failed' };
    }
    opts.text = validation.sanitized;
  }

  // Text length validation
  if (opts.text && opts.text.length > 50000) {
    self.qwenSecurity?.logSecurityEvent('oversized_input_blocked', {
      length: opts.text.length,
      sender: sender.tab.url,
    });
    return { ok: false, error: 'Text too long for security' };
  }

  // Suspicious pattern detection
  if (opts.text && self.qwenSecurity?.detectSuspiciousPatterns) {
    const suspiciousResult = self.qwenSecurity.detectSuspiciousPatterns(opts.text);
    if (suspiciousResult.suspicious) {
      self.qwenSecurity.logSecurityEvent('suspicious_pattern_detected', {
        patterns: suspiciousResult.patterns,
        sender: sender.tab.url,
      });
      return { ok: false, error: 'Suspicious content detected' };
    }
  }

  // API endpoint validation
  if (opts.apiEndpoint && !self.qwenSecurity?.validateUrl?.(opts.apiEndpoint)) {
    self.qwenSecurity?.logSecurityEvent('invalid_endpoint_blocked', {
      endpoint: opts.apiEndpoint,
      sender: sender.tab.url,
    });
    return { ok: false, error: 'Invalid API endpoint' };
  }

  return { ok: true };
};

// Initialize Command Dispatcher
let commandDispatcher;
try {
  const { CommandDispatcher } = self.qwenCommandDispatcher;
  const { initializeCommands, createSecurityValidators } = self.qwenCommandRegistry;
  
  commandDispatcher = new CommandDispatcher(logger, errorHandler);
  
  // Set up security dependencies
  const securityValidators = createSecurityValidators({
    validateBasicMessageSecurity,
    validateTranslationSecurity,
  });
  commandDispatcher.setSecurityDependencies(messageRateLimit, securityAudit, securityValidators);
  
  // Initialize all command modules
  initializeCommands(commandDispatcher, {
    // Core dependencies
    logger,
    errorHandler,
    
    // Translation dependencies
    handleTranslate,
    
    // System dependencies
    usageLog,
    securityAudit,
    
    // Configuration dependencies
    ensureThrottle,
    config,
    
    // Metrics dependencies
    cacheStats,
    tmStats,
    providersUsage,
    translationStatus,
    getCacheStats,
    getTranslationMemoryStats,
    getAggregatedStats,
    broadcastEta,
    broadcastStats,
    usageStats,
    
    // Language detection dependencies
    googleDetectLanguage,
    localDetectLanguage,
  });
  
  logger.info('Command dispatcher initialized successfully');
} catch (error) {
  logger.error('Failed to initialize command dispatcher:', error);
  // Fallback to original handler if initialization fails
  commandDispatcher = null;
}

// Use command dispatcher or fallback to original implementation
chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (commandDispatcher) {
    return commandDispatcher.handleMessage(raw, sender, sendResponse);
  }
  
  // Fallback implementation (original logic)
  logger.warn('Using fallback message handler');
  // Rate limiting check per sender origin
  const senderId = sender?.tab?.url || sender?.id || 'unknown';
  if (!messageRateLimit(senderId)) {
    securityAudit.logEvent('rate_limit_exceeded', {
      sender: senderId,
      action: raw?.action,
    });
    if (self.qwenSecurity) {
      self.qwenSecurity.logSecurityEvent('rate_limit_exceeded', {
        sender: senderId,
        timestamp: Date.now(),
      });
    }
    sendResponse({ error: 'Rate limit exceeded' });
    return true;
  }

  // Security validation - check sender origin and message structure
  const securityResult = errorHandler.safe(() => {
    const basicValidation = validateBasicMessageSecurity(sender, raw);
    if (!basicValidation.ok) return basicValidation;

    const translationValidation = validateTranslationSecurity(raw, sender);
    if (!translationValidation.ok) return translationValidation;

    return { ok: true, msg: raw };
  }, { operation: 'securityValidation', module: 'background' }, { ok: false, error: 'Security validation failed' }, logger)();

  if (!securityResult.ok) {
    sendResponse({ error: securityResult.error });
    return true;
  }

  const validationResult = errorHandler.safe(() => {
    return (self.qwenMessaging && self.qwenMessaging.validateMessage)
      ? self.qwenMessaging.validateMessage(securityResult.msg)
      : { ok: true, msg: securityResult.msg };
  }, { operation: 'validateMessage', module: 'background' }, { ok: false, error: 'Message validation failed' }, logger)();

  if (!validationResult.ok) {
    sendResponse({ error: validationResult.error || 'invalid message' });
    return true;
  }

  const msg = validationResult.msg;

  // Dispatch message to appropriate handler
  const handler = messageHandlers[msg.action];
  if (handler) {
    try {
      const result = handler(msg, sendResponse);
      // If handler returns a promise, it's async
      if (result instanceof Promise) {
        result.catch(error => {
          logger.error(`Handler error for action ${msg.action}:`, error);
          sendResponse({ error: error.message || 'Handler failed' });
        });
      }
      return true;
    } catch (error) {
      logger.error(`Handler error for action ${msg.action}:`, error);
      sendResponse({ error: error.message || 'Handler failed' });
      return true;
    }
  }

  // Unknown action
  logger.warn(`Unknown message action: ${msg.action}`);
  sendResponse({ error: `Unknown action: ${msg.action}` });
  return true;
});

// Helper function for quality verification
const applyQualityCheck = async (opts, result, storedKey, safeOpts) => {
  let confidence = scoreConfidence(opts.text, result && result.text);

  if (config.qualityVerify && self.qwenQualityCheck && self.qwenQualityCheck.verify) {
    try {
      const qc = await self.qwenQualityCheck.verify({
        text: opts.text,
        source: opts.source,
        target: opts.target,
        provider: safeOpts.provider,
        endpoint: safeOpts.endpoint,
        model: safeOpts.model,
        apiKey: storedKey,
        providerOrder: config.providerOrder,
        endpoints: opts.endpoints,
      });
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

  return confidence;
};

// Helper functions for port message translation
const setupPortTranslationRequest = (requestId, opts) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.translateTimeoutMs || TRANSLATE_TIMEOUT_MS);
  activeTranslations++;
  updateBadge();

  const ep = opts.endpoint && opts.endpoint.endsWith('/') ? opts.endpoint : (opts.endpoint ? `${opts.endpoint}/` : opts.endpoint);

  return { controller, timeout, ep };
};

const executePortTranslation = async (opts, safeOpts, requestId, port) => {
  let result;

  if (opts && opts.stream) {
    result = await self.qwenTranslateStream(safeOpts, chunk => {
      try { port.postMessage({ requestId, chunk }); } catch {}
    });
  } else {
    result = await self.qwenTranslate(safeOpts);
  }

  return result;
};

const handlePortTranslationError = (err, requestId, port) => {
  logger.error('background port translation error', err);
  iconError = true;

  const offline = isOfflineError(err);
  try { port.postMessage({ requestId, error: offline ? 'offline' : err.message }); } catch {}
  if (offline) {
    try { chrome.runtime.sendMessage({ action: 'translation-status', status: { offline: true } }); } catch {}
  }
};

const cleanupPortTranslation = (timeout, requestId) => {
  clearTimeout(timeout);
  inflight.delete(requestId);
  activeTranslations--;
  updateBadge();
  broadcastStats();
};

// Port Message Action Handlers
const portMessageHandlers = {
  async translate(msg, port) {
    const { requestId, opts } = msg;
    if (!requestId || !opts) return;

    await ensureThrottle();
    const { controller, timeout, ep } = setupPortTranslationRequest(requestId, opts);

    const storedKey = await getApiKeyFromStorage();
    const safeOpts = { ...opts, endpoint: ep, apiKey: storedKey, signal: controller.signal, noProxy: true };
    const start = Date.now();
    const tokens = self.qwenThrottle.approxTokens(safeOpts.text || '');

    inflight.set(requestId, { controller, timeout, port });

    try {
      const result = await executePortTranslation(opts, safeOpts, requestId, port);
      const confidence = await applyQualityCheck(opts, result, storedKey, safeOpts);

      try { port.postMessage({ requestId, result: { ...result, confidence } }); } catch {}

      logUsage(tokens, Date.now() - start);
      iconError = false;
    } catch (err) {
      handlePortTranslationError(err, requestId, port);
      logUsage(tokens, Date.now() - start);
    } finally {
      cleanupPortTranslation(timeout, requestId);
    }
  },

  async detect(msg, port) {
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
  },

  cancel(msg, port) {
    if (!msg.requestId) return;

    const rec = inflight.get(msg.requestId);
    if (rec) {
      try { rec.controller.abort(); } catch {}
      clearTimeout(rec.timeout);
      inflight.delete(msg.requestId);
    }
  },
};

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'qwen-translate') return;

  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== 'object') return;

    // Dispatch to appropriate handler
    const handler = portMessageHandlers[msg.action];
    if (handler) {
      try {
        await handler(msg, port);
      } catch (error) {
        logger.error(`Port handler error for action ${msg.action}:`, error);
        try {
          port.postMessage({
            requestId: msg.requestId,
            error: error.message || 'Handler failed',
          });
        } catch {}
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
