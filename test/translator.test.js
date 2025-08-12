const translator = require('../src/translator.js');
const {
  qwenTranslate: translate,
  qwenClearCache,
  qwenTranslateBatch,
  _getTokenBudget,
  _setTokenBudget,
} = translator;
const { configure } = require('../src/throttle');
const fetchMock = require('jest-fetch-mock');

beforeAll(() => { fetchMock.enableMocks(); });

beforeEach(() => {
  fetch.resetMocks();
  qwenClearCache();
  configure({ requestLimit: 60, tokenLimit: 100000, windowMs: 60000 });
  _setTokenBudget(0);
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

test('rate limiting queues requests', async () => {
  jest.useFakeTimers();
  configure({ requestLimit: 2, tokenLimit: 100000, windowMs: 1000 });
  fetch
    .mockResponseOnce(JSON.stringify({output:{text:'a'}}))
    .mockResponseOnce(JSON.stringify({output:{text:'b'}}))
    .mockResponseOnce(JSON.stringify({output:{text:'c'}}));

  const p1 = translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'1', source:'es', target:'en'});
  const p2 = translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'2', source:'es', target:'en'});
  const p3 = translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'3', source:'es', target:'en'});

  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(1000);
  const res3 = await p3;
  expect(res3.text).toBe('c');
  expect(fetch).toHaveBeenCalledTimes(3);
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

test('batch falls back on separator mismatch', async () => {
  fetch
    .mockResponseOnce(JSON.stringify({ output: { text: 'A' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'A1' } }))
    .mockResponseOnce(JSON.stringify({ output: { text: 'B1' } }));
  const res = await qwenTranslateBatch({
    texts: ['a', 'b'],
    source: 'en',
    target: 'es',
    endpoint: 'https://e/',
    apiKey: 'k',
    model: 'm',
  });
  expect(res.texts).toEqual(['A1', 'B1']);
  expect(fetch).toHaveBeenCalledTimes(3);
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

test('retries after 429 with backoff', async () => {
  fetch
    .mockResponseOnce(JSON.stringify({ message: 'slow' }), { status: 429, headers: { 'retry-after': '1' } })
    .mockResponseOnce(JSON.stringify({ output: { text: 'ok' } }));
  const start = Date.now();
  const res = await translate({ endpoint: 'https://e/', apiKey: 'k', model: 'm', text: 'hi', source: 'en', target: 'es' });
  expect(res.text).toBe('ok');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
}, 10000);
