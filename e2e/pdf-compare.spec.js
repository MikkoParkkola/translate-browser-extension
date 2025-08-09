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
    const diffScore = await page.evaluate(() => window.diffScore ?? 0);
    const canvases = await page.locator('canvas').count();
    return { diffScore, canvases };
  }

  test('identical PDFs produce near-zero diff', async ({ page }) => {
    const pdf = '/translated.pdf';
    const { diffScore, canvases } = await openCompare(page, pdf, pdf, true);
    expect(canvases).toBeGreaterThan(0);
    expect(diffScore).toBeLessThan(0.001); // <0.1%
  });

  test('different PDFs produce noticeable diff', async ({ page }) => {
    const a = '/translated.pdf';
    const b = '/translated_1.pdf';
    const { diffScore, canvases } = await openCompare(page, a, b, true);
    expect(canvases).toBeGreaterThan(0);
    expect(diffScore).toBeGreaterThan(0.005); // >0.5%
  });
});

