var transportTranslate;
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
var runWithRetry;
var approxTokens;
var getUsage;

function _setGetUsage(fn) {
  getUsage = fn;
}

if (typeof window === 'undefined') {
  if (typeof self !== 'undefined' && self.qwenTransport) {
    ({ translate: transportTranslate } = self.qwenTransport);
  } else {
    ({ translate: transportTranslate } = require('./transport'));
  }
  ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
  ({ runWithRateLimit, approxTokens, getUsage } = require('./throttle'));
  ({ runWithRetry } = require('./retry'));
  ({ getProvider } = require('./providers'));
} else {
  if (window.qwenThrottle) {
    ({ runWithRateLimit, runWithRetry, approxTokens, getUsage } = window.qwenThrottle);
  } else if (typeof require !== 'undefined') {
    ({ translate: transportTranslate } = require('./transport'));
  }
  if (window.qwenCache) {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = window.qwenCache);
  } else if (typeof self !== 'undefined' && self.qwenCache) {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = self.qwenCache);
  } else if (typeof require !== 'undefined') {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenGetCompressionErrors, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
  }
  if (typeof window !== 'undefined' && window.qwenProviders) {
    ({ getProvider } = window.qwenProviders);
  } else if (typeof self !== 'undefined' && self.qwenProviders) {
    ({ getProvider } = self.qwenProviders);
  } else if (typeof require !== 'undefined' && !getProvider) {
    ({ getProvider } = require('./providers'));
  }
  if (typeof window !== 'undefined' && window.qwenThrottle) {
    ({ runWithRateLimit, approxTokens, getUsage } = window.qwenThrottle);
  } else if (typeof self !== 'undefined' && self.qwenThrottle) {
    ({ runWithRateLimit, approxTokens, getUsage } = self.qwenThrottle);
  } else if (typeof require !== 'undefined') {
    ({ runWithRateLimit, approxTokens, getUsage } = require('./throttle'));
  }
  if (typeof window !== 'undefined' && window.qwenRetry) {
    ({ runWithRetry } = window.qwenRetry);
  } else if (typeof self !== 'undefined' && self.qwenRetry) {
    ({ runWithRetry } = self.qwenRetry);
  } else if (typeof require !== 'undefined') {
    ({ runWithRetry } = require('./retry'));
  } else {
    runWithRetry = fn => fn();
  }
}

if (typeof transportTranslate !== 'function') {
  const mod = require('./transport');
  transportTranslate = typeof mod === 'function' ? mod : mod.translate;
}

async function qwenTranslate({ provider = 'qwen', endpoint, apiKey, model, models, text, source, target, signal, debug = false, stream = false, noProxy = false, onRetry, retryDelay, force = false, domain }) {
  await cacheReady;
  const modelList =
    typeof models === 'undefined'
      ? [model]
      : Array.isArray(models)
      ? models
      : [models];
  let selectedModel = modelList[0];
  if (modelList.length > 1 && getUsage) {
    try {
      const usage = getUsage();
      if (usage.requestLimit && usage.requests && usage.requests / usage.requestLimit > 0.5) {
        selectedModel = modelList[1];
      }
    } catch {}
  }
  if (debug) {
    console.log('QTDEBUG: qwenTranslate called with', {
      provider,
      endpoint,
      apiKeySet: Boolean(apiKey),
      models: modelList,
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
      opts: { provider, endpoint: ep, apiKey, model: selectedModel, models: modelList, text, source, target, debug },
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
    setCache(cacheKey, { ...result, domain });
    return result;
  }

  try {
    const attempts = 3;
    const data = await transportTranslate({
      provider,
      endpoint,
      apiKey,
      model: selectedModel,
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
  const modelList =
    typeof models === 'undefined'
      ? [model]
      : Array.isArray(models)
      ? models
      : [models];
  if (debug) {
    console.log('QTDEBUG: qwenTranslateStream called with', {
      endpoint,
      apiKeySet: Boolean(apiKey),
      models: modelList,
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
    const attempts = 3;
    const data = await transportTranslate({
      provider,
      endpoint,
      apiKey,
      model: selectedModel,
      text,
      source,
      target,
      signal,
      debug,
      stream,
      onRetry,
      retryDelay,
      attempts,
      onData,
    });
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
  const stats = _stats || { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0 };
  const SEP = '\uE000';

  const mapping = [];
  texts.forEach((t, i) => {
    const key = `${opts.source}:${opts.target}:${t}`;
    if (cache.has(key)) {
      mapping.push({ index: i, chunk: 0, text: cache.get(key).text, cached: true });
      return;
    }
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
      res = await qwenTranslate({ ...opts, text: joinedText, onRetry, retryDelay });
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
          const single = await qwenTranslate({ ...opts, text: m.text, onRetry, retryDelay });
          out = single.text;
        } catch {
          out = m.text;
        }
        m.result = out;
        const key = `${opts.source}:${opts.target}:${m.text}`;
        cache.set(key, { text: out });
        stats.requests++;
        stats.tokens += approxTokens(m.text);
        stats.words += m.text.trim().split(/\s+/).filter(Boolean).length;
      }
      continue;
    }
    for (let i = 0; i < g.length; i++) {
      g[i].result = translated[i] || g[i].text;
      const key = `${opts.source}:${opts.target}:${g[i].text}`;
      cache.set(key, { text: g[i].result });
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
      const key = `${opts.source}:${opts.target}:${orig}`;
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
    });
    for (let i = 0; i < retryIdx.length; i++) {
      results[retryIdx[i]] = retr.texts[i];
      const key = `${opts.source}:${opts.target}:${retryTexts[i]}`;
      cache.set(key, { text: retr.texts[i] });
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
