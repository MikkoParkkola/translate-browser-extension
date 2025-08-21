// @jest-environment node

jest.mock('../src/lib/detect.js', () => ({
  detectLocal: (t) => ({
    lang: /hallo/i.test(String(t)) ? 'nl' : /bonjour/i.test(String(t)) ? 'fr' : 'en',
    confidence: 0.9,
  }),
}));

describe('fixed source language translation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('qwenTranslate translates only matching source language', async () => {
    const Providers = require('../src/lib/providers.js');
    const spy = jest.fn(async ({ text, source }) => ({ text: `SRC:${source}:${text}` }));
    Providers.register('dashscope', { translate: spy });
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');

    const dutch = await qwenTranslate({
      text: 'hallo wereld',
      source: 'nl',
      target: 'en',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      noProxy: true,
    });
    expect(dutch.text.startsWith('SRC:nl:')).toBe(true);

    const french = await qwenTranslate({
      text: 'bonjour',
      source: 'nl',
      target: 'en',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      noProxy: true,
    });
    expect(french.text).toBe('bonjour');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('qwenTranslateBatch skips non-source language texts', async () => {
    const Providers = require('../src/lib/providers.js');
    const translateMock = jest.fn(async ({ text, source }) => {
      const m = String(text).match(/<<<QWEN_SPLIT_[A-Za-z0-9]+_[A-Za-z0-9]+>>>/);
      const sep = m ? m[0] : '\uE000';
      const parts = String(text).split(sep);
      const out = parts.map((p) => `S:${source}:${p}`).join(sep);
      return { text: out };
    });
    Providers.register('dashscope', { translate: translateMock });
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
    const res = await qwenTranslateBatch({
      texts: ['hallo wereld', 'bonjour', 'hello'],
      source: 'nl',
      target: 'en',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      tokenBudget: 10000,
      maxBatchSize: 200,
      noProxy: true,
    });
    expect(res.texts[0].startsWith('S:nl:')).toBe(true);
    expect(res.texts[1]).toBe('bonjour');
    expect(res.texts[2]).toBe('hello');
    expect(translateMock).toHaveBeenCalledTimes(1);
    const langs = translateMock.mock.calls.map((c) => c[0].source);
    expect(new Set(langs)).toEqual(new Set(['nl']));
  });
});
