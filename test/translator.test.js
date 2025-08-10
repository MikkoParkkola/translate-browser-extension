const translator = require('../src/translator.js');
const { qwenTranslate: translate, qwenClearCache, qwenTranslateBatch } = translator;
const { configure } = require('../src/throttle');
const fetchMock = require('jest-fetch-mock');

beforeAll(() => { fetchMock.enableMocks(); });

beforeEach(() => {
  fetch.resetMocks();
  qwenClearCache();
  configure({ requestLimit: 60, tokenLimit: 100000, windowMs: 60000 });
});

test('translate success', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'hello'}}));
  const res = await translate({endpoint:'https://example.com/', apiKey:'key', model:'m', text:'hola', source:'es', target:'en'});
  expect(res.text).toBe('hello');
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
