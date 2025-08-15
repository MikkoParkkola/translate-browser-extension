// New file
// @jest-environment node
describe('provider selection', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('uses explicit provider override', async () => {
    const Providers = require('../src/lib/providers.js');
    const fake = { translate: jest.fn(async ({ text }) => ({ text: `FAKE:${text}` })) };
    Providers.register('fake', fake);
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');

    const res = await qwenTranslate({
      provider: 'fake',
      text: 'hello',
      source: 'en',
      target: 'es',
      endpoint: 'https://example.local/',
      noProxy: true,
    });

    expect(res).toBeDefined();
    expect(res.text).toBe('FAKE:hello');
    expect(fake.translate).toHaveBeenCalled();
  });

  test('auto-selects by endpoint (openai)', async () => {
    const Providers = require('../src/lib/providers.js');
    const openai = { translate: jest.fn(async ({ text }) => ({ text: `OA:${text}` })) };
    Providers.register('openai', openai);
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');

    const res = await qwenTranslate({
      text: 'hey',
      source: 'en',
      target: 'es',
      endpoint: 'https://api.openai.com/v1',
      noProxy: true,
    });

    expect(res).toBeDefined();
    expect(res.text).toBe('OA:hey');
    expect(openai.translate).toHaveBeenCalled();
  });

  test('respects providerOrder with endpoints', async () => {
    const Providers = require('../src/lib/providers.js');
    const bad = {
      translate: jest.fn(async () => {
        const e = new Error('fail');
        e.retryable = false;
        throw e;
      }),
    };
    const good = {
      translate: jest.fn(async ({ text, endpoint }) => {
        expect(endpoint).toBe('https://good/');
        return { text: `OK:${text}` };
      }),
    };
    Providers.register('bad', bad);
    Providers.register('good', good);
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');

    const res = await qwenTranslate({
      text: 'hi',
      source: 'en',
      target: 'fr',
      endpoint: 'https://bad/',
      providerOrder: ['bad', 'good'],
      endpoints: { bad: 'https://bad/', good: 'https://good/' },
      noProxy: true,
    });

    expect(res).toEqual({ text: 'OK:hi' });
    expect(bad.translate).toHaveBeenCalled();
    expect(good.translate).toHaveBeenCalled();
  });
});
