const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

test.describe('Provider switching and cache', () => {
  test('batch translations cache results and support provider change', async ({ page }) => {
    await page.goto(pageUrl);
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
      window.qwenTranslateBatch({ texts: ['hello'], source: 'en', target: 'es', provider: 'mock2' })
    );
    expect(second.texts[0]).toBe('hello-es');

    await page.evaluate(() =>
      window.qwenTranslateBatch({ texts: ['cacheme'], source: 'en', target: 'es', provider: 'mock2' })
    );
    await page.reload();
    const cached = await page.evaluate(async () => {
      const prov = window.qwenProviders.getProvider('mock2');
      let calls = 0;
      const orig = prov.translate;
      prov.translate = async opts => {
        calls++;
        return orig(opts);
      };
      const r = await window.qwenTranslateBatch({ texts: ['cacheme'], source: 'en', target: 'es', provider: 'mock2' });
      return { text: r.texts[0], calls };
    });
    expect(cached.text).toBe('cacheme-es');
    expect(cached.calls).toBe(0);

    const cleared = await page.evaluate(async () => {
      window.qwenClearCache();
      const prov = window.qwenProviders.getProvider('mock2');
      let calls = 0;
      const orig = prov.translate;
      prov.translate = async opts => {
        calls++;
        return orig(opts);
      };
      const r = await window.qwenTranslateBatch({ texts: ['cacheme'], source: 'en', target: 'es', provider: 'mock2' });
      return { text: r.texts[0], calls };
    });
    expect(cleared.text).toBe('cacheme-es');
    expect(cleared.calls).toBe(1);
  });

  test('quota warning when provider limit exceeded', async ({ page }) => {
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
});
