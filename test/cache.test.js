beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
});

test('evicted entries removed from persistent storage', async () => {
  const { cacheReady, setCache, qwenSetCacheLimit } = require('../src/cache');
  await cacheReady;
  qwenSetCacheLimit(2);
  setCache('k1', { text: 'one' });
  setCache('k2', { text: 'two' });
  setCache('k3', { text: 'three' });
  const stored = JSON.parse(localStorage.getItem('qwenCache'));
  expect(stored.k1).toBeUndefined();
  expect(stored.k2).toBeTruthy();
  expect(stored.k3).toBeTruthy();
  qwenSetCacheLimit(1000);
});

test('evicts oldest entry from memory when limit exceeded', async () => {
  const { cacheReady, setCache, getCache, qwenSetCacheLimit } = require('../src/cache');
  await cacheReady;
  qwenSetCacheLimit(2);
  setCache('a', { text: '1' });
  setCache('b', { text: '2' });
  setCache('c', { text: '3' });
  expect(getCache('a')).toBeUndefined();
  expect(getCache('b').text).toBe('2');
  expect(getCache('c').text).toBe('3');
  qwenSetCacheLimit(1000);
});

test('prunes expired entries from storage on load', async () => {
  const stale = { text: 'old', ts: Date.now() - 40 * 24 * 60 * 60 * 1000 };
  localStorage.setItem('qwenCache', JSON.stringify({ a: JSON.stringify(stale) }));
  jest.resetModules();
  const cache = require('../src/cache');
  await cache.cacheReady;
  expect(cache.qwenGetCacheSize()).toBe(0);
  expect(localStorage.getItem('qwenCache')).toBe('{}');
});

test('expired entry removed from storage when accessed', async () => {
  const {
    cacheReady,
    setCache,
    getCache,
    _setCacheTTL,
    _setCacheEntryTimestamp,
  } = require('../src/cache');
  await cacheReady;
  _setCacheTTL(1000);
  setCache('k1', { text: 'stale' });
  _setCacheEntryTimestamp('k1', Date.now() - 2000);
  expect(getCache('k1')).toBeUndefined();
  const stored = JSON.parse(localStorage.getItem('qwenCache'));
  expect(stored.k1).toBeUndefined();
  _setCacheTTL(30 * 24 * 60 * 60 * 1000);
});

test('tracks hits and misses', async () => {
  const {
    cacheReady,
    setCache,
    getCache,
    qwenGetCacheStats,
    qwenResetCacheStats,
  } = require('../src/cache');
  await cacheReady;
  qwenResetCacheStats();
  setCache('k1', { text: 'one', domain: 'a.com' });
  expect(getCache('k1').text).toBe('one');
  expect(getCache('missing')).toBeUndefined();
  const stats = qwenGetCacheStats();
  expect(stats.hits).toBe(1);
  expect(stats.misses).toBe(1);
});

test('clear cache by domain and language pair', async () => {
  const {
    cacheReady,
    setCache,
    getCache,
    qwenClearCacheDomain,
    qwenClearCacheLangPair,
  } = require('../src/cache');
  await cacheReady;
  setCache('qwen:en:fr:hello', { text: 'bonjour', domain: 'example.com' });
  setCache('qwen:en:fr:hi', { text: 'salut', domain: 'example.com' });
  setCache('qwen:en:es:hola', { text: 'hola', domain: 'other.com' });
  qwenClearCacheDomain('example.com');
  expect(getCache('qwen:en:fr:hello')).toBeUndefined();
  expect(getCache('qwen:en:es:hola')).toBeTruthy();
  qwenClearCacheLangPair('en', 'es');
  expect(getCache('qwen:en:es:hola')).toBeUndefined();
});
