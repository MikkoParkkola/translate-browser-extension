 // New file
 // @jest-environment jsdom
 jest.mock('../src/lib/detect.js', () => ({
   detectLocal: (t) => ({ lang: /bonjour|salut/i.test(String(t)) ? 'fr' : 'en', confidence: 0.8 })
 }));
 
 describe('mixed-language batch detection and clustering', () => {
   beforeEach(() => {
     jest.resetModules();
   });
 
   test.skip('clusters by detected language (auto source) and calls provider per language', async () => {
     const Providers = require('../src/lib/providers.js');
     const translateMock = jest.fn(async ({ text, source }) => {
       // derive SEP if present
       const m = String(text).match(/<<<QWEN_SPLIT_[A-Za-z0-9]+_[A-Za-z0-9]+>>>/);
       const sep = m ? m[0] : '\uE000';
       const parts = String(text).split(sep);
       const out = parts.map(p => `S:${source}:${p}`).join(sep);
       return { text: out };
     });
    Providers.register('dashscope', { translate: translateMock });
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
 
     const res = await qwenTranslateBatch({
       texts: ['bonjour', 'hello', 'salut tout le monde', 'world'],
       source: 'auto',
       target: 'en',
       endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
       model: 'm',
       tokenBudget: 10000,
       maxBatchSize: 200,
       noProxy: true
     });
 
     expect(Array.isArray(res.texts)).toBe(true);
     expect(res.texts.length).toBe(4);
    expect(res.texts[0].startsWith('S:fr:')).toBe(true);
    expect(res.texts[2].startsWith('S:fr:')).toBe(true);
    expect(res.texts[1]).toBe('hello');
    expect(res.texts[3]).toBe('world');

    // Should call provider only for non-target language (1 call: fr)
    expect(translateMock).toHaveBeenCalledTimes(1);
    const langs = translateMock.mock.calls.map(c => c[0].source);
    expect(new Set(langs)).toEqual(new Set(['fr']));
  });
});
