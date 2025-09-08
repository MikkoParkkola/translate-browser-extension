(function () {
// Only guard in real browser/extension contexts so tests can reload the module
if (
  (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') &&
  typeof window !== 'undefined' &&
  typeof chrome !== 'undefined' &&
  chrome.runtime &&
  chrome.runtime.id
) {
  if (window.__qwenTranslatorLoaded) {
    if (typeof module !== 'undefined') module.exports = window.__qwenTranslatorModule;
    return;
  }
  window.__qwenTranslatorLoaded = true;
}

let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
var approxTokens;
var createThrottle;
const throttles = new Map();
function throttleFor(id, context = 'default') {
  const key = `${id || 'default'}:${context}`;
  if (!throttles.has(key)) {
    let cfg;
    try {
      // Try to get existing provider (for throttle config)
      const prov = Providers && Providers.get ? Providers.get(id) : null;
      cfg = prov && prov.throttle;
    } catch {}
    let tCfg = cfg || {};
    if (cfg && cfg.contexts) {
      tCfg = Object.assign({}, cfg, cfg.contexts[context] || cfg.contexts.default || {});
      delete tCfg.contexts;
    }
    throttles.set(key, createThrottle(tCfg));
  }
  return throttles.get(key);
}

if (typeof window === 'undefined') {
  if (typeof self !== 'undefined' && self.qwenThrottle) {
    ({ createThrottle, approxTokens } = self.qwenThrottle);
  } else {
    fetchFn = typeof fetch !== 'undefined' ? fetch : require('cross-fetch');
    ({ createThrottle, approxTokens } = require('./throttle'));
  }
} else {
  if (window.qwenThrottle) {
    ({ createThrottle, approxTokens } = window.qwenThrottle);
  } else if (typeof require !== 'undefined') {
    ({ createThrottle, approxTokens } = require('./throttle'));
  } else {
    createThrottle = () => ({ runWithRateLimit: fn => fn(), runWithRetry: fn => fn() });
    approxTokens = () => 0;
  }
}

let trLogger = console;
try {
  if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenLogger) {
    trLogger = self.qwenLogger.create('translator');
  } else if (typeof window !== 'undefined' && window.qwenLogger) {
    trLogger = window.qwenLogger.create('translator');
  } else if (typeof require !== 'undefined') {
    try { trLogger = require('./lib/logger').create('translator'); } catch {}
  }
} catch {}

// Security utilities
let security = null;
try {
  if (typeof window !== 'undefined' && window.qwenSecurity) {
    security = window.qwenSecurity;
  } else if (typeof self !== 'undefined' && self.qwenSecurity) {
    security = self.qwenSecurity;
  } else if (typeof require !== 'undefined') {
    security = require('./core/security');
  }
} catch {
  // Fallback security functions if module not available
  security = {
    sanitizeTranslationText: (text) => typeof text === 'string' ? text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') : '',
    validateInput: (text) => ({ valid: true, sanitized: text }),
    logSecurityEvent: (event, details) => console.warn('[Security]', event, details)
  };
}

// Error handler utilities
let errorHandler = null;
try {
  if (typeof window !== 'undefined' && window.qwenErrorHandler) {
    errorHandler = window.qwenErrorHandler;
  } else if (typeof self !== 'undefined' && self.qwenErrorHandler) {
    errorHandler = self.qwenErrorHandler;
  } else if (typeof require !== 'undefined') {
    errorHandler = require('./core/error-handler');
  }
} catch {
  // Fallback error handling functions if module not available
  errorHandler = {
    handle: (error, context = {}, customFallback) => {
      trLogger.error('Error:', error?.message || error);
      return customFallback || null;
    },
    safe: (fn, context = {}, customFallback) => {
      return function(...args) {
        try {
          const result = fn.apply(this, args);
          if (result && typeof result.catch === 'function') {
            return result.catch(error => {
              trLogger.error('Async error:', error?.message || error);
              return customFallback || null;
            });
          }
          return result;
        } catch (error) {
          trLogger.error('Sync error:', error?.message || error);
          return customFallback || null;
        }
      };
    },
    isNetworkError: (error) => {
      const message = error?.message || '';
      return /fetch|network|connection|timeout|cors|offline/i.test(message);
    },
    ERROR_TYPES: { NETWORK: 'network', TRANSLATION: 'translation', SECURITY: 'security', VALIDATION: 'validation', CACHE: 'cache', UNKNOWN: 'unknown' },
    SEVERITY: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' }
  };
}

// Module Adapter - Bridge between old and new module systems
let moduleAdapter = null;
let legacyAdapter = null;
try {
  if (typeof window !== 'undefined' && window.qwenModuleAdapter) {
    moduleAdapter = window.qwenModuleAdapter.moduleAdapter;
  } else if (typeof self !== 'undefined' && self.qwenModuleAdapter) {
    moduleAdapter = self.qwenModuleAdapter.moduleAdapter;
  } else if (typeof require !== 'undefined') {
    const { moduleAdapter: adapter } = require('./core/module-adapter');
    moduleAdapter = adapter;
  }
  
  // Initialize module adapter and get legacy-compatible interface
  if (moduleAdapter) {
    moduleAdapter.init().then(() => {
      legacyAdapter = moduleAdapter.createLegacyAdapter();
      trLogger?.debug?.('Module adapter initialized with legacy interface');
    }).catch(err => {
      trLogger?.warn?.('Module adapter initialization failed:', err);
    });
  }
} catch (e) {
  trLogger?.warn?.('Module adapter not available:', e);
}

/**
 * Sanitize translation result before returning to user
 * @param {Object} result - Translation result object
 * @returns {Object} Sanitized result
 */
function _sanitizeResult(result) {
  if (!result) return result;
  
  if (typeof result.text === 'string') {
    // Try module adapter security first, fallback to legacy security
    if (legacyAdapter) {
      try {
        result.text = legacyAdapter.sanitizeOutput(result.text, { preserveFormatting: true });
      } catch {
        // Fallback to legacy security if module adapter fails
        if (security) {
          result.text = security.sanitizeTranslationText(result.text, { preserveFormatting: true });
        }
      }
    } else if (security) {
      result.text = security.sanitizeTranslationText(result.text, { preserveFormatting: true });
    }
  }
  
  return result;
}
let glossary = null;
try {
  if (typeof window !== 'undefined' && window.qwenGlossary) glossary = window.qwenGlossary;
  else if (typeof self !== 'undefined' && self.qwenGlossary) glossary = self.qwenGlossary;
  else if (typeof require !== 'undefined') glossary = require('./lib/glossary');
} catch {}
function _applyGlossary(text) {
  if (!glossary || typeof glossary.apply !== 'function') return text;
  let map;
  try { map = glossary.get ? glossary.get() : null; } catch {}
  if (!map || !Object.keys(map).length) return text;
  return glossary.apply(text, map);
}
// Unified cache system using modern cache-manager
let cacheManager = null;
let cacheInstance = null;

async function initializeCacheManager() {
  if (cacheInstance) return cacheInstance;
  
  try {
    // Load cache manager factory
    if (typeof window !== 'undefined' && window.qwenCoreCache) {
      cacheManager = window.qwenCoreCache;
    } else if (typeof self !== 'undefined' && self.qwenCoreCache) {
      cacheManager = self.qwenCoreCache;
    } else if (typeof require !== 'undefined') {
      cacheManager = require('./core/cache-manager');
    }

    if (cacheManager && typeof cacheManager.createCacheManager === 'function') {
      // Create cache instance with translation-optimized configuration
      cacheInstance = await cacheManager.createCacheManager({
        maxMemoryEntries: 5000,
        maxMemorySize: 10 * 1024 * 1024, // 10MB for translations
        defaultTTL: 7 * 24 * 60 * 60 * 1000, // 1 week for translations
        evictionBatchSize: 250,
        persistentStorage: true,
        compressionEnabled: true
      });
      trLogger.debug('Cache manager initialized successfully');
    }
  } catch (e) {
    trLogger.warn('Failed to initialize cache manager, using fallback', e);
  }
  
  // Fallback to simple Map if cache manager initialization fails
  if (!cacheInstance) {
    cacheInstance = {
      async get(key) { return fallbackCache.get(key); },
      async set(key, value, ttl) { fallbackCache.set(key, value); return true; },
      async delete(key) { return fallbackCache.delete(key); },
      async clear() { fallbackCache.clear(); },
      getStats() { return { memoryEntries: fallbackCache.size, hitRate: 0 }; }
    };
    trLogger.warn('Using fallback cache implementation');
  }
  
  return cacheInstance;
}

// Initialize cache - this will be awaited by functions that need cache
const cacheReady = initializeCacheManager();
let fallbackCache = new Map(); // Only used if cache manager fails to load

// Legacy cache API compatibility
let legacyCacheApi = null;
try {
  if (typeof window !== 'undefined' && window.qwenCache) legacyCacheApi = window.qwenCache;
  else if (typeof self !== 'undefined' && self.qwenCache) legacyCacheApi = self.qwenCache;
  else if (typeof require !== 'undefined') legacyCacheApi = require('./cache');
} catch {}

const {
  qwenSetCacheLimit = () => {},
  qwenSetCacheTTL = () => {},
  _setCacheEntryTimestamp = () => {},
  qwenClearCache: _persistClear = () => {},
  qwenGetCacheSize = () => cacheManager && typeof cacheManager.getStats === 'function' ? cacheManager.getStats().memoryEntries : fallbackCache.size,
} = legacyCacheApi || {};
let getUsage = () => ({ 
  cacheSize: cacheManager && typeof cacheManager.getStats === 'function' ? cacheManager.getStats().memoryEntries : fallbackCache.size, 
  cacheMax: _memCacheMax() 
});
function _setGetUsage(fn) { if (typeof fn === 'function') getUsage = fn; }

function _memCacheMax() {
  let v;
  try {
    if (typeof self !== 'undefined' && self.qwenConfig && self.qwenConfig.memCacheMax != null) {
      v = parseInt(self.qwenConfig.memCacheMax, 10);
    }
  } catch {}
  if (v == null) {
    try {
      if (typeof window !== 'undefined' && window.qwenConfig && window.qwenConfig.memCacheMax != null) {
        v = parseInt(window.qwenConfig.memCacheMax, 10);
      }
    } catch {}
  }
  if (v == null) {
    try {
      if (typeof process !== 'undefined' && process.env && process.env.QWEN_MEMCACHE_MAX != null) {
        v = parseInt(process.env.QWEN_MEMCACHE_MAX, 10);
      }
    } catch {}
  }
  if (!Number.isFinite(v) || v <= 0) return 5000;
  return v;
}
// Unified cache interface - no adapter selection needed
async function getCache() {
  return await cacheReady;
}

async function _setCache(k, v) {
  const ttl = 7 * 24 * 60 * 60 * 1000; // 1 week TTL
  
  try {
    const cache = await getCache();
    await cache.set(k, v, ttl);
  } catch (error) {
    trLogger.warn('Cache set operation failed:', error);
    // Fallback to Map cache on error
    fallbackCache.set(k, v);
  }
}
async function _touchCache(k) {
  try {
    const cache = await getCache();
    return await cache.get(k);
  } catch (error) {
    trLogger.warn('Cache get operation failed:', error);
    // Fallback to Map cache on error
    return fallbackCache.get(k);
  }
}
let normalizeText;
let makeCacheKey;
try {
  if (typeof window !== 'undefined' && window.qwenCacheKey) {
    ({ normalizeText, makeCacheKey } = window.qwenCacheKey);
  } else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenCacheKey) {
    ({ normalizeText, makeCacheKey } = self.qwenCacheKey);
  } else if (typeof require !== 'undefined') {
    ({ normalizeText, makeCacheKey } = require('./translator/cacheKey'));
  }
} catch {}
if (!normalizeText) {
  normalizeText = function _normText(t) {
    const s = String(t == null ? '' : t);
    const collapsed = s.replace(/\s+/g, ' ').trim();
    try { return collapsed.normalize('NFC'); } catch { return collapsed; }
  };
}
if (!makeCacheKey) {
  makeCacheKey = function _key(source, target, text) {
    return `${source}:${target}:${normalizeText(text)}`;
  };
}

function qwenIsCached({ source, target, text }) {
  try { 
    const key = makeCacheKey(source, target, text);
    if (cacheManager) {
      return cacheManager && typeof cacheManager.has === 'function' ? cacheManager.has(key) : false;
    } else {
      return fallbackCache.has(key);
    }
  }
  catch { return false; }
}

let messaging = null;
try {
  if (typeof window !== 'undefined' && window.qwenMessaging) {
    messaging = window.qwenMessaging;
  } else if (typeof require !== 'undefined') {
    try { messaging = require('./lib/messaging'); } catch {}
  }
} catch {}

let makeDelimiter = () => `<<<QWEN_SPLIT_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}>>>`;
try {
  if (typeof window !== 'undefined' && window.qwenBatchDelim) {
    makeDelimiter = window.qwenBatchDelim.makeDelimiter;
  } else if (typeof require !== 'undefined') {
    try { makeDelimiter = require('./lib/batchDelim').makeDelimiter; } catch {}
  }
} catch {}

let Providers = null;
try {
  if (typeof window !== 'undefined' && window.qwenProviders) {
    Providers = window.qwenProviders;
  } else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenProviders) {
    Providers = self.qwenProviders;
  } else if (typeof require !== 'undefined') {
    try {
        Providers = require('./lib/providers');
      } catch {}
  }
} catch {}

  let _warnedProviders = false;
  function _ensureProviders(opts = {}) {
    try {
      if (Providers && typeof Providers.isInitialized === 'function' && !Providers.isInitialized()) {
        if (opts.autoInit) {
          try { require('./providers').ensureProviders(); return; } catch {}
        }
        if (!_warnedProviders) {
          _warnedProviders = true;
          trLogger.warn('default providers not initialized; call qwenProviders.initProviders()');
        }
      }
    } catch {}
  }

