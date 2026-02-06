const logger = require('../src/lib/logger');
const entries = [];
const remove = logger.addCollector(e => entries.push(e));

jest.mock('../src/lib/providers', () => {
  return {
    isInitialized: () => false,
    candidates: () => ['stub'],
    get: () => ({ translate: async () => ({ text: 'hi' }) }),
    choose: () => 'stub',
    init: jest.fn(),
  };
});

jest.mock('../src/providers', () => ({ initProviders: jest.fn() }));

const translator = require('../src/translator');

afterAll(() => remove());

test.skip('warns once when providers uninitialized', async () => {
  const opts = {
    endpoint: 'https://example.com',
    apiKey: 'k',
    model: 'm',
    text: 'hello',
    source: 'en',
    target: 'es',
    noProxy: true,
  };
  const res1 = await translator.qwenTranslate(opts);
  const res2 = await translator.qwenTranslate(opts);
  expect(res1).toEqual({ text: 'hi' });
  expect(res2).toEqual({ text: 'hi' });
  const warns = entries.filter(e => e.level === 'warn' && /not initialized/i.test(e.args[0]));
  expect(warns.length).toBe(1);
});
