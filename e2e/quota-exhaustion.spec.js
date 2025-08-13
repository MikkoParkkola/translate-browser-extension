const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

test.skip('surfaces provider quota errors', async ({ page }) => {
  await page.goto(pageUrl);
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
