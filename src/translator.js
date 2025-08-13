var runWithRateLimit;
var runWithRetry;
var approxTokens;
var getUsage;
var LZString;
var getProvider;

if (typeof window === 'undefined') {
  if (typeof self !== 'undefined' && self.qwenThrottle) {
    ({ runWithRateLimit, runWithRetry, approxTokens, getUsage } = self.qwenThrottle);
    LZString = self.LZString;
  } else {
    ({ runWithRateLimit, runWithRetry, approxTokens, getUsage } = require('./throttle'));
    LZString = require('lz-string');
    ({ getProvider } = require('./providers'));
    require('./providers/qwen');
  }
} else {
  if (window.qwenThrottle) {
    ({ runWithRateLimit, runWithRetry, approxTokens, getUsage } = window.qwenThrottle);
  } else if (typeof require !== 'undefined') {
    ({ runWithRateLimit, runWithRetry, approxTokens, getUsage } = require('./throttle'));
  } else {
    runWithRateLimit = fn => fn();
    runWithRetry = fn => fn();
    approxTokens = () => 0;
    getUsage = () => ({ requestLimit: 1, tokenLimit: 1, requests: 0, tokens: 0 });
  }
  LZString = (typeof window !== 'undefined' ? window.LZString : undefined) ||
    (typeof self !== 'undefined' ? self.LZString : undefined) ||
    (typeof require !== 'undefined' ? require('lz-string') : undefined);
  if (typeof window !== 'undefined' && window.qwenProviders) {
    ({ getProvider } = window.qwenProviders);
  } else if (typeof self !== 'undefined' && self.qwenProviders) {
    ({ getProvider } = self.qwenProviders);
  } else if (typeof require !== 'undefined' && !getProvider) {
    ({ getProvider } = require('./providers'));
    require('./providers/qwen');
  }
}

const cache = new Map();
let MAX_CACHE_ENTRIES = 1000;
let CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
let cacheReady = Promise.resolve();

function encodeCacheValue(val) {
  try {
    const json = JSON.stringify(val);
    return LZString ? LZString.compressToUTF16(json) : json;
  } catch {
    return val;
  }
}

function decodeCacheValue(val) {
  if (typeof val !== 'string') return val;
  if (LZString) {
    try {
      const json = LZString.decompressFromUTF16(val);
      if (json) return JSON.parse(json);
    } catch {}
  }
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  cacheReady = new Promise(resolve => {
    chrome.storage.local.get(['qwenCache'], res => {
      const data = res && res.qwenCache ? res.qwenCache : {};
      const pruned = {};
      const now = Date.now();
      Object.entries(data).forEach(([k, v]) => {
        const val = decodeCacheValue(v);
        if (val && (!val.ts || now - val.ts <= CACHE_TTL_MS)) {
          cache.set(k, val);
          pruned[k] = v;
        }
      });
      chrome.storage.local.set({ qwenCache: pruned });
      resolve();
    });
  });
} else if (typeof localStorage !== 'undefined') {
  try {
    const data = JSON.parse(localStorage.getItem('qwenCache') || '{}');
    const pruned = {};
    const now = Date.now();
    Object.entries(data).forEach(([k, v]) => {
      const val = decodeCacheValue(v);
      if (val && (!val.ts || now - val.ts <= CACHE_TTL_MS)) {
        cache.set(k, val);
        pruned[k] = v;
      }
    });
    localStorage.setItem('qwenCache', JSON.stringify(pruned));
  } catch {}
}

function persistCache(key, value) {
  const encoded = encodeCacheValue(value);
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['qwenCache'], res => {
      const obj = res && res.qwenCache ? res.qwenCache : {};
      obj[key] = encoded;
      chrome.storage.local.set({ qwenCache: obj });
    });
  } else if (typeof localStorage !== 'undefined') {
    try {
      const obj = JSON.parse(localStorage.getItem('qwenCache') || '{}');
      obj[key] = encoded;
      localStorage.setItem('qwenCache', JSON.stringify(obj));
    } catch {}
  }
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return;
  if (entry.ts && Date.now() - entry.ts > CACHE_TTL_MS) {
    removeCache(key);
    return;
  }
  return entry;
}

function setCache(key, value) {
  const entry = { ...value, ts: Date.now() };
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value;
    removeCache(first);
  }
  persistCache(key, entry);
}

