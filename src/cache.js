const cache = new Map();
let MAX_CACHE_ENTRIES = 1000;
let CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
let cacheReady = Promise.resolve();
let LZString;
let compressionErrors = 0;

if (typeof window === 'undefined') {
  LZString = require('lz-string');
} else {
  LZString = (typeof window !== 'undefined' && window.LZString) ||
    (typeof self !== 'undefined' && self.LZString) ||
    (typeof require !== 'undefined' ? require('lz-string') : undefined);
}

function encodeCacheValue(val) {
  try {
    const json = JSON.stringify(val);
    return LZString ? LZString.compressToUTF16(json) : json;
  } catch {
    compressionErrors++;
    try { return JSON.stringify(val); } catch { return val; }
  }
}

function decodeCacheValue(val) {
  if (typeof val !== 'string') return val;
  if (LZString) {
    try {
      const json = LZString.decompressFromUTF16(val);
      if (json) return JSON.parse(json);
      compressionErrors++;
    } catch {
      compressionErrors++;
      return null;
    }
  }
  try {
    return JSON.parse(val);
  } catch {
    compressionErrors++;
    return null;
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

function qwenClearCache() {
  cache.clear();
  compressionErrors = 0;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('qwenCache');
  } else if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('qwenCache');
  }
}

function qwenGetCacheSize() {
  return cache.size;
}

function qwenGetCompressionErrors() {
  return compressionErrors;
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

const api = {
  cacheReady,
  getCache,
  setCache,
  removeCache,
  qwenClearCache,
  qwenGetCacheSize,
  qwenGetCompressionErrors,
  qwenSetCacheLimit,
  qwenSetCacheTTL,
  _setMaxCacheEntries,
  _setCacheTTL,
  _setCacheEntryTimestamp,
};

if (typeof window !== 'undefined') {
  window.qwenCache = api;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenCache = api;
}
if (typeof module !== 'undefined') {
  module.exports = api;
}
