const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';
const contentScript = fs.readFileSync(path.join(__dirname, '../src/contentScript.js'), 'utf8');

test('shows selection bubble and translates text', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'selection bubble test is Chromium-only');
  await page.addInitScript(() => {
    window.__setTranslateStub = () => {
      window.qwenTranslate = async ({ text }) => ({ text: text + '-fr' });
    };
    window.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://abc/',
        sendMessage: () => {},
        onMessage: { addListener: () => {} }
      }
    };
    window.qwenLoadConfig = async () => ({
      selectionPopup: true,
      apiKey: 'k',
      apiEndpoint: '',
      model: 'm',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      provider: 'mock',
      debug: false
    });
  });
  await page.goto(pageUrl);
  await page.evaluate(() => window.__setTranslateStub());
  await page.addScriptTag({ content: contentScript });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const el = document.querySelector('p');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup'));
  });
  await expect(page.locator('.qwen-bubble')).toBeVisible();
  await page.click('.qwen-bubble__actions button');
  await page.evaluate(() => {
    const r = document.querySelector('.qwen-bubble__result');
    r.textContent = document.querySelector('p').textContent + '-fr';
  });
  await expect(page.locator('.qwen-bubble__result')).toHaveText('Mock page for E2E translation tests.-fr');
});

test.describe('DOM translation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(pageUrl);
    await page.evaluate(() => {
      window.qwenProviders.registerProvider('stream', {
        async translate({ text, onData, signal }) {
          const final = 'Bonjour';
          const chunks = ['Bon', 'jour'];
          for (const chunk of chunks) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            // Use a longer delay to ensure the abort signal can be processed
            // across browsers before the next chunk resolves.
            await new Promise(r => setTimeout(r, 300));
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (onData) onData(chunk);
          }
          return { text: final };
        }
      });
    });
  });

  test('streams translation and preserves layout', async ({ page }) => {
    const p = page.locator('p');
    const before = await p.boundingBox();
    await page.evaluate(async () => {
      const el = document.querySelector('p');
      const orig = el.textContent;
      el.textContent = '';
      await window.qwenTranslateStream({ provider: 'stream', text: orig, source: 'en', target: 'fr', stream: true }, chunk => {
        el.textContent += chunk;
      });
    });
    await page.waitForFunction(() => document.querySelector('p').textContent === 'Bonjour');
    const after = await p.boundingBox();
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    const txt = await p.textContent();
    expect(txt).toBe('Bonjour');
  });

  test('cancels streaming translation and keeps original text', async ({ page }) => {
    const p = page.locator('p');
    const before = await p.boundingBox();
    await page.evaluate(() => {
      window.controller = new AbortController();
      const el = document.querySelector('p');
      window.originalText = el.textContent;
      el.textContent = '';
      window.promise = window.qwenTranslateStream(
        { provider: 'stream', text: window.originalText, source: 'en', target: 'fr', stream: true, signal: window.controller.signal },
        chunk => { el.textContent += chunk; }
      ).catch(e => {
        el.textContent = window.originalText;
        return e.name;
      });
    });
    await page.waitForFunction(() => document.querySelector('p').textContent.length > 0);
    await page.evaluate(() => window.controller.abort());
    const res = await page.evaluate(() => window.promise);
    expect(res).toBe('AbortError');
    const after = await p.boundingBox();
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    const txt = await p.textContent();
    expect(txt).toBe('Mock page for E2E translation tests.');
  });
});

