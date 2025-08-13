const cache = new Map();
let MAX_CACHE_ENTRIES = 1000;
let CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
let cacheReady = Promise.resolve();
let LZString;
let compressionErrors = 0;
let hitCount = 0;
let missCount = 0;

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
} else if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
  try {
    const data = JSON.parse(globalThis.localStorage.getItem('qwenCache') || '{}');
    const pruned = {};
    const now = Date.now();
    Object.entries(data).forEach(([k, v]) => {
      const val = decodeCacheValue(v);
      if (val && (!val.ts || now - val.ts <= CACHE_TTL_MS)) {
        cache.set(k, val);
        pruned[k] = v;
      }
    });
    globalThis.localStorage.setItem('qwenCache', JSON.stringify(pruned));
  } catch {
    try {
      globalThis.localStorage.removeItem('qwenCache');
    } catch {}
  }
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
  if (!entry) {
    missCount++;
    return;
  }
  if (entry.ts && Date.now() - entry.ts > CACHE_TTL_MS) {
    removeCache(key);
    missCount++;
    return;
  }
  hitCount++;
  return entry;
}

function setCache(key, value, origin) {
  const entry = { ...value, origin, ts: Date.now() };
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
  hitCount = 0;
  missCount = 0;
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

function qwenGetCacheStats() {
  const total = hitCount + missCount;
  const hitRate = total ? hitCount / total : 0;
  return { hits: hitCount, misses: missCount, hitRate };
}

function qwenGetDomainCounts() {
  const counts = {};
  cache.forEach(v => {
    const d = v.origin || 'unknown';
    counts[d] = (counts[d] || 0) + 1;
  });
  return counts;
}

function qwenClearCacheDomain(domain) {
  Array.from(cache.entries()).forEach(([k, v]) => {
    if (v.origin === domain) removeCache(k);
  });
}

function qwenClearCacheLangPair(source, target) {
  Array.from(cache.keys()).forEach(k => {
    const parts = k.split(':');
    if (parts[1] === source && parts[2] === target) removeCache(k);
  });
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

function qwenGetCacheStats() {
  const total = hits + misses;
  return { hits, misses, hitRate: total ? hits / total : 0 };
}

function qwenResetCacheStats() {
  hits = 0;
  misses = 0;
}

function qwenGetDomainCounts() {
  const counts = {};
  cache.forEach(v => {
    const d = v.domain || 'unknown';
    counts[d] = (counts[d] || 0) + 1;
  });
  return counts;
}

function qwenClearCacheDomain(domain) {
  cache.forEach((v, k) => {
    if (v.domain === domain) removeCache(k);
  });
}

function qwenClearCacheLangPair(source, target) {
  cache.forEach((v, k) => {
    const parts = k.split(':');
    if (parts[1] === source && parts[2] === target) removeCache(k);
  });
}

const api = {
  cacheReady,
  getCache,
  setCache,
  removeCache,
  qwenClearCache,
  qwenGetCacheSize,
  qwenGetCompressionErrors,
   qwenGetCacheStats,
   qwenGetDomainCounts,
   qwenClearCacheDomain,
   qwenClearCacheLangPair,
  qwenSetCacheLimit,
  qwenSetCacheTTL,
  qwenGetCacheStats,
  qwenResetCacheStats,
  qwenGetDomainCounts,
  qwenClearCacheDomain,
  qwenClearCacheLangPair,
  _setMaxCacheEntries,
  _setCacheTTL,
  _setCacheEntryTimestamp,
};

if (typeof window !== 'undefined') {
  window.qwenCache = api;
  Object.assign(window, api);
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenCache = api;
  Object.assign(self, api);
}
if (typeof module !== 'undefined') {
  module.exports = api;
}
