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

test('stores raw entry if compression fails', async () => {
  jest.resetModules();
  jest.doMock('lz-string', () => ({
    compressToUTF16: () => { throw new Error('boom'); },
    decompressFromUTF16: () => { throw new Error('boom'); },
  }));
  const { cacheReady, setCache, qwenGetCompressionErrors } = require('../src/cache');
  await cacheReady;
  setCache('k1', { text: 'hello' });
  const stored = JSON.parse(localStorage.getItem('qwenCache')).k1;
  const parsed = JSON.parse(stored);
  expect(parsed.text).toBe('hello');
  expect(qwenGetCompressionErrors()).toBe(1);
});

test('drops corrupted entries and counts failures', async () => {
  jest.resetModules();
  localStorage.setItem('qwenCache', JSON.stringify({ bad: 'broken' }));
  jest.doMock('lz-string', () => ({
    compressToUTF16: s => s,
    decompressFromUTF16: () => { throw new Error('bad'); },
  }));
  const cache = require('../src/cache');
  await cache.cacheReady;
  expect(cache.qwenGetCacheSize()).toBe(0);
  expect(localStorage.getItem('qwenCache')).toBe('{}');
  expect(cache.qwenGetCompressionErrors()).toBe(1);
});
