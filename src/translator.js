(function () {
if (typeof window !== 'undefined') {
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
const cache = new Map();
let cacheApi = null;
try {
  if (typeof window !== 'undefined' && window.qwenCache) cacheApi = window.qwenCache;
  else if (typeof self !== 'undefined' && self.qwenCache) cacheApi = self.qwenCache;
  else if (typeof require !== 'undefined') cacheApi = require('./cache');
} catch {}
const {
  qwenSetCacheLimit = () => {},
  qwenSetCacheTTL = () => {},
  _setCacheEntryTimestamp = () => {},
  qwenClearCache: _persistClear = () => {},
  qwenGetCacheSize = () => 0,
} = cacheApi || {};
let getUsage = () => ({ cacheSize: cache.size, cacheMax: _memCacheMax() });
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
function _setCache(k, v) {
  if (cache.has(k)) cache.delete(k);
  cache.set(k, v);
  const max = _memCacheMax();
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}
function _touchCache(k) {
  const v = cache.get(k);
  if (v !== undefined) {
    cache.delete(k);
    cache.set(k, v);
    return v;
  }
  return undefined;
}
function _normText(t) {
  const s = String(t == null ? '' : t);
  const collapsed = s.replace(/\s+/g, ' ').trim();
  try { return collapsed.normalize('NFC'); } catch { return collapsed; }
}
function _key(source, target, text) {
  return `${source}:${target}:${_normText(text)}`;
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

function chooseProvider(opts) {
  if (Providers && typeof Providers.choose === 'function') return Providers.choose(opts);
  const ep = String(opts && opts.endpoint || '').toLowerCase();
  return ep.includes('dashscope') ? 'dashscope' : 'dashscope';
}
async function providerTranslate({ endpoint, apiKey, model, text, source, target, tone, signal, debug, onData, stream = true, provider, context = 'default', autoInit = false, providerOrder, endpoints, secondaryModel }) {
  _ensureProviders({ autoInit });
  const tokens = approxTokens(text);
  let chain;
  if (Array.isArray(providerOrder) && providerOrder.length) {
    const order = providerOrder.slice();
    if (provider && order.includes(provider)) {
      chain = order.slice(order.indexOf(provider));
    } else if (provider) {
      chain = [provider, ...order.filter(p => p !== provider)];
    } else {
      chain = order;
    }
  } else if (provider) {
    chain = [provider];
  } else if (Providers && typeof Providers.candidates === 'function') {
    chain = Providers.candidates({ endpoint, model });
  } else {
    chain = [chooseProvider({ endpoint, model })];
  }

  let lastErr = null;
  for (const id of chain) {
    if (!(Providers && typeof Providers.get === 'function')) break;
    const impl = Providers.get(id);
    if (!impl || typeof impl.translate !== 'function') continue;
    const ep = withSlash((endpoints && endpoints[id]) || endpoint || '');
    try {
      const t = throttleFor(id, context);
      return await t.runWithRetry(
        () => impl.translate({ endpoint: ep, apiKey, model, secondaryModel, text, source, target, tone, signal, debug, onData, stream }),
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

async function _detectSource(text, { detector, debug, noProxy, sensitivity = 0 } = {}) {
  const sample = String(text || '').slice(0, 2000);
  if (detector === 'google' && chooseStrategy({ noProxy }) === 'proxy' && messaging) {
    try {
      const r = await messaging.detectLanguage({ text: sample, detector: 'google', debug, sensitivity });
      if (r && r.lang) return r.lang;
    } catch {}
  }
  if (Detect && typeof Detect.detectLocal === 'function') {
    try {
      const r = Detect.detectLocal(sample, { sensitivity });
      if (r && r.lang) return r.lang;
    } catch {}
  }
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
    resp = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (debug) {
      trLogger.debug('response status', resp.status);
      trLogger.debug('response headers', Object.fromEntries(resp.headers.entries()));
    }
  } catch (e) {
    if (!stream && typeof XMLHttpRequest !== 'undefined') {
      if (debug) trLogger.debug('fetch failed, falling back to XHR');
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
    } else {
      e.retryable = true;
      throw e;
    }
  }
    if (!resp.ok) {
      const err = await resp
        .json()
        .catch(() => ({ message: resp.statusText }));
      const error = new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
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
      throw error;
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

async function qwenTranslate({ endpoint, apiKey, model, secondaryModel, text, source, target, signal, debug = false, stream = false, noProxy = false, provider, detector, force = false, skipTM = false, autoInit = false, providerOrder, endpoints, sensitivity = 0, failover = true }) {
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
  let src = source;
  if (!src || src === 'auto') {
    src = await _detectSource(text, { detector, debug, noProxy, sensitivity });
  }
  text = _applyGlossary(text);
  const tone = glossary && typeof glossary.getTone === 'function' ? glossary.getTone() : undefined;
  const prov = provider || (Providers && Providers.choose ? Providers.choose({ endpoint, model }) : chooseProvider({ endpoint, model }));
  const cacheKey = `${prov}:${_key(src, target, text)}`;
  if (!force && cache.has(cacheKey)) {
    return _touchCache(cacheKey);
  }

  // Persistent TM lookup
  if (!force && TM && TM.get) {
    try {
      const hit = await TM.get(cacheKey);
      if (hit && typeof hit.text === 'string') {
        const val = { text: hit.text };
        _setCache(cacheKey, val);
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
      _setCache(cacheKey, result);
      if (TM && TM.set && result && typeof result.text === 'string') { try { TM.set(cacheKey, result.text); } catch {} }
      return result;
    }

  try {
    const data = await providerTranslate({ endpoint, apiKey, model, text, source: src, target, tone, signal, debug, stream, provider: provider ? prov : undefined, context: stream ? 'stream' : 'default', autoInit, providerOrder: failover ? providerOrder : undefined, endpoints, secondaryModel });
    _setCache(cacheKey, data);
    if (!skipTM && TM && TM.set && data && typeof data.text === 'string') { try { TM.set(cacheKey, data.text); } catch {} }
    if (debug) {
      trLogger.debug('translation successful');
      trLogger.debug('final text', data.text);
    }
    return data;
  } catch (e) {
    trLogger.error('translation request failed', e && e.message, e);
    throw e;
  }
}

async function qwenTranslateStream({ endpoint, apiKey, model, secondaryModel, text, source, target, signal, debug = false, stream = true, noProxy = false, provider, detector, skipTM = false, autoInit = false, providerOrder, endpoints, sensitivity = 0, failover = true }, onData) {
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
  let src = source;
  if (!src || src === 'auto') {
    src = await _detectSource(text, { detector, debug, noProxy, sensitivity });
  }
  text = _applyGlossary(text);
  const tone = glossary && typeof glossary.getTone === 'function' ? glossary.getTone() : undefined;
  const prov = provider || (Providers && Providers.choose ? Providers.choose({ endpoint, model }) : chooseProvider({ endpoint, model }));
  const cacheKey = `${prov}:${_key(src, target, text)}`;
  if (cache.has(cacheKey)) {
    const data = _touchCache(cacheKey);
    if (onData) onData(data.text);
    return data;
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
      _setCache(cacheKey, data);
      if (TM && TM.set && data && typeof data.text === 'string') { try { TM.set(cacheKey, data.text); } catch {} }
      return data;
    }

  try {
    const data = await providerTranslate({ endpoint, apiKey, model, text, source: src, target, tone, signal, debug, onData, stream, provider: prov, context: 'stream', autoInit, providerOrder: failover ? providerOrder : undefined, endpoints, secondaryModel });
    _setCache(cacheKey, data);
    if (!skipTM && TM && TM.set && data && typeof data.text === 'string') { try { TM.set(cacheKey, data.text); } catch {} }
    if (debug) {
      trLogger.debug('translation successful');
      trLogger.debug('final text', data.text);
    }
    return data;
  } catch (e) {
    trLogger.error('translation request failed', e && e.message, e);
    throw e;
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
  let source = opts.source;
  const autoMode = !source || source === 'auto';
  const sourceByIndex = new Array(texts.length);
  if (autoMode) {
    for (let i = 0; i < texts.length; i++) {
      sourceByIndex[i] = await _detectSource(texts[i], { detector: opts.detector, debug: opts.debug, noProxy: opts.noProxy, sensitivity: opts.sensitivity });
    }
    source = sourceByIndex[0];
  } else {
    for (let i = 0; i < texts.length; i++) sourceByIndex[i] = source;
  }
  if (glossary) {
    texts = texts.map(t => _applyGlossary(t));
  }
  const SEP = makeDelimiter();
  // Warm TM using per-text language keys (autoMode) or fixed source
  if (TM && TM.get) {
    const missingKeys = [];
    const seen = new Set();
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const lang = sourceByIndex[i];
      const key = _key(lang, opts.target, t);
      if (!cache.has(key) && !seen.has(key)) {
        seen.add(key);
        missingKeys.push(key);
      }
    }
    if (missingKeys.length) {
      const hits = await Promise.all(missingKeys.map(k => TM.get(k).catch(() => null)));
      for (let i = 0; i < missingKeys.length; i++) {
        const h = hits[i];
        if (h && typeof h.text === 'string') {
          _setCache(missingKeys[i], { text: h.text });
        }
      }
    }
  }

  const mapping = [];
  texts.forEach((t, i) => {
    const lang = autoMode ? sourceByIndex[i] : source;
    const key = _key(lang, opts.target, t);
    if (cache.has(key)) {
      const v = _touchCache(key) || cache.get(key);
      mapping.push({ index: i, chunk: 0, text: v.text, cached: true, lang });
      stats.words += t.trim().split(/\s+/).filter(Boolean).length;
      stats.tokens += approxTokens(t);
      return;
    }
    const pieces = splitLongText(t, tokenBudget);
    pieces.forEach((p, idx) => mapping.push({ index: i, chunk: idx, text: p, lang }));
  });
  const byIndex = new Map();
  mapping.forEach(m => {
    if (!byIndex.has(m.index)) byIndex.set(m.index, []);
    byIndex.get(m.index).push(m);
  });

  const groups = [];
  // state per language: { items, tokens }
  const state = new Map();
  for (const m of mapping.filter(m => !m.cached)) {
    const tk = approxTokens(m.text) + 1;
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
  const providerWeights = providers.map(id => {
    let w = 1;
    let t = throttleFor(id);
    let tokLim = 0;
    try {
      const impl = Providers && Providers.get ? Providers.get(id) : null;
      const usage = t && t.getUsage ? t.getUsage() : {};
      tokLim = usage.tokenLimit || (impl && impl.throttle && impl.throttle.tokenLimit) || 0;
      const costIn = impl && impl.costPerInputToken != null ? impl.costPerInputToken : impl && impl.costPerToken != null ? impl.costPerToken : 1;
      const costOut = impl && impl.costPerOutputToken != null ? impl.costPerOutputToken : impl && impl.costPerToken != null ? impl.costPerToken : 0;
      const cost = costIn + costOut;
      w = impl && impl.weight != null ? impl.weight : (cost > 0 ? (tokLim || 0) / cost : tokLim || 1);
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
    const tokensNeeded = approxTokens(joinedText);
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
        for (const m of g.items) {
          let out;
          try {
            const single = await qwenTranslate({ ...opts, source: m.lang, text: m.text, skipTM: true, noProxy: opts.noProxy, autoInit: opts.autoInit, provider: startProv, providerOrder: failover ? providers : undefined, failover });
            out = single.text;
          } catch {
            out = m.text;
          }
          m.result = out;
          const key = _key(m.lang, opts.target, m.text);
          _setCache(key, { text: out });
          if (TM && TM.set) { try { TM.set(key, out); } catch {} }
          stats.requests++;
          stats.tokens += approxTokens(m.text);
          stats.words += m.text.trim().split(/\s+/).filter(Boolean).length;
        }
        return;
      }
    }
    for (let i = 0; i < g.items.length; i++) {
      g.items[i].result = translated[i] || g.items[i].text;
      const key = _key(g.lang, opts.target, g.items[i].text);
      _setCache(key, { text: g.items[i].result });
      if (TM && TM.set) { try { TM.set(key, g.items[i].result); } catch {} }
    }
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
    const lang = (autoMode ? sourceByIndex[i] : source);
    if (orig && out === orig && lang !== opts.target) {
      retryTexts.push(orig);
      retryIdx.push(i);
      retryLangs.push(lang);
      const key = _key(lang, opts.target, orig);
      cache.delete(key);
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
      const key = _key(retryLangs[i], opts.target, retryTexts[i]);
      _setCache(key, { text: retr.texts[i] });
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

function splitLongText(text, maxTokens) {
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
}
function qwenClearCache() {
  cache.clear();
  _persistClear();
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenTranslate = qwenTranslate;
  self.qwenTranslateStream = qwenTranslateStream;
  self.qwenTranslateBatch = qwenTranslateBatch;
  self.qwenClearCache = qwenClearCache;
  self.qwenSetTokenBudget = _setTokenBudget;
}
if (typeof module !== 'undefined') {
  module.exports = {
    qwenTranslate,
    qwenTranslateStream,
    qwenTranslateBatch,
    qwenClearCache,
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
  window.qwenSetTokenBudget = _setTokenBudget;
  window.__qwenTranslatorModule = module.exports;
}
let chooseStrategy = () => 'proxy';
try {
  if (typeof window !== 'undefined' && window.qwenFetchStrategy) chooseStrategy = window.qwenFetchStrategy.choose;
  else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenFetchStrategy) chooseStrategy = self.qwenFetchStrategy.choose;
  else if (typeof require !== 'undefined') chooseStrategy = require('./lib/fetchStrategy').choose;
} catch {}

})();
