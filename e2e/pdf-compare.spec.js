// End-to-end PDF visual comparison using Playwright and the in-repo compare.html
const { test, expect } = require('@playwright/test');

test.describe('PDF visual compare', () => {
  async function openCompare(page, leftRel, rightRel, doDiff = true) {
    const base = 'http://127.0.0.1:8080';
    const url = `${base}/src/qa/compare.html?src1=${encodeURIComponent(leftRel)}&src2=${encodeURIComponent(rightRel)}&diff=${doDiff?1:0}&autoload=1`;
    await page.goto(url);
    // Wait for canvases to render by waiting until status isn’t "Loading…"
    await page.waitForFunction(() => {
      const s = document.querySelector('#status')?.textContent || '';
      return s && !/Loading/.test(s);
    }, { timeout: 120_000 });
    const { diffScore, diffPages } = await page.evaluate(() => ({
      diffScore: window.diffScore ?? 0,
      diffPages: Array.isArray(window.diffPages) ? window.diffPages : [],
    }));
    const canvases = await page.locator('canvas').count();
    return { diffScore, diffPages, canvases };
  }

  test('identical PDFs produce near-zero diff', async ({ page }, testInfo) => {
    const pdf = '/e2e/pdfs/translated.pdf';
    const { diffScore, diffPages, canvases } = await openCompare(page, pdf, pdf, true);
    try {
      expect(canvases).toBeGreaterThan(0);
      expect(diffScore).toBeLessThan(0.002); // <0.2%
      for (const s of diffPages) expect(s).toBeLessThan(0.004); // each page <0.4%
    } catch (e) {
      const shot = await page.screenshot({ path: `playwright-report/identical-failure.png`, fullPage: true });
      await testInfo.attach('identical-screenshot', { body: shot, contentType: 'image/png' });
      // Try to export overlay canvases
      try {
        const overlays = await page.evaluate(() => {
          const arr = [];
          document.querySelectorAll('#right div').forEach(div => {
            const canvases = div.querySelectorAll('canvas');
            if (canvases.length >= 2) {
              const overlay = canvases[1];
              arr.push(overlay.toDataURL('image/png'));
            }
          });
          return arr;
        });
        for (let i=0;i<overlays.length;i++) {
          const b64 = overlays[i].split(',')[1] || '';
          const buf = Buffer.from(b64, 'base64');
          await testInfo.attach(`identical-overlay-${i+1}.png`, { body: buf, contentType: 'image/png' });
        }
      } catch {}
      throw e;
    }
  });

  test('different PDFs produce noticeable diff', async ({ page }, testInfo) => {
    const a = '/e2e/pdfs/translated.pdf';
    const b = '/e2e/pdfs/translated_1.pdf';
    const { diffScore, diffPages, canvases } = await openCompare(page, a, b, true);
    try {
      expect(canvases).toBeGreaterThan(0);
      // Either overall score or at least one page should exceed threshold
      const pageMax = diffPages.reduce((m, v) => Math.max(m, v), 0);
      expect(diffScore > 0.008 || pageMax > 0.01).toBeTruthy();
    } catch (e) {
      const shot = await page.screenshot({ path: `playwright-report/different-failure.png`, fullPage: true });
      await testInfo.attach('different-screenshot', { body: shot, contentType: 'image/png' });
      // Try to export overlay canvases
      try {
        const overlays = await page.evaluate(() => {
          const arr = [];
          document.querySelectorAll('#right div').forEach(div => {
            const canvases = div.querySelectorAll('canvas');
            if (canvases.length >= 2) {
              const overlay = canvases[1];
              arr.push(overlay.toDataURL('image/png'));
            }
          });
          return arr;
        });
        for (let i=0;i<overlays.length;i++) {
          const b64 = overlays[i].split(',')[1] || '';
          const buf = Buffer.from(b64, 'base64');
          await testInfo.attach(`different-overlay-${i+1}.png`, { body: buf, contentType: 'image/png' });
        }
      } catch {}
      throw e;
    }
  });

  test('loads PDF, translates, and overlays text', async ({ page }) => {
    await page.route('**/config.js', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          window.qwenLoadConfig = async () => ({
            provider: 'mock',
            apiEndpoint: '',
            apiKey: 'test',
            model: '',
            failover: false,
            sourceLanguage: 'en',
            targetLanguage: 'fr',
            debug: false
          });
          window.qwenSetTokenBudget = () => {};
          window.qwenSetCacheLimit = () => {};
          window.qwenSetCacheTTL = () => {};
          window.qwenTM = { set: () => {}, get: () => null };
        `
      });
    });
    await page.route('**/translator.js', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: 'window.qwenTranslate = async ({ text }) => ({ text: `T:${text}` });'
      });
    });
    await page.addInitScript(() => {
      window.chrome = {
        runtime: {
          getURL: p => `http://127.0.0.1:8080/src/${p}`,
          onMessage: { addListener: () => {} },
          sendMessage: () => {}
        },
        storage: { sync: { get: (d, cb) => cb(d), set: (_d, cb) => cb && cb() } }
      };
      window.qwenCache = {
        cacheReady: Promise.resolve(),
        getCache: () => null,
        setCache: () => {},
        removeCache: () => {}
      };
    });
    const pdfUrl = 'http://127.0.0.1:8080/e2e/pdfs/hello.pdf';
    await page.goto(`http://127.0.0.1:8080/src/pdfViewer.html?file=${encodeURIComponent(pdfUrl)}`);
    await page.waitForSelector('.translationLayer div');
    const original = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.textLayer span'));
      return spans.map(s => s.textContent).find(t => /[A-Za-z]/.test(t));
    });
    const expected = `T:${original}`;
    await expect(page.locator('.translationLayer div', { hasText: expected }).first()).toHaveText(expected);
    const pages = await page.locator('.page').count();
    const overlays = await page.locator('.translationLayer').count();
    expect(pages).toBe(1);
    expect(overlays).toBe(pages);
  });

  test('viewer progress reacts to translation-status', async ({ page }) => {
    await page.addInitScript(() => {
      window.__listeners = [];
      window.chrome = {
        runtime: {
          onMessage: { addListener: fn => window.__listeners.push(fn) },
          sendMessage: () => {}
        }
      };
    });
    await page.goto('http://127.0.0.1:8080/src/pdfViewer.html?file=/e2e/pdfs/translated.pdf');
    const progress = page.locator('.qwen-progress');
    await expect(progress).toBeHidden();
    await page.evaluate(() => {
      window.__listeners.forEach(fn => fn({ action: 'translation-status', status: { active: true, phase: 'translate', progress: 0.5 } }));
    });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('data-phase', 'translate');
    await expect(progress).toHaveJSProperty('value', 0.5);
    await page.evaluate(() => {
      window.__listeners.forEach(fn => fn({ action: 'translation-status', status: { active: false } }));
    });
    await expect(progress).toBeHidden();
  });
});
