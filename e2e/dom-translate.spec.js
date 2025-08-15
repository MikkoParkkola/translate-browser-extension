const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

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
            await new Promise(r => setTimeout(r, 100));
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

