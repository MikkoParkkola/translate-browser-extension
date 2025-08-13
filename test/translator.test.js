const translator = require('../src/translator.js');
const {
  qwenTranslate: translate,
  qwenClearCache,
  qwenTranslateBatch,
  qwenGetCacheSize,
  _getTokenBudget,
  _setTokenBudget,
  _setMaxCacheEntries,
  _setCacheTTL,
  _setCacheEntryTimestamp,
} = translator;
const { configure, reset, getUsage } = require('../src/throttle');
const { modelTokenLimits } = require('../src/config');
const fetchMock = require('jest-fetch-mock');

beforeAll(() => { fetchMock.enableMocks(); });

beforeEach(() => {
  fetch.resetMocks();
  qwenClearCache();
  reset();
  configure({ requestLimit: 6000, tokenLimit: modelTokenLimits['qwen-mt-turbo'], windowMs: 60000 });
  _setTokenBudget(0);
  _setMaxCacheEntries(1000);
  _setCacheTTL(30 * 24 * 60 * 60 * 1000);
});

test('translate success', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'hello'}}));
  const res = await translate({endpoint:'https://example.com/', apiKey:'key', model:'m', text:'hola', source:'es', target:'en'});
  expect(res.text).toBe('hello');
});

test('adds bearer prefix automatically', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'hello'}}));
  await translate({endpoint:'https://e/', apiKey:'abc123', model:'m', text:'hi', source:'en', target:'es'});
  const headers = fetch.mock.calls[0][1].headers;
  expect(headers.Authorization).toBe('Bearer abc123');
});

test('uses existing bearer prefix after trimming', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'ok'}}));
  await translate({endpoint:'https://e/', apiKey:'  Bearer xyz  ', model:'m', text:'hi', source:'en', target:'es'});
  const headers = fetch.mock.calls[0][1].headers;
  expect(headers.Authorization).toBe('Bearer xyz');
});

test('omits authorization header when api key missing', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'hi'}}));
  await translate({endpoint:'https://e/', apiKey:'', model:'m', text:'hi', source:'en', target:'es'});
  const headers = fetch.mock.calls[0][1].headers;
  expect(headers.Authorization).toBeUndefined();
});

test('translate error', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  fetch.mockResponseOnce(JSON.stringify({message:'bad'}), {status:400});
  await expect(translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'x', source:'es', target:'en'})).rejects.toThrow('bad');
  spy.mockRestore();
});

test('translate caching', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'hi'}}));
  const first = await translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'hola', source:'es', target:'en'});
  expect(first.text).toBe('hi');
  const cached = await translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'hola', source:'es', target:'en'});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(cached.text).toBe('hi');
});

test('force bypasses cache', async () => {
  fetch
    .mockResponseOnce(JSON.stringify({ output: { text: 'hi' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'hello' } }));
  await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: 'hola', source: 'es', target: 'en' });
  const res = await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: 'hola', source: 'es', target: 'en', force: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(res.text).toBe('hello');
});

test('evicts oldest cache entry from storage', async () => {
  _setMaxCacheEntries(2);
  fetch
    .mockResponseOnce(JSON.stringify({ output: { text: 'one' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'two' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'three' } }));
  await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: '1', source: 'es', target: 'en' });
  await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: '2', source: 'es', target: 'en' });
  let stored = JSON.parse(window.localStorage.getItem('qwenCache'));
  expect(Object.keys(stored)).toHaveLength(2);
  expect(stored['es:en:1']).toBeDefined();
  expect(stored['es:en:2']).toBeDefined();
  await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: '3', source: 'es', target: 'en' });
  stored = JSON.parse(window.localStorage.getItem('qwenCache'));
  expect(Object.keys(stored)).toHaveLength(2);
  expect(stored['es:en:1']).toBeUndefined();
  expect(stored['es:en:2']).toBeDefined();
  expect(stored['es:en:3']).toBeDefined();
  _setMaxCacheEntries(1000);
});

test('expires stale cache entries by ttl', async () => {
  fetch
    .mockResponseOnce(JSON.stringify({ output: { text: 'hi' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'hello' } }));
  await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: 'hola', source: 'es', target: 'en' });
  expect(fetch).toHaveBeenCalledTimes(1);
  const key = 'es:en:hola';
  _setCacheEntryTimestamp(key, Date.now() - 40 * 24 * 60 * 60 * 1000);
  const res = await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: 'hola', source: 'es', target: 'en' });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(res.text).toBe('hello');
});