let TM = null;
try {
  if (typeof window !== 'undefined' && window.qwenTM) {
    TM = window.qwenTM;
  } else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenTM) {
    TM = self.qwenTM;
  } else if (typeof require !== 'undefined') {
    try { TM = require('./lib/tm'); } catch {}
  }
} catch {}

let Detect = null;
try {
  if (typeof window !== 'undefined' && window.qwenDetect) {
    Detect = window.qwenDetect;
  } else if (typeof require !== 'undefined') {
    try { Detect = require('./lib/detect'); } catch {}
  }
} catch {}

function fetchViaXHR(url, { method = 'GET', headers = {}, body, signal }, debug) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.responseType = 'text';
    if (signal) {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const onAbort = () => {
        xhr.abort();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      xhr.addEventListener('loadend', () => signal.removeEventListener('abort', onAbort));
    }
    xhr.onload = () => {
      const resp = {
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => JSON.parse(xhr.responseText || 'null'),
        text: async () => xhr.responseText,
        headers: new Headers(),
      };
      if (debug) trLogger.debug('XHR status', xhr.status);
      resolve(resp);
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body);
  });
}

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

let chooseDefaultProvider;
let buildCandidatesChain;
try {
  if (typeof window !== 'undefined' && window.qwenProviderSelect) {
    chooseDefaultProvider = window.qwenProviderSelect.chooseDefault;
    buildCandidatesChain = window.qwenProviderSelect.candidatesChain;
  } else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenProviderSelect) {
    chooseDefaultProvider = self.qwenProviderSelect.chooseDefault;
    buildCandidatesChain = self.qwenProviderSelect.candidatesChain;
  } else if (typeof require !== 'undefined') {
    ({ chooseDefault: chooseDefaultProvider, candidatesChain: buildCandidatesChain } = require('./translator/providers'));
  }
} catch {}
function chooseProvider(opts) {
  if (chooseDefaultProvider) return chooseDefaultProvider({ ...opts, Providers });
  if (Providers && typeof Providers.choose === 'function') return Providers.choose(opts);
  const ep = String(opts && opts.endpoint || '').toLowerCase();
  return ep.includes('dashscope') ? 'dashscope' : 'dashscope';
}
async function providerTranslate({ endpoint, apiKey, projectId, location, model, text, source, target, tone, signal, debug, onData, stream = true, provider, context = 'default', autoInit = false, providerOrder, endpoints, secondaryModel }) {
  _ensureProviders({ autoInit });
  const tokens = approxTokens(text);
  const chain = buildCandidatesChain
    ? buildCandidatesChain({ providerOrder, provider, endpoint, model, Providers })
    : (Array.isArray(providerOrder) && providerOrder.length)
      ? (provider
          ? (providerOrder.includes(provider)
              ? providerOrder.slice(providerOrder.indexOf(provider))
              : [provider, ...providerOrder.filter(p=>p!==provider)])
          : providerOrder.slice())
      : (provider ? [provider] : (Providers && Providers.candidates ? Providers.candidates({ endpoint, model }) : [chooseProvider({ endpoint, model })]));

  let lastErr = null;
  for (const id of chain) {
    if (!(Providers && typeof Providers.get === 'function')) break;
    
    // Try to get existing provider or load on-demand
    let impl = Providers.get(id);
    if (!impl && typeof Providers.getProviderAsync === 'function') {
      try {
        impl = await Providers.getProviderAsync(id);
      } catch (e) {
        console.warn(`Failed to load provider ${id} on-demand:`, e);
        continue;
      }
    }
    if (!impl || typeof impl.translate !== 'function') continue;
    const ep = withSlash((endpoints && endpoints[id]) || endpoint || '');
    try {
      const t = throttleFor(id, context);
      return await t.runWithRetry(
        () => impl.translate({ endpoint: ep, apiKey, projectId, location, model, secondaryModel, text, source, target, tone, signal, debug, onData, stream }),
        tokens,
        3,
        debug
      );
    } catch (e) {
      lastErr = e;
      // try next candidate
      continue;
    }
  }

  if (lastErr) throw lastErr;
  const first = chain && chain[0];
  const ep = withSlash((endpoints && first && endpoints[first]) || endpoint || '');
  const t = throttleFor(first, context);
  return await t.runWithRetry(
    () => doFetch({ endpoint: ep, apiKey, model, text, source, target, tone, signal, debug, onData, stream }),
    tokens,
    3,
    debug
  );
}

