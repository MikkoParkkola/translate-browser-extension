const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

test('surfaces provider quota errors', async ({ page }) => {
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
    let count = 0;
    window.qwenProviders.registerProvider('limited', {
      async translate({ text }) {
        count++;
        if (count > 2) {
          const err = new Error('quota exceeded');
          err.retryable = false;
          throw err;
        }
        return { text: text + '-fr' };
      }
    });
  });
  const res = await page.evaluate(async () => {
    try {
      await window.qwenTranslate({ provider: 'limited', text: 'a', source: 'en', target: 'fr' });
      await window.qwenTranslate({ provider: 'limited', text: 'b', source: 'en', target: 'fr' });
      await window.qwenTranslate({ provider: 'limited', text: 'c', source: 'en', target: 'fr' });
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  });
  expect(res.ok).toBe(false);
  expect(res.msg).toMatch(/quota exceeded/i);
});
