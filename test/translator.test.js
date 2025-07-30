const { qwenTranslate: translate, qwenClearCache } = require('../src/translator.js');
const fetchMock = require('jest-fetch-mock');

beforeAll(() => { fetchMock.enableMocks(); });

beforeEach(() => {
  fetch.resetMocks();
  qwenClearCache();
});

test('translate success', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'hello'}}));
  const res = await translate({endpoint:'https://example.com/', apiKey:'key', model:'m', text:'hola', target:'en'});
  expect(res.text).toBe('hello');
});

test('translate error', async () => {
  fetch.mockResponseOnce(JSON.stringify({message:'bad'}), {status:400});
  await expect(translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'x', target:'en'})).rejects.toThrow('bad');
});

test('translate caching', async () => {
  fetch.mockResponseOnce(JSON.stringify({output:{text:'hi'}}));
  const first = await translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'hola', target:'en'});
  expect(first.text).toBe('hi');
  const cached = await translate({endpoint:'https://e/', apiKey:'k', model:'m', text:'hola', target:'en'});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(cached.text).toBe('hi');
});
