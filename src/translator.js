var runWithRateLimit;
var runWithRetry;
var approxTokens;
var getUsage;
var _setGetUsage = fn => {
  getUsage = fn;
  if (typeof window !== 'undefined') window._getUsageOverride = fn;
  else if (typeof self !== 'undefined') self._getUsageOverride = fn;
};
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

async function qwenTranslate({ provider = 'qwen', endpoint, apiKey, model, models, text, source, target, signal, debug = false, stream = false, noProxy = false, onRetry, retryDelay, force = false, domain }) {
  await cacheReady;
  let modelList = [];
  if (Array.isArray(models) && models.length) {
    modelList = models.slice();
    let usageFn = getUsage;
    let overrideUsed = false;
    if (typeof window !== 'undefined' && window._getUsageOverride) {
      usageFn = window._getUsageOverride;
      overrideUsed = true;
    } else if (typeof self !== 'undefined' && self._getUsageOverride) {
      usageFn = self._getUsageOverride;
      overrideUsed = true;
    }
    try {
      const usage = usageFn ? usageFn() : {};
      if (usage && usage.requestLimit && usage.requests >= usage.requestLimit * 0.5) {
        modelList = [modelList[1], modelList[0]];
      }
    } catch {}
    if (overrideUsed) {
      if (typeof window !== 'undefined') window._getUsageOverride = null;
      else if (typeof self !== 'undefined') self._getUsageOverride = null;
    }
  } else if (model) {
    modelList = [model];
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
    setCache(cacheKey, { ...result, domain });
    return result;
  }

  let lastError;
  for (let i = 0; i < modelList.length; i++) {
    const m = modelList[i];
    try {
      const attempts = modelList.length > 1 ? 1 : 3;
      const data = await runWithRetry(
        () => {
          const prov = getProvider ? getProvider(provider) : undefined;
          if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
          return prov.translate({ endpoint, apiKey, model: m, text, source, target, signal, debug, stream });
        },
        approxTokens(text),
        { attempts, debug, onRetry, retryDelay }
      );
      setCache(cacheKey, { ...data, domain });
      if (debug) {
        console.log('QTDEBUG: translation successful');
        console.log('QTDEBUG: final text', data.text);
      }
      return data;
    } catch (e) {
      lastError = e;
      if (modelList.length > 1 && /429/.test(e.message) && i < modelList.length - 1) {
        continue;
      }
      console.error('QTERROR: translation request failed', e);
      throw e;
    }
  }
  console.error('QTERROR: translation request failed', lastError);
  throw lastError;
}

function collapseSpacing(text) {
  const joined = text.replace(/\b(?:[A-Za-z](?:\s[A-Za-z]){1,})\b/g, s => s.replace(/\s+/g, ''));
  return joined.replace(/\s{2,}/g, ' ');
}

async function qwenTranslateStream({ provider = 'qwen', endpoint, apiKey, model, text, source, target, signal, debug = false, stream = true, noProxy = false, onRetry, retryDelay, force = false }, onData) {
  await cacheReady;
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
    const data = await runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream });
      },
      approxTokens(text),
      { attempts, debug, onRetry, retryDelay }
    );
    setCache(cacheKey, { ...data, domain });
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
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
  window.qwenTranslateStream = qwenTranslateStream;
  window.qwenClearCache = qwenClearCache;
  window.qwenGetCacheSize = qwenGetCacheSize;
  window.qwenSetCacheLimit = qwenSetCacheLimit;
  window.qwenSetCacheTTL = qwenSetCacheTTL;
  window._setGetUsage = _setGetUsage;
  window.collapseSpacing = collapseSpacing;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenTranslate = qwenTranslate;
  self.qwenTranslateStream = qwenTranslateStream;
  self.qwenClearCache = qwenClearCache;
  self.qwenGetCacheSize = qwenGetCacheSize;
  self.qwenSetCacheLimit = qwenSetCacheLimit;
  self.qwenSetCacheTTL = qwenSetCacheTTL;
  self._setGetUsage = _setGetUsage;
  self.collapseSpacing = collapseSpacing;
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
    collapseSpacing,
    _setMaxCacheEntries,
    _setCacheTTL,
    _setCacheEntryTimestamp,
  };
}
