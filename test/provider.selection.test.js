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
});
