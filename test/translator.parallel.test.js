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

  test('respects requestLimit when parallel', async () => {
    const Providers = require('../src/lib/providers.js');
    Providers.reset();
    let inFlight = 0;
    let maxInFlight = 0;
    const a = {
      translate: jest.fn(async ({ text }) => {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        return { text: `A:${text}` };
      })
    };
    Providers.register('a', a);
    Providers.init();
    const tr = require('../src/translator.js');
    tr._setGetUsage(() => ({ requestLimit: 2 }));
    const res = await tr.qwenTranslateBatch({
      texts: ['one', 'two', 'three', 'four'],
      source: 'en',
      target: 'fr',
      tokenBudget: 100,
      maxBatchSize: 1,
      providerOrder: ['a'],
      parallel: true,
      failover: false,
      noProxy: true,
    });
    expect(a.translate).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(res.stats.avgRequestMs).toBeGreaterThan(0);
    expect(res.stats.requestsPerSecond).toBeGreaterThan(0);
  });
});
