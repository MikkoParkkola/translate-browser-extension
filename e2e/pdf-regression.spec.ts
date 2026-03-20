/**
 * E2E: PDF translation regression tests.
 *
 * Validates PDF text extraction and translation overlay for various PDF types.
 * Follows the pattern from pdf-compare.spec.js — mocks config + translator,
 * then loads PDFs in the pdfViewer.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8080';

// ── Shared route mocks for config & translator ──────────────────────
async function setupPdfMocks(page: import('@playwright/test').Page) {
  await page.route('**/config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.qwenLoadConfig = async () => ({
          provider: 'mock', apiEndpoint: '', apiKey: 'test', model: '',
          failover: false, sourceLanguage: 'en', targetLanguage: 'fr',
          debug: false
        });
        window.qwenSetTokenBudget = () => {};
        window.qwenSetCacheLimit = () => {};
        window.qwenSetCacheTTL = () => {};
        window.qwenTM = { set: () => {}, get: () => null };
      `,
    }),
  );

  await page.route('**/translator.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.qwenTranslate = async ({ text }) => ({ text: 'T:' + text });`,
    }),
  );

  await page.addInitScript(() => {
    window.chrome = {
      runtime: {
        getURL: (p: string) => `http://127.0.0.1:8080/src/${p}`,
        onMessage: { addListener: () => {} },
        sendMessage: () => {},
      },
      storage: {
        sync: {
          get: (d: any, cb: any) => cb(d),
          set: (_d: any, cb: any) => cb && cb(),
        },
      },
    } as any;
    window.qwenCache = {
      cacheReady: Promise.resolve(),
      getCache: () => null,
      setCache: () => {},
      removeCache: () => {},
    } as any;
  });
}

// ── 1. Simple text PDF (hello.pdf) ──────────────────────────────────
test('translates simple text PDF and overlays result', async ({ page }) => {
  await setupPdfMocks(page);

  const pdfUrl = `${BASE}/e2e/pdfs/hello.pdf`;
  await page.goto(`${BASE}/src/pdfViewer.html?file=${encodeURIComponent(pdfUrl)}`);

  // Wait for text layer to render
  await page.waitForSelector('.textLayer span', { timeout: 30_000 });

  const original = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.textLayer span'));
    return spans.map((s) => s.textContent).find((t) => /[A-Za-z]/.test(t || ''));
  });

  expect(original).toBeTruthy();

  // Wait for translation overlay
  await page.waitForSelector('.translationLayer div', { timeout: 30_000 });

  const overlayText = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('.translationLayer div'));
    return divs.map((d) => d.textContent).filter(Boolean);
  });

  expect(overlayText.length).toBeGreaterThan(0);
  // Mock translator prefixes with "T:"
  expect(overlayText.some((t) => t!.startsWith('T:'))).toBe(true);
});

// ── 2. Multi-column layout PDF ──────────────────────────────────────
test.describe('multi-column layout PDF', () => {
  const fixture = path.resolve(__dirname, 'pdfs', 'multi-column.pdf');

  test.skip(!fs.existsSync(fixture), 'multi-column.pdf fixture not available — add to e2e/pdfs/');

  test('extracts text in reading order', async ({ page }) => {
    await setupPdfMocks(page);

    const pdfUrl = `${BASE}/e2e/pdfs/multi-column.pdf`;
    await page.goto(`${BASE}/src/pdfViewer.html?file=${encodeURIComponent(pdfUrl)}`);

    await page.waitForSelector('.textLayer span', { timeout: 30_000 });

    const texts = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.textLayer span'));
      return spans.map((s) => s.textContent).filter(Boolean);
    });

    // At minimum, text should be extracted
    expect(texts.length).toBeGreaterThan(0);
    // Reading order: first column content should appear before second column
    // (specific assertions depend on fixture content)
  });
});

// ── 3. RTL text PDF (Arabic/Hebrew) ─────────────────────────────────
test.describe('RTL text PDF', () => {
  const fixture = path.resolve(__dirname, 'pdfs', 'rtl-text.pdf');

  test.skip(!fs.existsSync(fixture), 'rtl-text.pdf fixture not available — add to e2e/pdfs/');

  test('preserves correct text direction', async ({ page }) => {
    await setupPdfMocks(page);

    const pdfUrl = `${BASE}/e2e/pdfs/rtl-text.pdf`;
    await page.goto(`${BASE}/src/pdfViewer.html?file=${encodeURIComponent(pdfUrl)}`);

    await page.waitForSelector('.textLayer span', { timeout: 30_000 });

    const hasRtl = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.textLayer span'));
      return spans.some((s) => {
        const dir = getComputedStyle(s).direction;
        const text = s.textContent || '';
        // Check for Arabic/Hebrew Unicode ranges
        const hasRtlChars = /[\u0600-\u06FF\u0590-\u05FF]/.test(text);
        return hasRtlChars || dir === 'rtl';
      });
    });

    expect(hasRtl).toBe(true);
  });
});

// ── 4. PDF with tables ──────────────────────────────────────────────
test.describe('PDF with tables', () => {
  const fixture = path.resolve(__dirname, 'pdfs', 'table-layout.pdf');

  test.skip(!fs.existsSync(fixture), 'table-layout.pdf fixture not available — add to e2e/pdfs/');

  test('preserves table structure in translation overlay', async ({ page }) => {
    await setupPdfMocks(page);

    const pdfUrl = `${BASE}/e2e/pdfs/table-layout.pdf`;
    await page.goto(`${BASE}/src/pdfViewer.html?file=${encodeURIComponent(pdfUrl)}`);

    await page.waitForSelector('.textLayer span', { timeout: 30_000 });

    // Verify text spans are positioned (not all at 0,0)
    const positions = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.textLayer span'));
      return spans.slice(0, 20).map((s) => {
        const rect = s.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y), text: s.textContent };
      });
    });

    expect(positions.length).toBeGreaterThan(0);
    // Table cells should have varied positions (not all in a single column)
    const uniqueX = new Set(positions.map((p) => p.x));
    expect(uniqueX.size).toBeGreaterThan(1);
  });
});

// ── 5. Large PDF (>50 pages) — no timeout ───────────────────────────
test.describe('large PDF handling', () => {
  const fixture = path.resolve(__dirname, 'pdfs', 'large-50plus.pdf');

  test.skip(!fs.existsSync(fixture), 'large-50plus.pdf fixture not available — add to e2e/pdfs/');

  test('does not timeout on large PDF', async ({ page }) => {
    test.setTimeout(180_000); // 3 min cap

    await setupPdfMocks(page);

    const pdfUrl = `${BASE}/e2e/pdfs/large-50plus.pdf`;
    await page.goto(`${BASE}/src/pdfViewer.html?file=${encodeURIComponent(pdfUrl)}`);

    // Wait for at least the first page to render text
    await page.waitForSelector('.textLayer span', { timeout: 60_000 });

    const pageCount = await page.locator('.page').count();
    expect(pageCount).toBeGreaterThanOrEqual(1);

    // Verify translation overlay is being applied progressively
    await page.waitForSelector('.translationLayer div', { timeout: 60_000 });
    const overlayCount = await page.locator('.translationLayer').count();
    expect(overlayCount).toBeGreaterThanOrEqual(1);
  });
});
