var runWithRateLimit;
var runWithRetry;
var approxTokens;
var getUsage;
var getProvider;
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

if (typeof window === 'undefined') {
  if (typeof self !== 'undefined' && self.qwenThrottle) {
    ({ runWithRateLimit, runWithRetry, approxTokens, getUsage } = self.qwenThrottle);
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
    LZString = require('lz-string');
    ({ getProvider } = require('./providers'));
    require('./providers/qwen');
  } else {
    ({ runWithRateLimit, runWithRetry, approxTokens, getUsage } = require('./throttle'));
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
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
  if (typeof window !== 'undefined' && window.qwenCache) {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = window.qwenCache);
  } else if (typeof self !== 'undefined' && self.qwenCache) {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = self.qwenCache);
  } else if (typeof require !== 'undefined') {
    ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
  }
  if (typeof window !== 'undefined' && window.qwenProviders) {
    ({ getProvider } = window.qwenProviders);
  } else if (typeof self !== 'undefined' && self.qwenProviders) {
    ({ getProvider } = self.qwenProviders);
  } else if (typeof require !== 'undefined' && !getProvider) {
    ({ getProvider } = require('./providers'));
    require('./providers/qwen');
  }
}

async function qwenTranslate({ provider = 'qwen', endpoint, apiKey, model, models, text, source, target, signal, debug = false, stream = false, noProxy = false, onRetry, retryDelay, attempts = 6, force = false }) {
  await cacheReady;
  if (debug) {
    const modelList = Array.isArray(models) ? models : models ? [models] : [model];
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
            opts: { provider, endpoint: ep, apiKey, model, models, text, source, target, debug },
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
    const prov = getProvider ? getProvider(provider) : undefined;
    if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
    const list = Array.isArray(models) && models.length ? models : [model];
    const usage = getUsage ? getUsage() : {};
    let chosen = list[0];
    if (list.length > 1 && usage.requestLimit && usage.requests >= usage.requestLimit / 2) {
      chosen = list[1];
    }
    try {
      const data = await runWithRetry(
        () => prov.translate({ endpoint, apiKey, model: chosen, models, text, source, target, signal, debug, stream }),
        approxTokens(text),
        { attempts, debug, onRetry, retryDelay }
      );
      setCache(cacheKey, data);
      if (debug) {
        console.log('QTDEBUG: translation successful');
        console.log('QTDEBUG: final text', data.text);
      }
      return data;
    } catch (e) {
      if (list.length > 1 && chosen === list[0] && e.retryable) {
        const data = await runWithRetry(
          () => prov.translate({ endpoint, apiKey, model: list[1], models, text, source, target, signal, debug, stream }),
          approxTokens(text),
          { attempts, debug, onRetry, retryDelay }
        );
        setCache(cacheKey, data);
        if (debug) {
          console.log('QTDEBUG: translation successful');
          console.log('QTDEBUG: final text', data.text);
        }
        return data;
      }
      console.error('QTERROR: translation request failed', e);
      throw e;
    }
  } catch (e) {
    console.error('QTERROR: translation request failed', e);
    throw e;
  }
}

async function qwenTranslateStream({ provider = 'qwen', endpoint, apiKey, model, models, text, source, target, signal, debug = false, stream = true, noProxy = false, onRetry, retryDelay, attempts = 6, force = false }, onData) {
  await cacheReady;
  if (debug) {
    const modelList = Array.isArray(models) ? models : models ? [models] : [model];
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
    const data = await runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ endpoint, apiKey, model, models, text, source, target, signal, debug, onData, stream });
      },
      approxTokens(text),
      { attempts, debug, onRetry, retryDelay }
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

function collapseSpacing(text) {
  let prev;
  do {
    prev = text;
    text = text.replace(/(\b\w)\s(?=\w\b)/g, '$1');
  } while (text !== prev);
  return text.replace(/\s{2,}/g, ' ');
}

function _setGetUsage(fn) {
  getUsage = fn;
}

if (typeof globalThis !== 'undefined') {
  globalThis._setGetUsage = _setGetUsage;
}
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
  window.qwenTranslateStream = qwenTranslateStream;
  window.qwenClearCache = qwenClearCache;
  window.qwenGetCacheSize = qwenGetCacheSize;
  window.qwenSetCacheLimit = qwenSetCacheLimit;
  window.qwenSetCacheTTL = qwenSetCacheTTL;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenTranslate = qwenTranslate;
  self.qwenTranslateStream = qwenTranslateStream;
  self.qwenClearCache = qwenClearCache;
  self.qwenGetCacheSize = qwenGetCacheSize;
  self.qwenSetCacheLimit = qwenSetCacheLimit;
  self.qwenSetCacheTTL = qwenSetCacheTTL;
}
if (typeof module !== 'undefined') {
  module.exports = {
    qwenTranslate,
    qwenTranslateStream,
    qwenClearCache,
    qwenGetCacheSize,
    qwenSetCacheLimit,
    qwenSetCacheTTL,
    _setMaxCacheEntries,
    _setCacheTTL,
    _setCacheEntryTimestamp,
    collapseSpacing,
    _setGetUsage,
  };
}
