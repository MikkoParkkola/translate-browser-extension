// End-to-end PDF visual comparison using Playwright and the in-repo compare.html
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.pdf')) return 'application/pdf';
  if (p.endsWith('.wasm')) return 'application/wasm';
  if (p.endsWith('.json')) return 'application/json; charset=utf-8';
  if (p.endsWith('.ttf')) return 'font/ttf';
  return 'application/octet-stream';
}

async function createServer(rootDir) {
  return await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
        const filePath = path.join(rootDir, urlPath);
        if (!filePath.startsWith(rootDir)) {
          res.statusCode = 403; res.end('forbidden'); return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.statusCode = 404; res.end('not found'); return;
        }
        const buf = fs.readFileSync(filePath);
        res.setHeader('Content-Type', contentType(filePath));
        res.setHeader('Cache-Control', 'no-store');
        res.end(buf);
      } catch (e) {
        res.statusCode = 500; res.end(String(e));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

test.describe('PDF visual compare', () => {
  let srv;
  let baseUrl;

  test.beforeAll(async () => {
    const root = path.resolve(__dirname, '..');
    const { server, port } = await createServer(root);
    srv = server;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test.afterAll(async () => {
    await new Promise((r) => srv.close(r));
  });

  async function openCompare(page, leftRel, rightRel, doDiff = true) {
    const url = `${baseUrl}/src/qa/compare.html?src1=${encodeURIComponent(leftRel)}&src2=${encodeURIComponent(rightRel)}&diff=${doDiff?1:0}&autoload=1`;
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
    const pdf = '/translated.pdf';
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
    const a = '/translated.pdf';
    const b = '/translated_1.pdf';
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
});
