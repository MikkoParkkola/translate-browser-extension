const { test, expect } = require('@playwright/test');

async function serveIfNeeded(page) {
  const httpBase = 'http://127.0.0.1:8080';
  try {
    const res = await page.goto(httpBase + '/404', {
      waitUntil: 'domcontentloaded',
      timeout: 5000,
    });
    if (res) return httpBase;
  } catch {}
  return 'file://' + process.cwd();
}

test.describe('Engine smoke', () => {
  async function runSmoke(page, engine) {
    const base = await serveIfNeeded(page);
    const url = `${base}/src/qa/engine-smoke.html?engine=${engine}`;
    await page.goto(url);
    await page.waitForFunction(() => window.smokeOk === true, { timeout: 120000 });
    const cn = await page.locator('#out canvas');
    await expect(cn).toHaveCount(1);
    const w = await cn.evaluate(el => el.width);
    const h = await cn.evaluate(el => el.height);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  }

  test('Simple engine smoke', async ({ page }) => {
    await runSmoke(page, 'simple');
  });

  test('Overlay engine smoke', async ({ page }) => {
    await runSmoke(page, 'overlay');
  });
});