function removeCache(key) {
  cache.delete(key);
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['qwenCache'], res => {
      const obj = res && res.qwenCache ? res.qwenCache : {};
      delete obj[key];
      chrome.storage.local.set({ qwenCache: obj });
    });
  } else if (typeof localStorage !== 'undefined') {
    try {
      const obj = JSON.parse(localStorage.getItem('qwenCache') || '{}');
      delete obj[key];
      localStorage.setItem('qwenCache', JSON.stringify(obj));
    } catch {}
  }
}


async function qwenTranslate({ provider = 'qwen', endpoint, apiKey, model, text, source, target, signal, debug = false, stream = false, noProxy = false, onRetry, retryDelay, force = false }) {
  await cacheReady;
  if (debug) {
    console.log('QTDEBUG: qwenTranslate called with', {
      provider,
      endpoint,
      apiKeySet: Boolean(apiKey),
      model,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
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
            opts: { provider, endpoint: ep, apiKey, model, text, source, target, debug },
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
    setCache(cacheKey, result);
    return result;
  }

  try {
    const data = await runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ endpoint, apiKey, model, text, source, target, signal, debug, stream });
      },
      approxTokens(text),
      { attempts: 3, debug, onRetry, retryDelay }
    );
    setCache(cacheKey, data);
    if (debug) {
      console.log('QTDEBUG: translation successful');
      console.log('QTDEBUG: final text', data.text);
    }
    return data;
  } catch (e) {
    console.error('QTERROR: translation request failed', e);
    throw e;
  }
}

async function qwenTranslateStream({ provider = 'qwen', endpoint, apiKey, model, text, source, target, signal, debug = false, stream = true, noProxy = false, onRetry, retryDelay, force = false }, onData) {
  await cacheReady;
  if (debug) {
    console.log('QTDEBUG: qwenTranslateStream called with', {
      endpoint,
      apiKeySet: Boolean(apiKey),
      model,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
  const cacheKey = `${provider}:${source}:${target}:${text}`;
  if (!force) {
    const data = getCache(cacheKey);
    if (data) {
      if (onData) onData(data.text);
      return data;
    }
  }
  try {
    const data = await runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream });
      },
      approxTokens(text),
      { attempts: 3, debug, onRetry, retryDelay }
    );
    setCache(cacheKey, data);
    if (debug) {
      console.log('QTDEBUG: translation successful');
      console.log('QTDEBUG: final text', data.text);
    }
    return data;
  } catch (e) {
    console.error('QTERROR: translation request failed', e);
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
  await cacheReady;
  const stats = _stats || { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0 };
  const SEP = '\uE000';

  const provider = opts.provider || 'qwen';
  const mapping = [];
  const seen = new Map();
  const dupes = new Map();
  texts.forEach((t, i) => {
    const key = `${provider}:${opts.source}:${opts.target}:${t}`;
    if (!opts.force) {
      const cached = getCache(key);
      if (cached) {
        mapping.push({ index: i, chunk: 0, text: cached.text, cached: true });
        seen.set(key, i);
        return;
      }
    }
    if (seen.has(key)) {
      const orig = seen.get(key);
      if (!dupes.has(orig)) dupes.set(orig, []);
      dupes.get(orig).push(i);
      return;
    }
    seen.set(key, i);
    const pieces = splitLongText(t, tokenBudget);
    pieces.forEach((p, idx) => mapping.push({ index: i, chunk: idx, text: p }));
  });
  const byIndex = new Map();
  mapping.forEach(m => {
    if (!byIndex.has(m.index)) byIndex.set(m.index, []);
    byIndex.get(m.index).push(m);
  });

  const groups = [];
  let group = [];
  let tokens = 0;
  for (const m of mapping.filter(m => !m.cached)) {
    const tk = approxTokens(m.text) + 1;
    if (group.length && (tokens + tk > tokenBudget || group.length >= maxBatchSize)) {
      groups.push(group);
      group = [];
      tokens = 0;
    }
    group.push(m);
    tokens += tk;
  }
  if (group.length) groups.push(group);
  stats.totalRequests += groups.length;

  for (const g of groups) {
    const joinedText = g.map(m => m.text.replaceAll(SEP, '')).join(SEP);
    const words = joinedText.replaceAll(SEP, ' ').trim().split(/\s+/).filter(Boolean).length;
    let res;
    try {
      res = await qwenTranslate({ ...opts, text: joinedText, onRetry, retryDelay, force: opts.force });
    } catch (e) {
      if (/HTTP\s+400/i.test(e.message || '')) throw e;
      g.forEach(m => {
        m.result = m.text;
      });
      continue;
    }
    const tk = approxTokens(joinedText);
    stats.tokens += tk;
    stats.words += words;
    stats.requests++;
    const translated = res && typeof res.text === 'string' ? res.text.split(SEP) : [];
    if (translated.length !== g.length) {
      if (tokenBudget > MIN_TOKEN_BUDGET) {
        dynamicTokenBudget = Math.max(MIN_TOKEN_BUDGET, Math.floor(tokenBudget / 2));
      }
      for (const m of g) {
        let out;
        try {
          const single = await qwenTranslate({ ...opts, text: m.text, onRetry, retryDelay, force: opts.force });
          out = single.text;
        } catch {
          out = m.text;
        }
        m.result = out;
        const key = `${provider}:${opts.source}:${opts.target}:${m.text}`;
        setCache(key, { text: out });
        stats.requests++;
        stats.tokens += approxTokens(m.text);
        stats.words += m.text.trim().split(/\s+/).filter(Boolean).length;
      }
      continue;
    }
    for (let i = 0; i < g.length; i++) {
      g[i].result = translated[i] || g[i].text;
      const key = `${provider}:${opts.source}:${opts.target}:${g[i].text}`;
      setCache(key, { text: g[i].result });
    }
    const elapsedMs = Date.now() - stats.start;
    const avg = elapsedMs / stats.requests;
    const etaMs = avg * (stats.totalRequests - stats.requests);
    if (onProgress)
      onProgress({ phase: 'translate', request: stats.requests, requests: stats.totalRequests, sample: g[0].text.slice(0, 80), elapsedMs, etaMs });
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
  for (let i = 0; i < results.length; i++) {
    const orig = (texts[i] || '').trim();
    const out = (results[i] || '').trim();
    if (orig && out === orig && opts.source !== opts.target) {
      retryTexts.push(orig);
      retryIdx.push(i);
      const key = `${provider}:${opts.source}:${opts.target}:${orig}`;
      removeCache(key);
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
    });
    retryIdx.forEach((idx, i) => {
      results[idx] = retr.texts[i];
      const key = `${provider}:${opts.source}:${opts.target}:${texts[idx]}`;
      setCache(key, { text: results[idx] });
    });
  }

  dupes.forEach((arr, orig) => {
    arr.forEach(i => {
      results[i] = results[orig];
      const key = `${provider}:${opts.source}:${opts.target}:${texts[i]}`;
      setCache(key, { text: results[orig] });
    });
  });

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
function qwenClearCache() {
  cache.clear();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('qwenCache');
  } else if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('qwenCache');
  }
}

