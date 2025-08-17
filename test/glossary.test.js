describe('glossary library', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const g = require('../src/lib/glossary');
    g.set({});
  });

  test('extracts repeated terms from document', () => {
    const g = require('../src/lib/glossary');
    document.body.innerHTML = '<p>Foo bar Foo baz Foo</p>';
    const map = g.parse(document, {});
    expect(map.Foo).toBe('Foo');
  });

  test('translator applies glossary replacements', async () => {
    jest.resetModules();
    global.qwenProviders = {
      get: () => ({ throttle: {}, translate: async ({ text }) => ({ text }) }),
      candidates: () => ['mock'],
      isInitialized: () => true,
    };
    const g = require('../src/lib/glossary');
    g.set({ Foo: 'Bar' });
    const { qwenTranslate } = require('../src/translator.js');
    const res = await qwenTranslate({ endpoint: '', model: 'm', text: 'Foo', source: 'en', target: 'zh', noProxy: true, provider: 'mock' });
    expect(res.text).toBe('Bar');
  });

  test('translator passes tone parameter', async () => {
    jest.resetModules();
    const spy = jest.fn(async ({ tone }) => ({ text: tone }));
    global.qwenProviders = {
      get: () => ({ throttle: {}, translate: spy }),
      candidates: () => ['mock'],
      isInitialized: () => true,
    };
    const g = require('../src/lib/glossary');
    g.setTone('technical');
    const { qwenTranslate } = require('../src/translator.js');
    const res = await qwenTranslate({ endpoint: '', model: 'm', text: 'Foo', source: 'en', target: 'zh', noProxy: true, provider: 'mock' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tone: 'technical' }));
    expect(res.text).toBe('technical');
  });
});
