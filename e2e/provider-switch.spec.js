const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

test('falls back to secondary provider on failure', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.addInitScript(() => {
    window.__setStub = () => {
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
    };
  });

  await page.goto(pageUrl);
  await page.evaluate(() => window.__setStub());

  await page.evaluate(() => {
    window.qwenProviders.registerProvider('fail', {
      async translate() {
        console.log('primary provider used');
        const err = new Error('fail');
        err.retryable = false;
        throw err;
      },
    });
    window.qwenProviders.registerProvider('ok', {
      async translate({ text }) {
        console.log('fallback provider used');
        return { text: text + '-ok' };
      },
    });
  });

  const res = await page.evaluate(() =>
    window.qwenTranslate({
      text: 'hello',
      source: 'en',
      target: 'fr',
      provider: 'fail',
      providerOrder: ['fail', 'ok'],
    })
  );

  expect(res.text).toBe('hello-ok');
  expect(logs.some(t => /fallback provider used/.test(t))).toBe(true);
});

