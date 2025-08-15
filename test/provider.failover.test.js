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
 });