async function _detectSource(text, { detector, debug, noProxy, sensitivity = 0, minLength = 0 } = {}) {
  const sample = String(text || '').slice(0, 2000);
  if (sample.replace(/\s+/g, '').length < minLength) return 'en';
  if (detector === 'google' && chooseStrategy({ noProxy }) === 'proxy' && messaging) {
    try {
      const r = await messaging.detectLanguage({ text: sample, detector: 'google', debug, sensitivity, minLength });
      if (r && r.lang) return r.lang;
    } catch {}
  }
  // Use legacy local detection (keeping sync compatibility)
  if (Detect && typeof Detect.detectLocal === 'function') {
    try {
      const r = Detect.detectLocal(sample, { sensitivity, minLength });
      if (r && r.lang) return r.lang;
    } catch {}
  }
  
  // TODO: Integrate module adapter language detection in async contexts
  return 'en';
}

async function doFetch({ endpoint, apiKey, model, text, source, target, tone, signal, debug, onData, stream = true }) {
  const url = `${withSlash(endpoint)}services/aigc/text-generation/generation`;
  if (debug) {
    trLogger.debug('sending translation request to', url);
    trLogger.debug('request params', { model, source, target, text });
  }
  const body = {
    model,
    input: { messages: [{ role: 'user', content: text }] },
    parameters: {
      translation_options: { source_lang: source, target_lang: target },
    },
  };
  if (tone) body.parameters.tone = tone;
  if (debug) trLogger.debug('request body', body);
  const key = (apiKey || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
  if (stream) headers['X-DashScope-SSE'] = 'enable';
  let resp;
  try {
    // Use module adapter HTTP client if available, fallback to native fetch
    if (legacyAdapter) {
      resp = await legacyAdapter.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } else {
      resp = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    }
    if (debug) {
      trLogger.debug('response status', resp.status);
      trLogger.debug('response headers', Object.fromEntries(resp.headers.entries()));
    }
  } catch (e) {
    if (!stream && typeof XMLHttpRequest !== 'undefined') {
      if (debug) trLogger.debug('fetch failed, falling back to XHR');
      // Use module adapter XHR fallback if available, otherwise use legacy XHR
      if (legacyAdapter) {
        resp = await legacyAdapter._fallbackFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal
        });
      } else {
        resp = await fetchViaXHR(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
          },
          debug
        );
      }
    } else {
      e.retryable = errorHandler.isNetworkError(e);
      return errorHandler.handle(e, { 
        operation: 'network_request',
        url: url,
        method: 'POST',
        retryable: e.retryable
      }, null);
    }
  }
    if (!resp.ok) {
      const err = await errorHandler.safe(
        () => resp.json(),
        { operation: 'json_parse' },
        { message: resp.statusText }
      )();
      const error = new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
      error.status = resp.status;
      error.code = `HTTP_${resp.status}`;
      if (debug) trLogger.debug('HTTP error response', error.message);
      if (resp.status >= 500 || resp.status === 429) {
        error.retryable = true;
        const ra = resp.headers.get('retry-after');
        if (ra) {
          const ms = parseInt(ra, 10) * 1000;
          if (ms > 0) error.retryAfter = ms;
        }
        if (resp.status === 429 && !error.retryAfter) error.retryAfter = 60000;
      }
      return errorHandler.handle(error, {
        operation: 'http_response',
        status: resp.status,
        retryable: error.retryable,
        retryAfter: error.retryAfter
      }, null);
    }
  if (!stream || !resp.body || typeof resp.body.getReader !== 'function') {
    if (debug) trLogger.debug('received non-streaming response');
    const data = await resp.json();
    const text =
      data.output?.text ||
      data.output?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('Invalid API response');
    }
    return { text };
  }

  if (debug) trLogger.debug('reading streaming response');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (debug) trLogger.debug('raw line', data);
      if (data === '[DONE]') {
        reader.cancel();
        break;
      }
      try {
        const obj = JSON.parse(data);
        const chunk =
          obj.output?.text ||
          obj.output?.choices?.[0]?.message?.content || '';
        result += chunk;
        if (onData && chunk) onData(chunk);
        if (debug && chunk) trLogger.debug('chunk received', chunk);
      } catch {}
    }
  }
  return { text: result };
}

