const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

test('switches providers for batch translations', async ({ page }) => {
  await page.addInitScript(() => {
    window.__setTranslateStub = () => {
      window.qwenTranslate = async opts => {
        const prov = window.qwenProviders.getProvider(opts.provider);
        return prov.translate(opts);
      };
      window.qwenTranslateBatch = async ({ texts = [], provider, source, target }) => {
        const prov = window.qwenProviders.getProvider(provider);
        const res = await Promise.all(texts.map(text => prov.translate({ text, source, target, provider })));
        return { texts: res.map(r => r.text) };
      };
    };
    window.qwenCache = {
      cacheReady: Promise.resolve(),
      getCache: () => null,
      setCache: () => {},
      removeCache: () => {},
      qwenClearCache: () => {},
      qwenGetCacheSize: () => 0,
      qwenSetCacheLimit: () => {},
      qwenSetCacheTTL: () => {},
    };
  });
  await page.goto(pageUrl);
  await page.evaluate(() => window.__setTranslateStub());
  await page.evaluate(() => {
    window.qwenProviders.registerProvider('mock2', {
      async translate({ text }) {
        return { text: text + '-es' };
      }
    });
  });
  const first = await page.evaluate(() =>
    window.qwenTranslateBatch({ texts: ['hello'], source: 'en', target: 'fr', provider: 'mock' })
  );
  expect(first.texts[0]).toBe('hello-fr');
  const second = await page.evaluate(() =>
    window.qwenTranslateBatch({ texts: ['hola'], source: 'en', target: 'es', provider: 'mock2' })
  );
  expect(second.texts[0]).toBe('hola-es');
});
