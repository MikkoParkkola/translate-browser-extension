var transportTranslate;
var getUsage;
var _setGetUsage = fn => { getUsage = fn; };
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
  if (typeof self !== 'undefined' && self.qwenTransport) {
    ({ translate: transportTranslate } = self.qwenTransport);
  } else {
    ({ translate: transportTranslate } = require('./transport'));
  }
  if (typeof self !== 'undefined' && self.qwenThrottle) {
    ({ getUsage } = self.qwenThrottle);
  } else {
    ({ getUsage } = require('./throttle'));
  }
  ({ cacheReady, getCache, setCache, removeCache, qwenClearCache, qwenGetCacheSize, qwenSetCacheLimit, qwenSetCacheTTL, _setMaxCacheEntries, _setCacheTTL, _setCacheEntryTimestamp } = require('./cache'));
  LZString = require('lz-string');
} else {
  if (window.qwenTransport) {
    ({ translate: transportTranslate } = window.qwenTransport);
  } else if (typeof require !== 'undefined') {
    ({ translate: transportTranslate } = require('./transport'));
  } else {
    transportTranslate = async () => { throw new Error('Transport not available'); };
  }
  if (window.qwenThrottle) {
    ({ getUsage } = window.qwenThrottle);
  } else if (typeof require !== 'undefined') {
    ({ getUsage } = require('./throttle'));
  } else {
    getUsage = () => ({ requestLimit: 1, requests: 0 });
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
}

async function qwenTranslate({ provider = 'qwen', endpoint, apiKey, model, text, source, target, signal, debug = false, stream = false, noProxy = false, onRetry, retryDelay, force = false, domain }) {
  await cacheReady;
  const list = Array.isArray(models) && models.length ? models : model ? [model] : [];
  let modelList = list.slice();
  if (modelList.length > 1) {
    try {
      const usage = _getUsage();
      const ratio = (usage.requests || 0) / Math.max(1, usage.requestLimit || 1);
      model = ratio < 0.5 ? modelList[0] : modelList[1];
    } catch {}
  } else {
    model = modelList[0];
  }
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
    setCache(cacheKey, { ...result, domain });
    return result;
  }

  try {
    const attempts = 3;
    const data = await runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ endpoint, apiKey, model, text, source, target, signal, debug, stream });
      },
      approxTokens(text),
      { attempts, debug, onRetry, retryDelay }
    );
    setCache(cacheKey, { ...data, domain });
    if (debug) {
      console.log('QTDEBUG: translation successful');
      console.log('QTDEBUG: final text', data.text);

    }
  } catch (e) {
    if (modelList && modelList.length > 1 && model === modelList[0]) {
      try {
        model = modelList[1];
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
        });
        setCache(cacheKey, data);
        return data;
      } catch (err) {
        console.error('QTERROR: translation request failed', err);
        throw err;
      }
    }
    console.error('QTERROR: translation request failed', e);
    throw e;
  }
}

function collapseSpacing(text) {
  const joined = text.replace(/\b(?:[A-Za-z](?:\s[A-Za-z]){1,})\b/g, s => s.replace(/\s+/g, ''));
  return joined.replace(/\s{2,}/g, ' ');
}

async function qwenTranslateStream({ provider = 'qwen', endpoint, apiKey, model, text, source, target, signal, debug = false, stream = true, noProxy = false, onRetry, retryDelay, force = false }, onData) {
  await cacheReady;
  const list = Array.isArray(models) && models.length ? models : model ? [model] : [];
  let modelList = list.slice();
  if (modelList.length > 1) {
    try {
      const usage = _getUsage();
      const ratio = (usage.requests || 0) / Math.max(1, usage.requestLimit || 1);
      model = ratio < 0.5 ? modelList[0] : modelList[1];
    } catch {}
  } else {
    model = modelList[0];
  }
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
    const attempts = 3;
    const data = await runWithRetry(
      () => {
        const prov = getProvider ? getProvider(provider) : undefined;
        if (!prov || !prov.translate) throw new Error(`Unknown provider: ${provider}`);
        return prov.translate({ endpoint, apiKey, model, models, text, source, target, signal, debug, onData, stream });
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
    collapseSpacing,
    _setGetUsage,
  };
}
