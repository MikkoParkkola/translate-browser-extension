const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';
const contentScript = fs.readFileSync(path.join(__dirname, '../src/contentScript.js'), 'utf8');

test('auto translates page content', async ({ page }) => {
  await page.addInitScript(() => {
    window.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://abc/',
        sendMessage: () => {},
        onMessage: { addListener: () => {} }
      },
      storage: { sync: { get: (_keys, cb) => cb({}), set: () => {} } }
    };
    window.qwenCache = {
      cacheReady: Promise.resolve(),
      getCache: () => null,
      setCache: () => {},
      removeCache: () => {},
      qwenClearCache: () => {},
      qwenGetCacheSize: () => 0,
      qwenSetCacheLimit: () => {},
      qwenSetCacheTTL: () => {}
    };
    window.qwenLoadConfig = async () => ({
      provider: 'mock',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      autoTranslate: true
    });
  });
  await page.goto(pageUrl);
  await page.addScriptTag({ content: contentScript });
  await page.waitForFunction(() => document.querySelector('p').textContent.endsWith('-fr'));
  const txt = await page.textContent('p');
  expect(txt).toBe('Mock page for E2E translation tests.-fr');
});
