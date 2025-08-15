var translateRequest;
var streamRequest;
var cacheReady;
var getCache;
var setCache;
var removeCache;
var qwenClearCache;
var qwenGetCacheSize;
var qwenSetCacheLimit;
var qwenSetCacheTTL;
var _setMaxCacheEntries;
var _setCacheTTL;
var _setCacheEntryTimestamp;
var LZString;
var attempts = 6;
var runWithRateLimit;
var approxTokens;
var getUsage;
var qwenTranslateStream;

function _setGetUsage(fn) {
  getUsage = fn;
}

if (typeof window === 'undefined') {
  if (typeof self !== 'undefined' && self.qwenTransport) {
    ({ translateRequest, streamRequest } = self.qwenTransport);
  } else {
    ({ translateRequest, streamRequest } = require('./transport'));
  }
  ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
  ({ runWithRateLimit, approxTokens, getUsage } = require('./throttle'));
} else {
  if (window.qwenTransport) {
    ({ translateRequest, streamRequest } = window.qwenTransport);
  } else if (typeof self !== 'undefined' && self.qwenTransport) {
    ({ translateRequest, streamRequest } = self.qwenTransport);
  } else if (typeof require !== 'undefined') {
    ({ translateRequest, streamRequest } = require('./transport'));
  }
  if (window.qwenThrottle) {
    ({ runWithRateLimit, approxTokens, getUsage } = window.qwenThrottle);
  } else if (typeof self !== 'undefined' && self.qwenThrottle) {
    ({ runWithRateLimit, approxTokens, getUsage } = self.qwenThrottle);
  } else if (typeof require !== 'undefined') {
    ({ runWithRateLimit, approxTokens, getUsage } = require('./throttle'));
  } else {
    runWithRateLimit = fn => fn();
    approxTokens = () => 0;
    getUsage = () => ({ requestLimit: 1, tokenLimit: 1, requests: 0, tokens: 0 });
  }
  if (window.qwenCache) {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = window.qwenCache);
  } else if (typeof self !== 'undefined' && self.qwenCache) {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = self.qwenCache);
  } else if (typeof require !== 'undefined') {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
  }
}

<<<<<<< HEAD
let logger = console;
try {
  if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenLogger) {
    logger = self.qwenLogger.create('translator');
  } else if (typeof window !== 'undefined' && window.qwenLogger) {
    logger = window.qwenLogger.create('translator');
  } else if (typeof require !== 'undefined') {
    try { logger = require('./lib/logger').create('translator'); } catch {}
  }
} catch {}
const cache = new Map();

function _memCacheMax() {
  try { if (typeof self !== 'undefined' && self.qwenConfig && self.qwenConfig.memCacheMax) return self.qwenConfig.memCacheMax | 0; } catch {}
  try { if (typeof window !== 'undefined' && window.qwenConfig && window.qwenConfig.memCacheMax) return window.qwenConfig.memCacheMax | 0; } catch {}
  try { if (typeof process !== 'undefined' && process.env && process.env.QWEN_MEMCACHE_MAX) return parseInt(process.env.QWEN_MEMCACHE_MAX, 10) || 5000; } catch {}
  return 5000;
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
    try { Providers = require('./lib/providers'); } catch {}
  }
} catch {}

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
      if (debug) logger.debug('XHR status', xhr.status);
      resolve(resp);
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body);
  });
=======
if (typeof translateRequest !== 'function') {
  const mod = require('./transport');
  translateRequest = mod.translateRequest || mod.translate;
  streamRequest = mod.streamRequest || mod.translate;
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
}

const MODEL_PRICES = { 'qwen-mt-turbo': 1, 'qwen-mt-plus': 2 };
let modelRR = 0;

