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
