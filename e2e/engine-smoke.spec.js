const { test, expect } = require('@playwright/test');

async function serveIfNeeded(page) {
  // fallback: use built-in file URL if server not present; adjust in harness if needed
}

test.describe('Engine smoke', () => {
  async function runSmoke(page, engine) {
    // Best-effort local file URL fallback if server not available
    const base = 'file://' + process.cwd();
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