function qwenGetCacheSize() {
  return cache.size;
}

function _setMaxCacheEntries(n) {
  MAX_CACHE_ENTRIES = n;
}

function _setCacheTTL(ms) {
  CACHE_TTL_MS = ms;
}

function qwenSetCacheLimit(n) {
  _setMaxCacheEntries(n);
}

function qwenSetCacheTTL(ms) {
  _setCacheTTL(ms);
}

function _setCacheEntryTimestamp(key, ts) {
  const entry = cache.get(key);
  if (entry) {
    entry.ts = ts;
    persistCache(key, entry);
  }
}
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
  window.qwenTranslateStream = qwenTranslateStream;
  window.qwenTranslateBatch = qwenTranslateBatch;
  window.qwenClearCache = qwenClearCache;
  window.qwenGetCacheSize = qwenGetCacheSize;
  window.qwenSetCacheLimit = qwenSetCacheLimit;
  window.qwenSetCacheTTL = qwenSetCacheTTL;
  window.qwenSetTokenBudget = _setTokenBudget;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenTranslate = qwenTranslate;
  self.qwenTranslateStream = qwenTranslateStream;
  self.qwenTranslateBatch = qwenTranslateBatch;
  self.qwenClearCache = qwenClearCache;
  self.qwenGetCacheSize = qwenGetCacheSize;
  self.qwenSetCacheLimit = qwenSetCacheLimit;
  self.qwenSetCacheTTL = qwenSetCacheTTL;
  self.qwenSetTokenBudget = _setTokenBudget;
}
if (typeof module !== 'undefined') {
  module.exports = {
    qwenTranslate,
    qwenTranslateStream,
    qwenTranslateBatch,
    qwenClearCache,
    qwenGetCacheSize,
    qwenSetCacheLimit,
    qwenSetCacheTTL,
    _getTokenBudget,
    _setTokenBudget,
    _setMaxCacheEntries,
    _setCacheTTL,
    _setCacheEntryTimestamp,
  };
}
