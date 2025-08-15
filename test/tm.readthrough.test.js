 // New file
 // @jest-environment node

 describe('TM read-through in batch translation', () => {
   beforeEach(() => {
     jest.resetModules();
   });

   test('skips provider for cached entries and only translates misses', async () => {
     // Mock TM to return hits for A and C
     jest.mock('../src/lib/tm.js', () => {
       let hits = new Map();
       return {
         __setHits: (arr) => { hits = new Map(arr); },
         get: jest.fn(async (k) => {
           if (hits.has(k)) return { k, text: hits.get(k) };
           return null;
         }),
         set: jest.fn(async () => {})
       };
     }, { virtual: false });

     const TM = require('../src/lib/tm.js');
     TM.__setHits([
       ['en:es:A', 'TA'],
       ['en:es:C', 'TC'],
     ]);

     // Register a provider and observe translate() calls
     const Providers = require('../src/lib/providers.js');
     const translateMock = jest.fn(async ({ text }) => ({ text: `T:${text}` }));
     Providers.register('dashscope', { translate: translateMock });

     const { qwenTranslateBatch } = require('../src/translator.js');

     const res = await qwenTranslateBatch({
       texts: ['A', 'B', 'C'],
       source: 'en',
       target: 'es',
       endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
       model: 'm',
       tokenBudget: 10000, // single group for misses
       maxBatchSize: 200,
     });

     expect(res.texts).toEqual(['TA', 'T:B', 'TC']);
     // Only B was a miss -> one provider call
     expect(translateMock).toHaveBeenCalledTimes(1);
     // One group, one request
     expect(res.stats.requests).toBe(1);
     expect(res.stats.tokens).toBeGreaterThan(0);

     // TM.set should only be invoked for misses (B)
     const tmModule = require('../src/lib/tm.js');
     expect(tmModule.set).toHaveBeenCalledTimes(1);
     const callArgs = tmModule.set.mock.calls[0];
     expect(callArgs[0]).toBe('en:es:B');
   });

   test('all cached -> provider not called; zero requests/tokens', async () => {
     jest.resetModules();
     jest.mock('../src/lib/tm.js', () => {
       let hits = new Map();
       return {
         __setHits: (arr) => { hits = new Map(arr); },
         get: jest.fn(async (k) => {
           if (hits.has(k)) return { k, text: hits.get(k) };
           return null;
         }),
         set: jest.fn(async () => {})
       };
     }, { virtual: false });

     const TM = require('../src/lib/tm.js');
     TM.__setHits([
       ['en:es:A', 'TA'],
       ['en:es:B', 'TB'],
       ['en:es:C', 'TC'],
     ]);

     const Providers = require('../src/lib/providers.js');
     const translateMock = jest.fn(async ({ text }) => ({ text }));
     Providers.register('dashscope', { translate: translateMock });

     const { qwenTranslateBatch } = require('../src/translator.js');

     const res = await qwenTranslateBatch({
       texts: ['A', 'B', 'C'],
       source: 'en',
       target: 'es',
       endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
       model: 'm',
       tokenBudget: 10000,
       maxBatchSize: 200,
     });

     expect(res.texts).toEqual(['TA', 'TB', 'TC']);
     expect(translateMock).not.toHaveBeenCalled();
     expect(res.stats.requests).toBe(0);
     expect(res.stats.tokens).toBe(0);
   });
 });
