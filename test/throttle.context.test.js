const Providers = require('../src/lib/providers');

describe('throttle contexts', () => {
  beforeEach(() => {
    Providers.reset();
  });
  test('separate throttles per context', async () => {
    Providers.register('dummy', {
      translate: jest.fn(() => Promise.resolve({ text: 'ok' })),
      throttle: { contexts: { default: { requestLimit: 1 }, stream: { requestLimit: 2 } } },
    });
    Providers.init();
    const { qwenTranslate, qwenTranslateStream, _throttleKeys } = require('../src/translator');
    await qwenTranslate({ text: 'a', target: 'en', provider: 'dummy', noProxy: true });
    await qwenTranslateStream({ text: 'b', target: 'en', provider: 'dummy', noProxy: true });
    expect(_throttleKeys().sort()).toEqual(['dummy:default', 'dummy:stream']);
  });
});
