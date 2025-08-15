// @jest-environment node

describe('translator parallel mode', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('distributes batches across providers', async () => {
    const Providers = require('../src/lib/providers.js');
    Providers.reset();
    const a = { translate: jest.fn(async ({ text }) => ({ text: `A:${text}` })) };
    const b = { translate: jest.fn(async ({ text }) => ({ text: `B:${text}` })) };
    Providers.register('a', a);
    Providers.register('b', b);
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
    const res = await qwenTranslateBatch({
      texts: ['one', 'two', 'three', 'four'],
      source: 'en',
      target: 'fr',
      tokenBudget: 100,
      maxBatchSize: 1,
      providerOrder: ['a', 'b'],
      parallel: true,
      failover: false,
      noProxy: true,
    });
    expect(res.texts).toEqual(['A:one', 'B:two', 'A:three', 'B:four']);
    expect(a.translate).toHaveBeenCalledTimes(2);
    expect(b.translate).toHaveBeenCalledTimes(2);
  });
});
