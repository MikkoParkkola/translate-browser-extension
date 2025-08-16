// @jest-environment node

describe('translator cache stats', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('counts words for cached translations', async () => {
    const Providers = require('../src/lib/providers.js');
    Providers.reset();
    const provider = { translate: jest.fn(async ({ text }) => ({ text: `T:${text}` })) };
    Providers.register('mock', provider);
    Providers.init();
    const tr = require('../src/translator.js');
    tr.qwenClearCache();
    await tr.qwenTranslateBatch({
      texts: ['hello world'],
      source: 'en',
      target: 'fr',
      providerOrder: ['mock'],
      noProxy: true,
    });
    provider.translate.mockClear();
    const res = await tr.qwenTranslateBatch({
      texts: ['hello world'],
      source: 'en',
      target: 'fr',
      providerOrder: ['mock'],
      noProxy: true,
    });
    expect(provider.translate).not.toHaveBeenCalled();
    expect(res.stats.words).toBeGreaterThan(0);
    expect(res.stats.tokens).toBeGreaterThan(0);
    expect(res.stats.requests).toBe(0);
  });
});
