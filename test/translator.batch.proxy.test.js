const throttle = require('../src/throttle');
const { configure, reset, runWithRateLimit, approxTokens } = throttle;
const { runWithRetry } = require('../src/retry');

describe('qwenTranslateBatch proxy usage', () => {
  beforeEach(() => {
    jest.resetModules();
    reset();
    configure({ requestLimit: 60, tokenLimit: 100000, windowMs: 60000 });
    window.qwenThrottle = { runWithRateLimit, runWithRetry, approxTokens };
  });

  afterEach(() => {
    delete global.chrome;
    delete window.qwenMessaging;
    delete window.qwenProviders;
  });

  test('uses background messaging when noProxy not set', async () => {
    const requestViaBackground = jest.fn().mockResolvedValue({ text: 'hola' });
    window.qwenMessaging = { requestViaBackground };
    global.chrome = { runtime: {} };
    window.qwenProviders = { candidates: () => ['mock'], get: () => ({ translate: async () => ({ text: 'hola' }) }) };
    const { qwenTranslateBatch } = require('../src/translator.js');
    await qwenTranslateBatch({ texts: ['hi'], endpoint: 'https://e/', model: 'm', source: 'en', target: 'es' });
    expect(requestViaBackground).toHaveBeenCalled();
  });
});
