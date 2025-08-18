// @jest-environment node

describe('translator auto-detects source language', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('qwenTranslate uses detected source', async () => {
    jest.doMock('../src/lib/detect.js', () => ({
      detectLocal: (t) => ({ lang: /bonjour|français/i.test(t) ? 'fr' : 'en', confidence: 0.9 })
    }));
    const Providers = require('../src/lib/providers.js');
    const spy = jest.fn(async ({ source, text }) => ({ text: `SRC:${source}:${text}` }));
    Providers.register('dashscope', { translate: spy });
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');
    const res = await qwenTranslate({
      text: 'bonjour',
      source: 'auto',
      target: 'en',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      noProxy: true
    });

    expect(res.text).toBe('SRC:fr:bonjour');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0].source).toBe('fr');
  });

  test('qwenTranslateBatch detects per text and groups by language', async () => {
    jest.doMock('../src/lib/detect.js', () => ({
      detectLocal: (t) => ({ lang: /bonjour/i.test(String(t)) ? 'fr' : 'en', confidence: 0.8 })
    }));
    const Providers = require('../src/lib/providers.js');
    const spy = jest.fn(async ({ text }) => ({ text })); // echos batch text
    Providers.register('dashscope', { translate: spy });
    Providers.init();
    const { qwenTranslateBatch } = require('../src/translator.js');
    const res = await qwenTranslateBatch({
      texts: ['bonjour le monde', 'salut'],
      source: 'auto',
      target: 'en',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      tokenBudget: 10000,
      maxBatchSize: 200,
      noProxy: true
    });

    expect(res.texts.length).toBe(2);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const srcs = spy.mock.calls.map(c => c[0].source);
    expect(srcs).toContain('fr');
    expect(srcs).toContain('en');
  });

  test('falls back when detection below sensitivity', async () => {
    jest.doMock('../src/lib/detect.js', () => ({
      detectLocal: (t, opts) => opts && opts.sensitivity > 0.2
        ? { lang: 'en', confidence: 0.2 }
        : { lang: 'fr', confidence: 0.2 }
    }));
    const Providers = require('../src/lib/providers.js');
    const spy = jest.fn(async ({ source, text }) => ({ text: `SRC:${source}:${text}` }));
    Providers.register('dashscope', { translate: spy });
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');
    await qwenTranslate({
      text: 'bonjour',
      source: 'auto',
      target: 'en',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      noProxy: true,
      sensitivity: 0.5
    });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0].source).toBe('en');
  });

  test('falls back when text shorter than minDetectLength', async () => {
    jest.doMock('../src/lib/detect.js', () => ({
      detectLocal: () => ({ lang: 'fr', confidence: 0.9 })
    }));
    global.self = { qwenConfig: { minDetectLength: 5 } };
    const Providers = require('../src/lib/providers.js');
    const spy = jest.fn(async ({ source, text }) => ({ text: `SRC:${source}:${text}` }));
    Providers.register('dashscope', { translate: spy });
    Providers.init();
    const { qwenTranslate } = require('../src/translator.js');
    await qwenTranslate({
      text: 'hi',
      source: 'auto',
      target: 'en',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'm',
      noProxy: true
    });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0].source).toBe('en');
  });
});
