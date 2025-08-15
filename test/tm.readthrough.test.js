// @jest-environment node

jest.mock('../src/lib/tm.js', () => {
  let hits = new Map();
  return {
    __setHits: (arr) => { hits = new Map(arr); },
    get: jest.fn(async (k) => (hits.has(k) ? { k, text: hits.get(k) } : null)),
    set: jest.fn(async () => {}),
  };
}, { virtual: false });

describe('TM read-through in batch translation', () => {
  let TM;
  beforeEach(() => {
    jest.resetModules();
    TM = require('../src/lib/tm.js');
    delete global.chrome;
  });

  test('skips provider for cached entries and only translates misses', async () => {
    TM.__setHits([
      ['en:es:A', 'TA'],
      ['en:es:C', 'TC'],
    ]);
    const Providers = require('../src/lib/providers.js');
    const translateMock = jest.fn(async ({ text }) => ({ text: `T:${text}` }));
    Providers.register('dashscope', { translate: translateMock });
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
    const res = await qwenTranslateBatch({
      texts: ['A', 'B', 'C'],
      source: 'en',
      target: 'es',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      tokenBudget: 10000,
      maxBatchSize: 200,
    });
    expect(res.texts).toEqual(['TA', 'T:B', 'TC']);
    expect(translateMock).toHaveBeenCalledTimes(1);
    expect(res.stats.requests).toBe(1);
    expect(res.stats.tokens).toBeGreaterThan(0);
    expect(TM.set).toHaveBeenCalledTimes(1);
    expect(TM.set.mock.calls[0][0]).toBe('en:es:B');
  });

  test('all cached -> provider not called; zero requests/tokens', async () => {
    TM.__setHits([
      ['en:es:A', 'TA'],
      ['en:es:B', 'TB'],
      ['en:es:C', 'TC'],
    ]);
    const Providers = require('../src/lib/providers.js');
    const translateMock = jest.fn(async ({ text }) => ({ text }));
    Providers.register('dashscope', { translate: translateMock });
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
    const res = await qwenTranslateBatch({
      texts: ['A', 'B', 'C'],
      source: 'en',
      target: 'es',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      tokenBudget: 10000,
      maxBatchSize: 200,
    });
    expect(res.texts).toEqual(['TA', 'TB', 'TC']);
    expect(translateMock).not.toHaveBeenCalled();
    expect(res.stats.requests).toBe(0);
    expect(res.stats.tokens).toBe(0);
  });
});
