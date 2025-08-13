var transportTranslate;
var cacheReady;
var getCache;
var setCache;
var removeCache;
var qwenClearCache;
var qwenGetCacheSize;
var qwenSetCacheLimit;
var qwenSetCacheTTL;
var qwenGetCompressionErrors;
var _setMaxCacheEntries;
var _setCacheTTL;
var _setCacheEntryTimestamp;
var LZString;
var attempts = 6;
var runWithRateLimit;
var approxTokens;
var getUsage;
var runWithRetry;

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
  require('./providers/qwen');
} else {
  if (window.qwenTransport) {
    ({ translate: transportTranslate } = window.qwenTransport);
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
    require('./providers/qwen');
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
  }
}

async function qwenTranslate({ provider = 'qwen', endpoint, apiKey, model, models, text, source, target, signal, debug = false, stream = false, noProxy = false, onRetry, retryDelay, force = false }) {
  await cacheReady;
  const modelList = Array.isArray(models) && models.length ? models : model ? [model] : [];
  let chosenModel = modelList[0] || model;
  if (modelList.length > 1 && getUsage) {
    try {
      const usage = await getUsage();
      if (usage.requestLimit && usage.requests >= usage.requestLimit / 2) {
        chosenModel = modelList[1];
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

  const translateOnce = m =>
    runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ endpoint, apiKey, model: m, text, source, target, signal, debug, stream });
      },
      approxTokens(text),
      { attempts: modelList.length > 1 ? 1 : attempts, debug, onRetry, retryDelay }
    );
  try {
    const data = await translateOnce(chosenModel);
    setCache(cacheKey, data);
    if (debug) {
      console.log('QTDEBUG: translation successful');
      console.log('QTDEBUG: final text', data.text);
    }
    return data;
  } catch (e) {
    if (modelList.length > 1 && /429/.test(e.message) && chosenModel !== modelList[1]) {
      const data = await translateOnce(modelList[1]);
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
}

async function qwenTranslateStream({ provider = 'qwen', endpoint, apiKey, model, models, text, source, target, signal, debug = false, stream = true, noProxy = false, onRetry, retryDelay, force = false }, onData) {
  await cacheReady;
  const modelList = Array.isArray(models) ? models : models ? [models] : [model];
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
      model,
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

function collapseSpacing(text) {
  return text
    .split(/\s{2,}/)
    .map(seg =>
      /^(?:[A-Za-z]\s+)+[A-Za-z]$/.test(seg) ? seg.replace(/\s+/g, '') : seg
    )
    .join(' ');
}

function _setGetUsage(fn) {
  getUsage = fn;
}
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
  window.qwenTranslateStream = qwenTranslateStream;
  window.qwenClearCache = qwenClearCache;
  window.qwenGetCacheSize = qwenGetCacheSize;
  window.qwenGetCompressionErrors = qwenGetCompressionErrors;
  window.qwenSetCacheLimit = qwenSetCacheLimit;
  window.qwenSetCacheTTL = qwenSetCacheTTL;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenTranslate = qwenTranslate;
  self.qwenTranslateStream = qwenTranslateStream;
  self.qwenClearCache = qwenClearCache;
  self.qwenGetCacheSize = qwenGetCacheSize;
  self.qwenGetCompressionErrors = qwenGetCompressionErrors;
  self.qwenSetCacheLimit = qwenSetCacheLimit;
  self.qwenSetCacheTTL = qwenSetCacheTTL;
}
if (typeof global !== 'undefined') {
  global._setGetUsage = _setGetUsage;
}
if (typeof module !== 'undefined') {
  module.exports = {
    qwenTranslate,
    qwenTranslateStream,
    qwenClearCache,
    qwenGetCacheSize,
    qwenGetCompressionErrors,
    qwenSetCacheLimit,
    qwenSetCacheTTL,
    _setMaxCacheEntries,
    _setCacheTTL,
    _setCacheEntryTimestamp,
    _setGetUsage,
    collapseSpacing,
  };
}