<<<<<<< HEAD
function chooseProvider(opts) {
  if (Providers && typeof Providers.choose === 'function') return Providers.choose(opts);
  const ep = String(opts && opts.endpoint || '').toLowerCase();
  return ep.includes('dashscope') ? 'dashscope' : 'dashscope';
}
async function providerTranslate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true, provider }) {
  const tokens = approxTokens(text);
  const chain = [];
  if (provider) {
    chain.push(provider);
  } else if (Providers && typeof Providers.candidates === 'function') {
    chain.push(...Providers.candidates({ endpoint, model }));
  } else {
    chain.push(chooseProvider({ endpoint, model }));
  }

  let lastErr = null;
  for (const id of chain) {
    if (!(Providers && typeof Providers.get === 'function')) break;
    const impl = Providers.get(id);
    if (!impl || typeof impl.translate !== 'function') continue;
    try {
      return await runWithRetry(
        () => runWithRateLimit(
          () => impl.translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream }),
          tokens
        ),
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

  // Fallback: internal fetch with retry and rate limit
  return await runWithRetry(
    () => runWithRateLimit(
      () => doFetch({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream }),
      tokens
    ),
    tokens,
    3,
    debug
  ).catch(e => { throw lastErr || e; });
}

async function _detectSource(text, { detector, debug, noProxy } = {}) {
  const sample = String(text || '').slice(0, 2000);
  if (detector === 'google' && messaging && typeof chrome !== 'undefined' && chrome.runtime && !noProxy) {
    try {
      const r = await messaging.detectLanguage({ text: sample, detector: 'google', debug });
      if (r && r.lang) return r.lang;
    } catch {}
  }
  if (Detect && typeof Detect.detectLocal === 'function') {
    try {
      const r = Detect.detectLocal(sample);
      if (r && r.lang) return r.lang;
    } catch {}
  }
  return 'en';
}

async function doFetch({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
  const url = `${withSlash(endpoint)}services/aigc/text-generation/generation`;
  if (debug) {
    logger.debug('sending translation request to', url);
    logger.debug('request params', { model, source, target, text });
  }
  const body = {
    model,
    input: { messages: [{ role: 'user', content: text }] },
    parameters: {
      translation_options: { source_lang: source, target_lang: target },
    },
  };
  if (debug) logger.debug('request body', body);
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
      logger.debug('response status', resp.status);
      logger.debug('response headers', Object.fromEntries(resp.headers.entries()));
    }
  } catch (e) {
    if (!stream && typeof XMLHttpRequest !== 'undefined') {
      if (debug) logger.debug('fetch failed, falling back to XHR');
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
      if (debug) logger.debug('HTTP error response', error.message);
      if (resp.status >= 500 || resp.status === 429) {
        error.retryable = true;
        const ra = resp.headers.get('retry-after');
        if (ra) {
          const ms = parseInt(ra, 10) * 1000;
          if (ms > 0) error.retryAfter = ms;
=======
function orderModels(list, strategy) {
  const models = list.slice();
  const usage = getUsage ? getUsage() : {};
  switch (strategy) {
    case 'max-speed': {
      if (!models.length) return models;
      const idx = modelRR % models.length;
      modelRR++;
      return models.slice(idx).concat(models.slice(0, idx));
    }
    case 'balanced': {
      if (models.length > 1) {
        const ratio = usage.requestLimit ? usage.requests / usage.requestLimit : 0;
        if (ratio > 0.5) {
          const [first, ...rest] = models;
          return rest.concat(first);
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
        }
      }
      return models;
    }
<<<<<<< HEAD
  if (!stream || !resp.body || typeof resp.body.getReader !== 'function') {
    if (debug) logger.debug('received non-streaming response');
    const data = await resp.json();
    const text =
      data.output?.text ||
      data.output?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('Invalid API response');
    }
    return { text };
  }

  if (debug) logger.debug('reading streaming response');

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
      if (debug) logger.debug('raw line', data);
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
        if (debug && chunk) logger.debug('chunk received', chunk);
      } catch {}
    }
  }
  return { text: result };
}

async function qwenTranslate({ endpoint, apiKey, model, text, source, target, signal, debug = false, stream = false, noProxy = false, provider, detector }) {
  if (debug) {
    logger.debug('qwenTranslate called with', {
=======
    case 'max-saving':
    default:
      return models.sort((a, b) => (MODEL_PRICES[a] || 99) - (MODEL_PRICES[b] || 99));
  }
}

async function qwenTranslate({ provider = 'qwen', endpoint, apiKey, model, models, failover = 'balanced', text, source, target, signal, debug = false, stream = false, noProxy = false, onRetry, retryDelay, force = false, domain }) {
  await cacheReady;
  const baseList = Array.isArray(models) ? models : Array.isArray(model) ? model : [model];
  const modelList = orderModels(baseList, failover);
  const selectedModel = modelList[0];
  if (debug) {
    console.log('QTDEBUG: qwenTranslate called with', {
      provider,
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
      endpoint,
      apiKeySet: Boolean(apiKey),
      models: modelList,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
<<<<<<< HEAD
  let src = source;
  if (!src || src === 'auto') {
    src = await _detectSource(text, { detector, debug, noProxy });
  }
  const cacheKey = _key(src, target, text);
  if (cache.has(cacheKey)) {
    return _touchCache(cacheKey);
  }

  // Persistent TM lookup
  if (TM && TM.get) {
    try {
      const hit = await TM.get(cacheKey);
      if (hit && typeof hit.text === 'string') {
        const val = { text: hit.text };
        _setCache(cacheKey, val);
        return val;
      }
    } catch {}
  }

    if (!noProxy && messaging && typeof chrome !== 'undefined' && chrome.runtime) {
      const result = await messaging.requestViaBackground({
        endpoint: withSlash(endpoint),
        apiKey, model, text, source: src, target, debug, stream: false, signal, provider
      });
      _setCache(cacheKey, result);
      if (TM && TM.set && result && typeof result.text === 'string') { try { TM.set(cacheKey, result.text); } catch {} }
      return result;
    }

  try {
    const data = await providerTranslate({ endpoint, apiKey, model, text, source: src, target, signal, debug, stream, provider });
    _setCache(cacheKey, data);
    if (TM && TM.set && data && typeof data.text === 'string') { try { TM.set(cacheKey, data.text); } catch {} }
    if (debug) {
      logger.debug('translation successful');
      logger.debug('final text', data.text);
    }
    return data;
  } catch (e) {
    logger.error('translation request failed', e);
    throw e;
  }
}

async function qwenTranslateStream({ endpoint, apiKey, model, text, source, target, signal, debug = false, stream = true, noProxy = false, provider, detector }, onData) {
  if (debug) {
    logger.debug('qwenTranslateStream called with', {
=======
  const cacheKey = `${provider}:${source}:${target}:${text}`;
  if (!force) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  if (
    !noProxy &&
    typeof window !== 'undefined' &&
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.sendMessage
  ) {
    const ep = endpoint;
    if (debug) console.log('QTDEBUG: requesting translation via background script');
    const result = await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            action: 'translate',
      opts: { provider, endpoint: ep, apiKey, model: selectedModel, models: modelList, failover, text, source, target, debug },
          },
          res => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(res);
            }
          }
        );
      } catch (err) {
        reject(err);
      }
    });
    if (!result) {
      throw new Error('No response from background');
    }
    if (result.error) {
      throw new Error(result.error);
    }
    if (debug) console.log('QTDEBUG: background response received');
    setCache(cacheKey, result, domain);
    return result;
  }

  for (let i = 0; i < modelList.length; i++) {
    const m = modelList[i];
    try {
      const attempts = 3;
      const data = await translateRequest({
        provider,
        endpoint,
        apiKey,
        model: m,
        text,
        source,
        target,
        signal,
        debug,
        stream,
        onRetry,
        retryDelay,
        attempts,
      });
      setCache(cacheKey, data, domain);
      if (debug) {
        console.log('QTDEBUG: translation successful');
        console.log('QTDEBUG: final text', data.text);
      }
      return data;
    } catch (e) {
      if (i === modelList.length - 1) {
        console.error('QTERROR: translation request failed', e);
        throw e;
    }
  }
}

qwenTranslateStream = async function ({ provider = 'qwen', endpoint, apiKey, model, models, failover = 'balanced', text, source, target, signal, debug = false, stream = true, noProxy = false, onRetry, retryDelay, force = false, domain }, onData) {
  await cacheReady;
  const baseList = Array.isArray(models) ? models : Array.isArray(model) ? model : [model];
  const modelList = orderModels(baseList, failover);
  if (debug) {
    const modelList = Array.isArray(model) ? model : [model];
    console.log('QTDEBUG: qwenTranslateStream called with', {
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
      endpoint,
      apiKeySet: Boolean(apiKey),
      models: modelList,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
<<<<<<< HEAD
  let src = source;
  if (!src || src === 'auto') {
    src = await _detectSource(text, { detector, debug, noProxy });
  }
  const cacheKey = _key(src, target, text);
  if (cache.has(cacheKey)) {
    const data = _touchCache(cacheKey);
    if (onData) onData(data.text);
    return data;
  }

    if (!noProxy && messaging && typeof chrome !== 'undefined' && chrome.runtime) {
      const data = await messaging.requestViaBackground({
        endpoint: withSlash(endpoint),
        apiKey, model, text, source: src, target, debug, stream: true, signal, onData, provider
      });
      _setCache(cacheKey, data);
      if (TM && TM.set && data && typeof data.text === 'string') { try { TM.set(cacheKey, data.text); } catch {} }
      return data;
    }

  try {
    const data = await providerTranslate({ endpoint, apiKey, model, text, source: src, target, signal, debug, onData, stream, provider });
    _setCache(cacheKey, data);
    if (TM && TM.set && data && typeof data.text === 'string') { try { TM.set(cacheKey, data.text); } catch {} }
    if (debug) {
      logger.debug('translation successful');
      logger.debug('final text', data.text);
    }
    return data;
  } catch (e) {
    logger.error('translation request failed', e);
    throw e;
=======
  const cacheKey = `${provider}:${source}:${target}:${text}`;
  if (!force) {
    const data = getCache(cacheKey);
    if (data) {
      if (onData) onData(data.text);
      return data;
    }
  }
  for (let i = 0; i < modelList.length; i++) {
    const m = modelList[i];
    try {
        const attempts = 3;
        const data = await streamRequest(
          {
            provider,
            endpoint,
            apiKey,
            model: m,
            text,
            source,
            target,
            signal,
            debug,
            stream,
            onRetry,
            retryDelay,
            attempts,
          },
          onData
        );
        setCache(cacheKey, data, domain);
        if (debug) {
          console.log('QTDEBUG: translation successful');
          console.log('QTDEBUG: final text', data.text);
        }
        return data;
      } catch (e) {
        if (i === modelList.length - 1) {
          console.error('QTERROR: translation request failed', e);
          throw e;
        }
      }
    }
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
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
  try {
    const usage = getUsage ? getUsage() : {};
    const remainingReq = Math.max(1, (usage.requestLimit || 1) - (usage.requests || 0));
    const remainingTok = Math.max(1, (usage.tokenLimit || 1) - (usage.tokens || 0));
    const per = Math.floor(remainingTok / remainingReq);
    if (per > tokenBudget) tokenBudget = per;
  } catch {}
  while (true) {
    try {
      const res = await batchOnce({ ...params, tokenBudget, onRetry: params.onRetry, retryDelay: params.retryDelay });
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
  onRetry,
  retryDelay,
  _stats,
  ...opts
}) {
  const stats = _stats || { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0 };
  let source = opts.source;
  if (!source || source === 'auto') {
    const sample = texts.slice(0, 5).join(' ').slice(0, 2000);
    source = await _detectSource(sample, { detector: opts.detector, debug: opts.debug, noProxy: opts.noProxy });
  }
  const autoMode = !opts.source || opts.source === 'auto';
  // Per-text language map used when auto-detecting
  const textLang = new Map();
  const sourceByIndex = new Array(texts.length);
  if (autoMode) {
    const seenNorm = new Set();
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i] || '';
      const norm = _normText(t);
      if (!seenNorm.has(norm)) {
        seenNorm.add(norm);
        let lang = source;
        try {
          if (Detect && typeof Detect.detectLocal === 'function') {
            const r = Detect.detectLocal(norm);
            if (r && r.lang) lang = r.lang;
          }
        } catch {}
        textLang.set(norm, lang);
      }
      sourceByIndex[i] = textLang.get(norm) || source;
    }
  } else {
    for (let i = 0; i < texts.length; i++) sourceByIndex[i] = source;
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

  for (const g of groups) {
    const joinedText = g.items.map(m => m.text.replaceAll(SEP, '')).join(SEP);
    const words = joinedText.replaceAll(SEP, ' ').trim().split(/\s+/).filter(Boolean).length;
    let res;
    try {
<<<<<<< HEAD
      res = await qwenTranslate({ ...opts, source: g.lang, text: joinedText });
=======
      res = await qwenTranslate({ ...opts, text: joinedText, onRetry, retryDelay });
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
    } catch (e) {
      if (/HTTP\s+400/i.test(e.message || '')) throw e;
      g.items.forEach(m => { m.result = m.text; });
      continue;
    }
    const tk = approxTokens(joinedText);
    stats.tokens += tk;
    stats.words += words;
    stats.requests++;
<<<<<<< HEAD
    let translated = res && typeof res.text === 'string' ? res.text.split(SEP) : [];
    if (translated.length !== g.items.length) {
      const alt = res && typeof res.text === 'string' ? res.text.split('\uE000') : [];
      if (alt.length === g.items.length) {
        translated = alt;
      } else {
        if (tokenBudget > MIN_TOKEN_BUDGET) {
          dynamicTokenBudget = Math.max(MIN_TOKEN_BUDGET, Math.floor(tokenBudget / 2));
=======
    const translated = res && typeof res.text === 'string' ? res.text.split(SEP) : [];
    if (translated.length !== g.length) {
      if (tokenBudget > MIN_TOKEN_BUDGET) {
        dynamicTokenBudget = Math.max(MIN_TOKEN_BUDGET, Math.floor(tokenBudget / 2));
      }
      for (const m of g) {
        let out;
        try {
          const single = await qwenTranslate({ ...opts, text: m.text, onRetry, retryDelay });
          out = single.text;
        } catch {
          out = m.text;
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
        }
        for (const m of g.items) {
          let out;
          try {
            const single = await qwenTranslate({ ...opts, source: m.lang, text: m.text });
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
        continue;
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
      onRetry,
      retryDelay,
      _stats: stats,
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
  if (typeof window !== 'undefined') {
    window.qwenTranslate = qwenTranslate;
    window.qwenTranslateStream = qwenTranslateStream;
    window.qwenClearCache = qwenClearCache;
    window.qwenGetCacheSize = qwenGetCacheSize;
    window.qwenGetCompressionErrors = qwenGetCompressionErrors;
    window.qwenSetCacheLimit = qwenSetCacheLimit;
    window.qwenSetCacheTTL = qwenSetCacheTTL;
    window._setGetUsage = _setGetUsage;
    window.qwenSetTokenBudget = _setTokenBudget;
    window.qwenGetTokenBudget = _getTokenBudget;
    window._setTokenBudget = _setTokenBudget;
    window._getTokenBudget = _getTokenBudget;
  }
  if (typeof self !== 'undefined' && typeof window === 'undefined') {
    self.qwenTranslate = qwenTranslate;
    self.qwenTranslateStream = qwenTranslateStream;
    self.qwenClearCache = qwenClearCache;
    self.qwenGetCacheSize = qwenGetCacheSize;
    self.qwenGetCompressionErrors = qwenGetCompressionErrors;
    self.qwenSetCacheLimit = qwenSetCacheLimit;
    self.qwenSetCacheTTL = qwenSetCacheTTL;
    self._setGetUsage = _setGetUsage;
    self.qwenSetTokenBudget = _setTokenBudget;
    self.qwenGetTokenBudget = _getTokenBudget;
    self._setTokenBudget = _setTokenBudget;
    self._getTokenBudget = _getTokenBudget;
  }
  if (typeof module !== 'undefined') {
    module.exports = {
      qwenTranslate,
      qwenTranslateStream,
      qwenClearCache,
      qwenGetCacheSize,
      qwenSetCacheLimit,
      qwenSetCacheTTL,
      _setGetUsage,
      _getTokenBudget,
      _setTokenBudget,
      _setMaxCacheEntries,
      _setCacheTTL,
      _setCacheEntryTimestamp,
    };
  }
