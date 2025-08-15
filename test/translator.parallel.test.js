// @jest-environment node

describe('translator parallel mode', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('distributes batches by provider weight', async () => {
    const Providers = require('../src/lib/providers.js');
    Providers.reset();
    const a = { translate: jest.fn(async ({ text }) => ({ text: `A:${text}` })), throttle: { tokenLimit: 100 }, costPerToken: 1 };
    const b = { translate: jest.fn(async ({ text }) => ({ text: `B:${text}` })), throttle: { tokenLimit: 100 }, costPerToken: 2 };
    Providers.register('a', a);
    Providers.register('b', b);
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
    const res = await qwenTranslateBatch({
      texts: ['one', 'two', 'three', 'four', 'five', 'six'],
      source: 'en',
      target: 'fr',
      tokenBudget: 100,
      maxBatchSize: 1,
      providerOrder: ['a', 'b'],
      parallel: true,
      failover: false,
      noProxy: true,
    });
    expect(res.texts).toEqual(['A:one', 'B:two', 'A:three', 'A:four', 'B:five', 'A:six']);
    expect(a.translate).toHaveBeenCalledTimes(4);
    expect(b.translate).toHaveBeenCalledTimes(2);
  });

  test('falls back when provider quota exhausted', async () => {
    const Providers = require('../src/lib/providers.js');
    Providers.reset();
    const a = { translate: jest.fn(async ({ text }) => ({ text: `A:${text}` })), throttle: { tokenLimit: 4 }, costPerToken: 1 };
    const b = { translate: jest.fn(async ({ text }) => ({ text: `B:${text}` })), throttle: { tokenLimit: 100 }, costPerToken: 25 };
    Providers.register('a', a);
    Providers.register('b', b);
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
    const res = await qwenTranslateBatch({
      texts: ['1','2','3','4','5','6','7','8','9','10'],
      source: 'en',
      target: 'fr',
      tokenBudget: 1,
      maxBatchSize: 1,
      providerOrder: ['a', 'b'],
      parallel: true,
      failover: false,
      noProxy: true,
    });
    expect(a.translate).toHaveBeenCalledTimes(4);
    expect(b.translate).toHaveBeenCalledTimes(6);
    expect(res.texts.slice(-2)).toEqual(['B:9', 'B:10']);
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