test('rate limiting queues requests', async () => {
  jest.useFakeTimers();
  configure({ requestLimit: 2, tokenLimit: modelTokenLimits['qwen-mt-turbo'] * 100, windowMs: 1000 });
  fetch
    .mockResponseOnce(JSON.stringify({output:{text:'a'}}))
    .mockResponseOnce(JSON.stringify({output:{text:'b'}}))
    .mockResponseOnce(JSON.stringify({output:{text:'c'}}));

  const p1 = translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'1', source:'es', target:'en'});
  const p2 = translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'2', source:'es', target:'en'});
  const p3 = translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'3', source:'es', target:'en'});

  jest.advanceTimersByTime(0);
  await Promise.resolve();
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(500);
  await Promise.resolve();
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(500);
  await Promise.resolve();
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(3);
  jest.advanceTimersByTime(500);
  const res3 = await p3;
  expect(res3.text).toBe('c');
  expect(fetch).toHaveBeenCalledTimes(3);
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('batch splits requests by token budget', async () => {
  fetch.mockResponses(
    JSON.stringify({ output: { text: 'A' } }),
    JSON.stringify({ output: { text: 'B' } }),
    JSON.stringify({ output: { text: 'C' } })
  );
  const inputs = ['a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80)];
  const res = await qwenTranslateBatch({
    texts: inputs,
    source: 'en',
    target: 'es',
    tokenBudget: 30,
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(res.texts).toEqual(['A', 'B', 'C']);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('batch splits oversized single text', async () => {
  fetch.mockResponses(
    JSON.stringify({ output: { text: 'A1' } }),
    JSON.stringify({ output: { text: 'A2' } })
  );
  const long = 'a'.repeat(220);
  const res = await qwenTranslateBatch({
    texts: [long],
    source: 'en',
    target: 'es',
    tokenBudget: 30,
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(res.texts[0]).toBe('A1 A2');
});

test('batch propagates HTTP 400 errors', async () => {
  fetch.mockResponseOnce(JSON.stringify({ message: 'bad request' }), { status: 400 });
  await expect(
    qwenTranslateBatch({
      texts: ['too long'],
      source: 'en',
      target: 'es',
      tokenBudget: 50,
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'm',
    })
  ).rejects.toThrow('HTTP 400');
});

test('batch locks token budget after parameter limit error', async () => {
  fetch
    .mockResponseOnce(JSON.stringify({ output: { text: 'A' } }))
    .mockResponseOnce(JSON.stringify({ message: 'Parameter limit exceeded' }), { status: 400 })
    .mockResponseOnce(JSON.stringify({ output: { text: 'B' } }));

  _setTokenBudget(1000, false);

  await qwenTranslateBatch({
    texts: ['a'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  const grown = _getTokenBudget();
  expect(grown).toBeGreaterThan(1000);

  await qwenTranslateBatch({
    texts: ['b'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(_getTokenBudget()).toBe(1000);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('batch retranslates unchanged lines', async () => {
  fetch
    .mockResponseOnce(JSON.stringify({ output: { text: 'foo\uE000BAR' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'FOO' } }));
  const res = await qwenTranslateBatch({
    texts: ['foo', 'bar'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(res.texts).toEqual(['FOO', 'BAR']);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('stores compressed cache entries', async () => {
  jest.resetModules();
  window.localStorage.clear();
  const LZ = require('lz-string');
  const t = require('../src/translator.js');
  const tr = t.qwenTranslate;
  fetch.mockResponseOnce(JSON.stringify({ output: { text: 'hi' } }));
  await tr({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: 'hola', source: 'es', target: 'en' });
  const stored = JSON.parse(window.localStorage.getItem('qwenCache'));
  const key = 'es:en:hola';
  expect(stored[key]).toBeDefined();
  expect(stored[key]).not.toContain('hi');
  const decoded = JSON.parse(LZ.decompressFromUTF16(stored[key]));
  expect(decoded.text).toBe('hi');
  window.localStorage.clear();
  t.qwenClearCache();
});

test('token budget grows after successful batch', async () => {
  fetch.mockResponseOnce(JSON.stringify({ output: { text: 'A\uE000B' } }));
  _setTokenBudget(1000, false);
  await qwenTranslateBatch({
    texts: ['a', 'b'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(_getTokenBudget()).toBeGreaterThan(1000);
});

test('batch groups multiple texts into single request by default', async () => {
  fetch.mockResponseOnce(JSON.stringify({ output: { text: 'A\uE000B\uE000C' } }));
  const res = await qwenTranslateBatch({
    texts: ['a', 'b', 'c'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(res.texts).toEqual(['A', 'B', 'C']);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('batch deduplicates repeated texts', async () => {
  fetch.mockResponseOnce(JSON.stringify({ output: { text: 'HOLA\uE000MUNDO' } }));
  const res = await qwenTranslateBatch({
    texts: ['hello', 'world', 'hello'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(res.texts).toEqual(['HOLA', 'MUNDO', 'HOLA']);
  const res2 = await qwenTranslateBatch({
    texts: ['hello', 'world', 'hello'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(res2.texts).toEqual(['HOLA', 'MUNDO', 'HOLA']);
});

test('batch falls back on separator mismatch', async () => {
  jest.useFakeTimers();
  fetch
    .mockResponseOnce(JSON.stringify({ output: { text: 'A' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'A1' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'B1' } }));
  const promise = qwenTranslateBatch({
    texts: ['a', 'b'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  await jest.runAllTimersAsync();
  const res = await promise;
  expect(res.texts).toEqual(['A1', 'B1']);
  expect(fetch).toHaveBeenCalledTimes(3);
  jest.useRealTimers();
});

test('batch reports stats and progress', async () => {
  fetch.mockResponseOnce(JSON.stringify({ output: { text: 'A\uE000B' } }));
  const events = [];
  const res = await qwenTranslateBatch({
    texts: ['a', 'b'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
    onProgress: e => events.push(e),
  });
  expect(res.texts).toEqual(['A', 'B']);
  expect(res.stats.requests).toBe(1);
  expect(events[0].request).toBe(1);
  expect(events[0].requests).toBe(1);
  expect(events[0].phase).toBe('translate');
});

test('advanced mode prefers turbo under limit', async () => {
  _setGetUsage(() => ({ requestLimit: 100, requests: 10 }));
  fetch.mockResponseOnce(JSON.stringify({ output: { text: 'a' } }));
  await translate({
    endpoint: 'https://e/',
    apiKey: 'k',
    models: ['qwen-mt-turbo', 'qwen-mt-plus'],
    text: 'one',
    source: 'en',
    target: 'es',
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('qwen-mt-turbo');
});

test('advanced mode shifts to plus near limit', async () => {
  _setGetUsage(() => ({ requestLimit: 100, requests: 50 }));
  fetch.mockResponseOnce(JSON.stringify({ output: { text: 'b' } }));
  await translate({
    endpoint: 'https://e/',
    apiKey: 'k',
    models: ['qwen-mt-turbo', 'qwen-mt-plus'],
    text: 'two',
    source: 'en',
    target: 'es',
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('qwen-mt-plus');
});

test('retries after 429 with backoff', async () => {
  jest.useFakeTimers();
  fetch
    .mockResponseOnce(
      JSON.stringify({ message: 'slow' }),
      { status: 429, headers: { 'retry-after': '1' } }
    )
    .mockResponseOnce(JSON.stringify({ output: { text: 'ok' } }));
  const start = Date.now();
  const promise = translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: 'hi', source: 'en', target: 'es' });
  await jest.advanceTimersByTimeAsync(1000);
  const res = await promise;
  expect(res.text).toBe('ok');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
  jest.useRealTimers();
});

test('advanced mode falls back to plus model after 429', async () => {
  fetch
    .mockResponseOnce(
      JSON.stringify({ message: 'slow' }),
      { status: 429 }
    )
    .mockResponseOnce(JSON.stringify({ output: { text: 'hi' } }));
  const res = await translate({
    endpoint: 'https://e/',
    apiKey: 'k',
    models: ['qwen-mt-turbo', 'qwen-mt-plus'],
    text: 'hola',
    source: 'es',
    target: 'en',
  });
  expect(res.text).toBe('hi');
  const first = JSON.parse(fetch.mock.calls[0][1].body);
  const second = JSON.parse(fetch.mock.calls[1][1].body);
  expect(first.model).toBe('qwen-mt-turbo');
  expect(second.model).toBe('qwen-mt-plus');
});

test('collapseSpacing joins spaced letters into words', () => {
  const { collapseSpacing } = translator;
  const input = 'E E N  D I E F S T A L  I N  G R O N I N G E N';
  expect(collapseSpacing(input)).toBe('EEN DIEFSTAL IN GRONINGEN');
});

test('collapseSpacing leaves normal text intact', () => {
  const { collapseSpacing } = translator;
  expect(collapseSpacing('Hello world')).toBe('Hello world');
});
