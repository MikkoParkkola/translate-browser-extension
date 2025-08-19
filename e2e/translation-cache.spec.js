const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

test.describe('Provider switching and cache', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__setTranslateStub = () => {
        window.qwenTranslate = async opts => {
          const prov = window.qwenProviders.getProvider(opts.provider);
          return prov.translate(opts);
        };
        window.qwenTranslateBatch = async ({ texts = [], provider, source, target, force }) => {
          const prov = window.qwenProviders.getProvider(provider);
          const out = [];
          for (const text of texts) {
            const key = `${provider}:${source}:${target}:${text}`;
            const cached = !force && window.qwenCache.getCache(key);
            if (cached) {
              out.push(cached.text);
            } else {
              const res = await prov.translate({ text, source, target, provider });
              window.qwenCache.setCache(key, { text: res.text });
              out.push(res.text);
            }
          }
          return { texts: out };
        };
      };
      window.__setCacheStub = () => {
        window.qwenCache = {
          cacheReady: Promise.resolve(),
          getCache: key => {
            const raw = localStorage.getItem('cache:' + key);
            return raw ? JSON.parse(raw) : null;
          },
          setCache: (key, val) => {
            localStorage.setItem('cache:' + key, JSON.stringify(val));
          },
          removeCache: key => {
            localStorage.removeItem('cache:' + key);
          },
          qwenClearCache: () => {
            Object.keys(localStorage)
              .filter(k => k.startsWith('cache:'))
              .forEach(k => localStorage.removeItem(k));
          },
          qwenGetCacheSize: () =>
            Object.keys(localStorage).filter(k => k.startsWith('cache:')).length,
          qwenSetCacheLimit: () => {},
          qwenSetCacheTTL: () => {},
        };
        window.qwenClearCache = window.qwenCache.qwenClearCache;
      };
      window.__setConfigStub = () => {
        window.qwenLoadConfig = async () => {
          const raw = localStorage.getItem('cfg');
          return raw ? JSON.parse(raw) : { providerOrder: [], debug: false };
        };
        window.qwenSaveConfig = async cfg => {
          localStorage.setItem('cfg', JSON.stringify(cfg));
        };
      };
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const shot = await page.screenshot({
        path: testInfo.outputPath('failure.png'),
        fullPage: true,
      });
      await testInfo.attach('screenshot', { body: shot, contentType: 'image/png' });
    }
  });

  test('batch translations cache results and support provider change', async ({ page }) => {
    await page.goto(pageUrl);
    await page.evaluate(() => {
      window.__setCacheStub();
      window.__setTranslateStub();
    });
    await page.evaluate(() => {
      window.qwenProviders.registerProvider('mock2', {
        async translate({ text }) {
          return { text: text + '-es' };
        },
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
    await page.evaluate(() => {
      window.__setCacheStub();
      window.__setTranslateStub();
    });
    await page.evaluate(() => {
      window.qwenProviders.registerProvider('mock2', {
        async translate({ text }) {
          return { text: text + '-es' };
        },
      });
    });
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

  test('persists providers and settings across reloads', async ({ page }) => {
    await page.goto(pageUrl);
    await page.evaluate(() => {
      window.__setCacheStub();
      window.__setTranslateStub();
      window.__setConfigStub();
    });
    await page.evaluate(() => {
      window.qwenProviders.registerProvider('mock2', {
        async translate({ text }) {
          return { text: text + '-es' };
        },
      });
    });
    await page.evaluate(async () => {
      await window.qwenSaveConfig({ providerOrder: ['mock', 'mock2'], debug: true });
    });
    await page.reload();
    await page.evaluate(() => {
      window.__setCacheStub();
      window.__setTranslateStub();
      window.__setConfigStub();
    });
    await page.evaluate(() => {
      window.qwenProviders.registerProvider('mock2', {
        async translate({ text }) {
          return { text: text + '-es' };
        },
      });
    });
    const cfg = await page.evaluate(() => window.qwenLoadConfig());
    expect(cfg.providerOrder).toEqual(['mock', 'mock2']);
    expect(cfg.debug).toBe(true);
  });

  test('quota warning when provider limit exceeded', async ({ page }) => {
    await page.goto(pageUrl);
    await page.evaluate(() => {
      window.__setCacheStub();
      window.__setTranslateStub();
    });
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
        },
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
