const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';
const contentScript = fs.readFileSync(path.join(__dirname, '../src/contentScript.js'), 'utf8');

test('translates selected text via context menu', async ({ page }) => {
  await page.goto(pageUrl);
  await page.addInitScript(() => {
    window.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://abc/',
        sendMessage: () => {},
        onMessage: { addListener: cb => { window.__qwenMsg = cb; } }
      }
    };
    window.qwenTranslate = async ({ text }) => ({ text: text + '-fr' });
    window.qwenTranslateBatch = async ({ texts }) => ({ texts: texts.map(t => t + '-fr') });
    window.qwenLoadConfig = async () => ({ apiKey: 'k', apiEndpoint: '', model: 'm', sourceLanguage: 'en', targetLanguage: 'fr', provider: 'mock', debug: false });
  });
  await page.addScriptTag({ content: contentScript });
  await page.setContent('<p id="t">hello</p>');
  await page.evaluate(() => {
    const el = document.getElementById('t');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    window.__qwenMsg({ action: 'translate-selection' });
  });
  const result = await page.$eval('#t', el => el.textContent);
  expect(result).toBe('hello-fr');
});
