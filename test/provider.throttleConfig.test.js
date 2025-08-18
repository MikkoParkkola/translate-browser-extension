const Providers = require('../src/lib/providers');

jest.mock('../src/throttle', () => {
  const createThrottle = jest.fn(() => ({
    runWithRateLimit: fn => Promise.resolve(fn()),
    runWithRetry: fn => Promise.resolve(fn()),
  }));
  return { createThrottle, approxTokens: () => 1 };
});

afterEach(() => {
  Providers.reset();
  jest.resetModules();
});

test('uses provider throttle config when creating queue', async () => {
  Providers.register('mock', {
    translate: async () => ({ text: 'ok' }),
    throttle: { requestLimit: 1, windowMs: 1234 },
  });
  Providers.init();
  const { qwenTranslate } = require('../src/translator');
  await qwenTranslate({ text: 'hi', source: 'en', target: 'fr', provider: 'mock', noProxy: true });
  const { createThrottle } = require('../src/throttle');
  expect(createThrottle).toHaveBeenCalledWith({ requestLimit: 1, windowMs: 1234 });
});