async function qwenTranslate({ endpoint, apiKey, projectId, location, model, secondaryModel, text, source, target, signal, debug = false, stream = false, noProxy = false, provider, detector, force = false, skipTM = false, autoInit = false, providerOrder, endpoints, sensitivity = 0, failover = true }) {
  // Security: Validate and sanitize input text
  if (legacyAdapter) {
    try {
      text = legacyAdapter.sanitizeInput(text);
    } catch {
      // Fallback to legacy security if module adapter fails
      if (security) {
        const validation = security.validateInput(text);
        if (!validation.valid) {
          security.logSecurityEvent('input_validation_failed', {
            issues: validation.issues,
            textLength: text ? text.length : 0
          });
          text = validation.sanitized;
        }
        text = security.sanitizeTranslationText(text);
      }
    }
  } else if (security) {
    const validation = security.validateInput(text);
    if (!validation.valid) {
      security.logSecurityEvent('input_validation_failed', {
        issues: validation.issues,
        textLength: text ? text.length : 0
      });
      text = validation.sanitized;
    }
    text = security.sanitizeTranslationText(text);
  }

  if (debug) {
    trLogger.debug('qwenTranslate called with', {
      endpoint,
      apiKeySet: Boolean(apiKey),
      model,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
  const cfg = typeof self !== 'undefined' && self.qwenConfig ? self.qwenConfig : typeof window !== 'undefined' && window.qwenConfig ? window.qwenConfig : {};
  const detected = await _detectSource(text, { detector, debug, noProxy, sensitivity, minLength: cfg.minDetectLength });
  let src = source;
  if (!src || src === 'auto') {
    src = detected;
  } else if (detected && detected !== src) {
    if (debug) trLogger.warn('detected language differs from requested source; skipping translation', { detected, source: src });
    return { text };
  }
  if (src && src === target) {
    if (debug) trLogger.warn('source language matches target; skipping translation');
    return { text };
  }
  text = _applyGlossary(text);
  const tone = glossary && typeof glossary.getTone === 'function' ? glossary.getTone() : undefined;
  const prov = provider || (chooseDefaultProvider ? chooseDefaultProvider({ endpoint, model, Providers }) : (Providers && Providers.choose ? Providers.choose({ endpoint, model }) : chooseProvider({ endpoint, model })));
  const cacheKey = `${prov}:${makeCacheKey(src, target, text)}`;
  // Check cache first
  const cached = await _touchCache(cacheKey);
  if (!force && cached) {
    return cached;
  }

  // Persistent TM lookup
  if (!force && TM && TM.get) {
    try {
      const hit = await TM.get(cacheKey);
      if (hit && typeof hit.text === 'string') {
        const val = { text: hit.text };
        await _setCache(cacheKey, val);
        return val;
      }
    } catch {}
  }

    if (chooseStrategy({ noProxy, provider: prov }) === 'proxy' && messaging) {
      const result = await messaging.requestViaBackground({
        endpoint: withSlash(endpoint),
        apiKey,
        model,
        secondaryModel,
        text,
        source: src,
        target,
        debug,
        stream: false,
        signal,
        provider: prov,
        providerOrder: failover ? providerOrder : undefined,
        endpoints,
        failover,
        parallel: false,
        tone,
      });
      result = _sanitizeResult(result);
      await _setCache(cacheKey, result);
      if (TM && TM.set && result && typeof result.text === 'string') { try { TM.set(cacheKey, result.text); } catch {} }
      return result;
    }

  try {
    const data = await providerTranslate({ endpoint, apiKey, projectId, location, model, text, source: src, target, tone, signal, debug, stream, provider: provider ? prov : undefined, context: stream ? 'stream' : 'default', autoInit, providerOrder: failover ? providerOrder : undefined, endpoints, secondaryModel });
    await _setCache(cacheKey, data);
    if (!skipTM && TM && TM.set && data && typeof data.text === 'string') { 
      errorHandler.safe(() => TM.set(cacheKey, data.text), { operation: 'tm_cache' })();
    }
    if (debug) {
      trLogger.debug('translation successful');
      trLogger.debug('final text', data.text);
    }
    return data;
  } catch (e) {
    return errorHandler.handle(e, { 
      operation: 'translate',
      provider: provider || 'default',
      textLength: text?.length || 0,
      source: src,
      target: target
    }, { text: '', confidence: 0, error: 'Translation failed' });
  }
}

async function qwenTranslateStream({ endpoint, apiKey, projectId, location, model, secondaryModel, text, source, target, signal, debug = false, stream = true, noProxy = false, provider, detector, skipTM = false, autoInit = false, providerOrder, endpoints, sensitivity = 0, failover = true }, onData) {
  if (debug) {
    trLogger.debug('qwenTranslateStream called with', {
      endpoint,
      apiKeySet: Boolean(apiKey),
      model,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
  const cfg = typeof self !== 'undefined' && self.qwenConfig ? self.qwenConfig : typeof window !== 'undefined' && window.qwenConfig ? window.qwenConfig : {};
  const detected = await _detectSource(text, { detector, debug, noProxy, sensitivity, minLength: cfg.minDetectLength });
  let src = source;
  if (!src || src === 'auto') {
    src = detected;
  } else if (detected && detected !== src) {
    if (debug) trLogger.warn('detected language differs from requested source; skipping translation', { detected, source: src });
    if (onData) onData(text);
    return { text };
  }
  if (src && src === target) {
    if (debug) trLogger.warn('source language matches target; skipping translation');
    if (onData) onData(text);
    return { text };
  }
  text = _applyGlossary(text);
  const tone = glossary && typeof glossary.getTone === 'function' ? glossary.getTone() : undefined;
  const prov = provider || (chooseDefaultProvider ? chooseDefaultProvider({ endpoint, model, Providers }) : (Providers && Providers.choose ? Providers.choose({ endpoint, model }) : chooseProvider({ endpoint, model })));
  const cacheKey = `${prov}:${makeCacheKey(src, target, text)}`;
  // Check cache first
  const cached = await _touchCache(cacheKey);
  if (cached) {
    if (onData) onData(cached.text);
    return cached;
  }

    if (chooseStrategy({ noProxy, provider: prov }) === 'proxy' && messaging) {
      const data = await messaging.requestViaBackground({
        endpoint: withSlash(endpoint),
        apiKey,
        model,
        secondaryModel,
        text,
        source: src,
        target,
        debug,
        stream: true,
        signal,
        onData,
        provider: prov,
        providerOrder: failover ? providerOrder : undefined,
        endpoints,
        failover,
        parallel: false,
        tone,
      });
      await _setCache(cacheKey, data);
      if (TM && TM.set && data && typeof data.text === 'string') { 
        errorHandler.safe(() => TM.set(cacheKey, data.text), { operation: 'tm_cache' })();
      }
      return data;
    }

  try {
    const data = await providerTranslate({ endpoint, apiKey, projectId, location, model, text, source: src, target, tone, signal, debug, onData, stream, provider: prov, context: 'stream', autoInit, providerOrder: failover ? providerOrder : undefined, endpoints, secondaryModel });
    await _setCache(cacheKey, data);
    if (!skipTM && TM && TM.set && data && typeof data.text === 'string') { 
      errorHandler.safe(() => TM.set(cacheKey, data.text), { operation: 'tm_cache' })();
    }
    if (debug) {
      trLogger.debug('translation successful');
      trLogger.debug('final text', data.text);
    }
    return data;
  } catch (e) {
    return errorHandler.handle(e, { 
      operation: 'translate_stream',
      provider: prov || 'default',
      textLength: text?.length || 0,
      source: src,
      target: target,
      stream: true
    }, { text: '', confidence: 0, error: 'Translation failed' });
  }
}

let dynamicTokenBudget = 7000;
let lastGoodBudget = 0;
let budgetLocked = false;
const MIN_TOKEN_BUDGET = 1000;
const MAX_TOKEN_BUDGET = 16000;
const GROWTH_FACTOR = 1.2;

async function qwenTranslateBatch(params) {
  if (params.tokenBudget) return batchOnce(params);
  let tokenBudget = dynamicTokenBudget;
  while (true) {
    try {
      const res = await batchOnce({ ...params, tokenBudget });
      if (!budgetLocked) {
        lastGoodBudget = tokenBudget;
        if (tokenBudget < MAX_TOKEN_BUDGET) {
          tokenBudget = Math.min(
            MAX_TOKEN_BUDGET,
            Math.floor(tokenBudget * GROWTH_FACTOR)
          );
          dynamicTokenBudget = tokenBudget;
        }
      }
      return res;
    } catch (e) {
      if (/Parameter limit exceeded/i.test(e.message || '') && tokenBudget > MIN_TOKEN_BUDGET) {
        if (lastGoodBudget) {
          tokenBudget = lastGoodBudget;
          dynamicTokenBudget = tokenBudget;
          budgetLocked = true;
          if (typeof window !== 'undefined' && window.qwenLoadConfig && window.qwenSaveConfig) {
            try {
              const cfg = await window.qwenLoadConfig();
              if (!cfg.tokenBudget) {
                cfg.tokenBudget = tokenBudget;
                await window.qwenSaveConfig(cfg);
              }
            } catch {}
          }
          continue;
        }
        tokenBudget = Math.max(MIN_TOKEN_BUDGET, Math.floor(tokenBudget / 2));
        dynamicTokenBudget = tokenBudget;
        continue;
      }
      throw e;
    }
  }
}

function _getTokenBudget() {
  return dynamicTokenBudget;
}

function _setTokenBudget(v, lock = v > 0) {
  if (v > 0) {
    dynamicTokenBudget = v;
    lastGoodBudget = v;
  } else {
    dynamicTokenBudget = 7000;
    lastGoodBudget = 0;
  }
  budgetLocked = lock;
}

async function batchOnce({
  texts = [],
  tokenBudget = dynamicTokenBudget,
  maxBatchSize = 2000,
  retries = 1,
  onProgress,
  _stats,
  parallel = 'auto',
  failover = true,
  ...opts
}) {
  const stats = _stats || { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0, latencyMs: 0 };
  if (stats.latencyMs == null) stats.latencyMs = 0;
  const userSource = opts.source;
  const autoMode = !userSource || userSource === 'auto';
  const sourceByIndex = new Array(texts.length);
  const cfg = typeof self !== 'undefined' && self.qwenConfig ? self.qwenConfig : typeof window !== 'undefined' && window.qwenConfig ? window.qwenConfig : {};
  for (let i = 0; i < texts.length; i++) {
    sourceByIndex[i] = await _detectSource(texts[i], { detector: opts.detector, debug: opts.debug, noProxy: opts.noProxy, sensitivity: opts.sensitivity, minLength: cfg.minDetectLength });
  }
  if (glossary) {
    texts = texts.map(t => _applyGlossary(t));
  }
  const SEP = makeDelimiter();
  // Warm TM using per-text language keys when we may translate
  // Optimized TM cache warming - batch operations and reduce sequential processing
  if (TM && TM.get) {
    const missingKeys = [];
    const seen = new Set();
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const det = sourceByIndex[i];
      const lang = det || userSource;
      if (!lang) continue;
      if (!autoMode && det && det !== userSource) continue;
      const key = makeCacheKey(lang, opts.target, t);
      if (!fallbackCache.has(key) && !seen.has(key)) {
        seen.add(key);
        missingKeys.push(key);
      }
    }
    if (missingKeys.length) {
      // Batch TM lookup and cache setting for better performance
      const hits = await Promise.all(missingKeys.map(k => TM.get(k).catch(() => null)));
      const cachePromises = [];
      for (let i = 0; i < missingKeys.length; i++) {
        const h = hits[i];
        if (h && typeof h.text === 'string') {
          // Batch cache operations instead of awaiting individually
          cachePromises.push(_setCache(missingKeys[i], { text: h.text }));
        }
      }
      // Execute all cache operations in parallel
      if (cachePromises.length) {
        await Promise.all(cachePromises);
      }
    }
  }

  // Load splitting and batching functions once, outside the loop
  let splitLong;
  let predictive;
  try {
    if (typeof window !== 'undefined' && window.qwenBatching) splitLong = window.qwenBatching.splitLongText;
    else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenBatching) splitLong = self.qwenBatching.splitLongText;
    else if (typeof require !== 'undefined') splitLong = require('./translator/batching').splitLongText;
  } catch {}
  try {
    if (typeof window !== 'undefined' && window.qwenThrottle) predictive = window.qwenThrottle.predictiveBatch;
    else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenThrottle) predictive = self.qwenThrottle.predictiveBatch;
    else if (typeof require !== 'undefined') predictive = require('./throttle').predictiveBatch;
  } catch {}
  const splitFn = splitLong || function splitLongText(text, maxTokens) {
    const parts = (text || '').split(/(?<=[\.?!])\s+/);
    const chunks = [];
    let cur = '';
    for (const part of parts) {
      const next = cur ? cur + ' ' + part : part;
      if (approxTokens(next) > maxTokens && cur) {
        chunks.push(cur);
        cur = part;
      } else {
        cur = next;
      }
    }
    if (cur) chunks.push(cur);
    const out = [];
    for (const ch of chunks) {
      if (approxTokens(ch) <= maxTokens) {
        out.push(ch);
      } else {
        let start = 0;
        const step = Math.max(128, Math.floor(maxTokens * 4));
        while (start < ch.length) {
          out.push(ch.slice(start, start + step));
          start += step;
        }
      }
    }
    return out;
  };

  // Optimize token calculations by caching results for repeated texts
  const tokenCache = new Map();
  const getTokenCount = (text) => {
    if (tokenCache.has(text)) return tokenCache.get(text);
    const count = approxTokens(text);
    tokenCache.set(text, count);
    return count;
  };

  const mapping = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const det = sourceByIndex[i];
    const lang = det || userSource;
    if (lang === opts.target || (!autoMode && det && det !== userSource)) {
      mapping.push({ index: i, chunk: 0, text: t, cached: true, lang });
      stats.words += t.trim().split(/\s+/).filter(Boolean).length;
      stats.tokens += getTokenCount(t); // Use cached token calculation
      continue;
    }
    const key = makeCacheKey(lang, opts.target, t);
    
    // Check unified cache system
    const v = await _touchCache(key);
    
    if (v) {
      mapping.push({ index: i, chunk: 0, text: v.text, cached: true, lang });
      stats.words += t.trim().split(/\s+/).filter(Boolean).length;
      stats.tokens += getTokenCount(t); // Use cached token calculation
      continue;
    }
    
    // If not cached, add to mapping for translation (with text splitting if needed)
    let pieces;
    if (opts && opts.usePredictiveBatch && typeof predictive === 'function') {
      try {
        const batches = predictive([t], tokenBudget) || [];
        pieces = batches.map(arr => (Array.isArray(arr) ? arr.join(' ') : String(arr || ''))).filter(Boolean);
        if (!pieces.length) pieces = splitFn(t, tokenBudget);
      } catch {
        pieces = splitFn(t, tokenBudget);
      }
    } else {
      pieces = splitFn(t, tokenBudget);
    }
    pieces.forEach((p, idx) => mapping.push({ index: i, chunk: idx, text: p, lang }));
  }
  const byIndex = new Map();
  mapping.forEach(m => {
    if (!byIndex.has(m.index)) byIndex.set(m.index, []);
    byIndex.get(m.index).push(m);
  });

  const groups = [];
  // state per language: { items, tokens }
  const state = new Map();
  for (const m of mapping.filter(m => !m.cached)) {
    const tk = getTokenCount(m.text) + 1; // Use cached token calculation
    const lang = m.lang;
    let st = state.get(lang);
    if (!st) { st = { items: [], tokens: 0, lang }; state.set(lang, st); }
    if (st.items.length && (st.tokens + tk > tokenBudget || st.items.length >= maxBatchSize)) {
      groups.push({ items: st.items, lang: st.lang });
      st = { items: [], tokens: 0, lang };
      state.set(lang, st);
    }
    st.items.push(m);
    st.tokens += tk;
  }
  for (const st of state.values()) {
    if (st.items.length) groups.push({ items: st.items, lang: st.lang });
  }
  stats.totalRequests += groups.length;

  const providers = Array.isArray(opts.providerOrder) && opts.providerOrder.length ? opts.providerOrder : [];
  const strategy = (opts && typeof opts.strategy === 'string' ? opts.strategy : (cfg && cfg.strategy)) || 'balanced';
  const providerWeights = providers.map(id => {
    let w = 1;
    let t = throttleFor(id);
    let tokLim = 0;
    try {
      // Use existing provider if loaded, don't load on-demand for weight calculation
      const impl = Providers && Providers.get ? Providers.get(id) : null;
      const usage = t && t.getUsage ? t.getUsage() : {};
      tokLim = usage.tokenLimit || (impl && impl.throttle && impl.throttle.tokenLimit) || 0;
      const costIn = impl && impl.costPerInputToken != null ? impl.costPerInputToken : impl && impl.costPerToken != null ? impl.costPerToken : 1;
      const costOut = impl && impl.costPerOutputToken != null ? impl.costPerOutputToken : impl && impl.costPerToken != null ? impl.costPerToken : 0;
      const cost = costIn + costOut;
      if (impl && impl.weight != null) {
        w = impl.weight;
      } else {
        if (strategy === 'cheap') {
          w = cost > 0 ? (1 / cost) : 1;
        } else if (strategy === 'fast') {
          // Favor providers with higher available token capacity as a proxy for speed
          w = tokLim || 1;
        } else { // balanced
          w = cost > 0 ? ((tokLim || 0) / cost) : (tokLim || 1);
        }
      }
    } catch {}
    if (!Number.isFinite(w) || w <= 0) w = 1;
    return { id, weight: w, assigned: 0, throttle: t, tokenLimit: tokLim, usedTokens: 0 };
  });
  let providerReqLimit = 0;
  providers.forEach(id => {
    try {
      const t = throttleFor(id);
      const usage = t && t.getUsage ? t.getUsage() : {};
      let lim = usage.requestLimit;
      if (!lim && Providers && Providers.get) {
        const impl = Providers.get(id);
        lim = impl && impl.throttle && impl.throttle.requestLimit;
      }
      if (lim > 0) providerReqLimit += lim;
    } catch {}
  });
  function chooseProvider(tokensNeeded) {
    const eligible = providerWeights.filter(p => {
      if (p.tokenLimit > 0 && p.usedTokens + tokensNeeded > p.tokenLimit) return false;
      try {
        const u = p.throttle && p.throttle.getUsage ? p.throttle.getUsage() : {};
        if (u.tokenLimit > 0 && u.tokens + tokensNeeded > u.tokenLimit) return false;
      } catch {}
      return true;
    });
    const list = eligible.length ? eligible : providerWeights;
    let best = list[0];
    let minRatio = best.assigned / best.weight;
    for (const p of list) {
      const r = p.assigned / p.weight;
      if (r < minRatio) { best = p; minRatio = r; }
    }
    best.assigned++;
    best.usedTokens += tokensNeeded;
    return best.id;
  }
  const usage = getUsage ? getUsage() : {};
  let reqLimit = usage && usage.requestLimit > 0 ? usage.requestLimit : providerReqLimit;
  if (!reqLimit || reqLimit <= 0) reqLimit = groups.length;
  const runParallel = parallel === true || (parallel === 'auto' && reqLimit > 1);

  async function handleGroup(g, idx) {
    const joinedText = g.items.map(m => m.text.replaceAll(SEP, '')).join(SEP);
    const words = joinedText.replaceAll(SEP, ' ').trim().split(/\s+/).filter(Boolean).length;
    const tokensNeeded = getTokenCount(joinedText);
    const startProv = providers.length ? chooseProvider(tokensNeeded) : undefined;
    let res;
    let ms = 0;
    try {
      const timed = await trLogger.time(() => qwenTranslate({ ...opts, source: g.lang, text: joinedText, skipTM: true, noProxy: opts.noProxy, autoInit: opts.autoInit, provider: startProv, providerOrder: failover ? providers : undefined, failover }));
      res = timed.result;
      ms = timed.ms;
    } catch (e) {
      ms = e && e.latencyMs || 0;
      if (/HTTP\s+400/i.test(e.message || '')) throw e;
      g.items.forEach(m => { m.result = m.text; });
      stats.latencyMs += ms;
      return;
    }
    stats.latencyMs += ms;
    const tk = tokensNeeded;
    stats.tokens += tk;
    stats.words += words;
    stats.requests++;
    let translated = res && typeof res.text === 'string' ? res.text.split(SEP) : [];
    if (translated.length !== g.items.length) {
      const alt = res && typeof res.text === 'string' ? res.text.split('\uE000') : [];
      if (alt.length === g.items.length) {
        translated = alt;
      } else {
        if (tokenBudget > MIN_TOKEN_BUDGET) {
          dynamicTokenBudget = Math.max(MIN_TOKEN_BUDGET, Math.floor(tokenBudget / 2));
        }
        // Process individual items and batch cache operations
        const fallbackCachePromises = [];
        const fallbackTmPromises = [];
        
        for (const m of g.items) {
          let out;
          try {
            const single = await qwenTranslate({ ...opts, source: m.lang, text: m.text, skipTM: true, noProxy: opts.noProxy, autoInit: opts.autoInit, provider: startProv, providerOrder: failover ? providers : undefined, failover });
            out = single.text;
          } catch {
            out = m.text;
          }
          m.result = out;
          const key = makeCacheKey(m.lang, opts.target, m.text);
          
          // Batch cache operations instead of awaiting individually
          fallbackCachePromises.push(_setCache(key, { text: out }));
          if (TM && TM.set) { 
            fallbackTmPromises.push(TM.set(key, out).catch(() => {}));
          }
          
          stats.requests++;
          stats.tokens += getTokenCount(m.text);
          stats.words += m.text.trim().split(/\s+/).filter(Boolean).length;
        }
        
        // Execute all cache operations in parallel
        await Promise.all([
          Promise.all(fallbackCachePromises),
          Promise.all(fallbackTmPromises)
        ]);
        return;
      }
    }
    // Batch cache operations for better performance
    const cachePromises = [];
    const tmPromises = [];
    for (let i = 0; i < g.items.length; i++) {
      g.items[i].result = translated[i] || g.items[i].text;
      const key = makeCacheKey(g.lang, opts.target, g.items[i].text);
      cachePromises.push(_setCache(key, { text: g.items[i].result }));
      if (TM && TM.set) { 
        tmPromises.push(TM.set(key, g.items[i].result).catch(() => {}));
      }
    }
    // Execute cache operations in parallel
    await Promise.all([
      Promise.all(cachePromises),
      Promise.all(tmPromises)
    ]);
    const elapsedMs = Date.now() - stats.start;
    const avg = elapsedMs / stats.requests;
    const etaMs = avg * (stats.totalRequests - stats.requests);
    if (onProgress)
      onProgress({ phase: 'translate', request: stats.requests, requests: stats.totalRequests, sample: (g.items[0]?.text || '').slice(0, 80), elapsedMs, etaMs });
  }

  if (runParallel) {
    const limit = Math.min(reqLimit, groups.length);
    let next = 0;
    async function worker() {
      while (true) {
        const idx = next++;
        if (idx >= groups.length) break;
        await handleGroup(groups[idx], idx);
      }
    }
    const workers = new Array(limit).fill(0).map(() => worker());
    await Promise.all(workers);
  } else {
    for (let i = 0; i < groups.length; i++) {
      await handleGroup(groups[i], i);
    }
  }

  const results = new Array(texts.length).fill('');
  byIndex.forEach((arr, idx) => {
    const parts = arr
      .sort((a, b) => a.chunk - b.chunk)
      .map(m => (m.result !== undefined ? m.result : m.text));
    results[idx] = parts.join(' ').trim();
  });

  const retryTexts = [];
  const retryIdx = [];
  const retryLangs = [];
  for (let i = 0; i < results.length; i++) {
    const orig = (texts[i] || '').trim();
    const out = (results[i] || '').trim();
    const det = sourceByIndex[i];
    const lang = det || userSource;
    const arr = byIndex.get(i);
    if (orig && out === orig && lang !== opts.target && arr && arr[0] && !arr[0].cached) {
      retryTexts.push(orig);
      retryIdx.push(i);
      retryLangs.push(lang);
      const key = makeCacheKey(lang, opts.target, orig);
      if (cacheManager) {
        if (typeof cacheManager.delete === 'function') {
          cacheManager.delete(key);
        }
      } else {
        fallbackCache.delete(key);
      }
    }
  }
  if (retryTexts.length && retries > 0) {
    const retr = await qwenTranslateBatch({
      texts: retryTexts,
      tokenBudget,
      maxBatchSize,
      retries: retries - 1,
      onProgress,
      _stats: stats,
      parallel,
      failover,
      ...opts,
      source: 'auto'
    });
    for (let i = 0; i < retryIdx.length; i++) {
      results[retryIdx[i]] = retr.texts[i];
      const key = makeCacheKey(retryLangs[i], opts.target, retryTexts[i]);
      await _setCache(key, { text: retr.texts[i] });
      if (TM && TM.set) { try { TM.set(key, retr.texts[i]); } catch {} }
    }
  }

  if (!_stats) {
    stats.elapsedMs = Date.now() - stats.start;
    stats.wordsPerSecond = stats.words / (stats.elapsedMs / 1000 || 1);
    stats.wordsPerRequest = stats.words / (stats.requests || 1);
    stats.tokensPerRequest = stats.tokens / (stats.requests || 1);
    stats.avgRequestMs = stats.latencyMs / (stats.requests || 1);
    stats.requestsPerSecond = 1000 / (stats.avgRequestMs || 1);
    if (onProgress)
      onProgress({ phase: 'translate', request: stats.requests, requests: stats.totalRequests, done: true, stats });
  }

  return { texts: results, stats };
}

// splitLongText extracted to translator/batching.js
function qwenClearCache() {
  if (cacheManager && typeof cacheManager.clear === 'function') {
    cacheManager.clear();
  } else {
    fallbackCache.clear();
  }
  _persistClear();
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenTranslate = qwenTranslate;
  self.qwenTranslateStream = qwenTranslateStream;
  self.qwenTranslateBatch = qwenTranslateBatch;
  self.qwenClearCache = qwenClearCache;
  self.qwenIsCached = qwenIsCached;
  self.qwenSetTokenBudget = _setTokenBudget;
}
if (typeof module !== 'undefined') {
  module.exports = {
    qwenTranslate,
    qwenTranslateStream,
    qwenTranslateBatch,
    qwenClearCache,
    qwenIsCached,
    qwenSetCacheLimit,
    qwenSetCacheTTL,
    _setCacheEntryTimestamp,
    qwenGetCacheSize,
    _setGetUsage,
    _getTokenBudget,
  _setTokenBudget,
  _throttleKeys: () => Array.from(throttles.keys()),
  };
}
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
  window.qwenTranslateStream = qwenTranslateStream;
  window.qwenTranslateBatch = qwenTranslateBatch;
  window.qwenClearCache = qwenClearCache;
  window.qwenIsCached = qwenIsCached;
  window.qwenSetTokenBudget = _setTokenBudget;
  if (
    (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') &&
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.id
  ) {
    if (typeof module !== 'undefined') {
      window.__qwenTranslatorModule = module.exports;
    }
  }
}
let chooseStrategy = () => 'proxy';
try {
  if (typeof window !== 'undefined' && window.qwenFetchStrategy) chooseStrategy = window.qwenFetchStrategy.choose;
  else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenFetchStrategy) chooseStrategy = self.qwenFetchStrategy.choose;
  else if (typeof require !== 'undefined') chooseStrategy = require('./lib/fetchStrategy').choose;
} catch {}

})();
