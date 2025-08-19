 // New file
 // @jest-environment node

 describe('provider failover', () => {
   beforeEach(() => {
     jest.resetModules();
   });

   test('falls back to next provider when first returns retryable errors', async () => {
     const Providers = require('../src/lib/providers.js');

     const openai = {
       translate: jest.fn(async () => {
         const e = new Error('rate limited');
         e.retryable = true;
         e.retryAfter = 1; // ms for fast tests
         throw e;
       }),
     };
     const dashscope = {
       translate: jest.fn(async ({ text }) => ({ text: `OK:${text}` })),
     };

    Providers.register('openai', openai);
    Providers.register('dashscope', dashscope);
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');

     const res = await qwenTranslate({
       text: 'hello',
       source: 'en',
       target: 'es',
       endpoint: 'https://api.openai.com/v1', // choose -> 'openai'
       model: 'm',
       debug: false,
       stream: false,
       noProxy: true, // ensure no chrome messaging path in tests
     });

     expect(res).toEqual({ text: 'OK:hello' });
     // runWithRetry attempts 3 times on first provider
     expect(openai.translate).toHaveBeenCalledTimes(3);
     // then falls back to dashscope once
     expect(dashscope.translate).toHaveBeenCalledTimes(1);
   });

  test('falls back on non-retryable error without extra retries', async () => {
     const Providers = require('../src/lib/providers.js');

     const openai = {
       translate: jest.fn(async () => {
         const e = new Error('bad request');
         e.retryable = false;
         throw e;
       }),
     };
     const dashscope = {
       translate: jest.fn(async ({ text }) => ({ text: `OK:${text}` })),
     };

    Providers.register('openai', openai);
    Providers.register('dashscope', dashscope);
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');

     const res = await qwenTranslate({
       text: 'hola',
       source: 'es',
       target: 'en',
       endpoint: 'https://api.openai.com/v1',
       model: 'm',
       debug: false,
       stream: false,
       noProxy: true,
     });

     expect(res).toEqual({ text: 'OK:hola' });
     // non-retryable -> single call, then fallback
     expect(openai.translate).toHaveBeenCalledTimes(1);
    expect(dashscope.translate).toHaveBeenCalledTimes(1);
  });

  test('after initial success, retries and fails over on later retryable error', async () => {
    const Providers = require('../src/lib/providers.js');

    let attempt = 0;
    const openai = {
      translate: jest.fn(async ({ text }) => {
        if (attempt++ === 0) return { text: `OK:${text}` };
        const e = new Error('rate limited');
        e.retryable = true;
        e.retryAfter = 1;
        throw e;
      }),
    };
    const dashscope = {
      translate: jest.fn(async ({ text }) => ({ text: `F:${text}` })),
    };

    Providers.register('openai', openai);
    Providers.register('dashscope', dashscope);
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');

    const first = await qwenTranslate({
      text: 'first',
      source: 'en',
      target: 'es',
      endpoint: 'https://api.openai.com/v1',
      model: 'm',
      debug: false,
      stream: false,
      noProxy: true,
    });
    expect(first).toEqual({ text: 'OK:first' });
    expect(openai.translate).toHaveBeenCalledTimes(1);
    expect(dashscope.translate).toHaveBeenCalledTimes(0);

    const second = await qwenTranslate({
      text: 'second',
      source: 'en',
      target: 'es',
      endpoint: 'https://api.openai.com/v1',
      model: 'm',
      debug: false,
      stream: false,
      noProxy: true,
    });
    expect(second).toEqual({ text: 'F:second' });
    // first call + 3 retry attempts on second call
    expect(openai.translate).toHaveBeenCalledTimes(4);
    expect(dashscope.translate).toHaveBeenCalledTimes(1);
  });
});
