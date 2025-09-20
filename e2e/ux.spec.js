// Playwright E2E: UX conformance
const { test, expect } = require('@playwright/test');

test.describe('Popup UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.chrome = {
        runtime: {
          sendMessage: (msg) => {
            if (msg === 'home:init' || (msg && msg.action === 'home:init')) {
              return Promise.resolve({
                provider: 'dashscope',
                providers: { dashscope: { model: 'qwen-mt-turbo', endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1' } },
                usage: { requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 100000 },
                apiKey: true
              });
            }
            if (msg === 'debug-info' || (msg && msg.action === 'debug-info')) {
              return Promise.resolve({ ok: true, usage: {}, providersUsage: {}, config: {}, cache: {}, tm: {}, health: { lastProviderOk: true } });
            }
            if (msg === 'permissions-check' || (msg && msg.action === 'permissions-check')) return Promise.resolve({ granted: true });
            if (msg === 'permissions-request' || (msg && msg.action === 'permissions-request')) return Promise.resolve({ granted: true });
            if (msg && msg.action === 'metrics') return Promise.resolve({});
            return Promise.resolve({});
          },
          getURL: (p) => p,
        }
      };
    });
    await page.goto('http://127.0.0.1:8080/popup.html');
  });

  test('header shows provider/model and Online status', async ({ page }) => {
    await expect(page.locator('[data-test="active-provider"]')).toHaveText('dashscope');
    await expect(page.locator('[data-test="active-model"]')).toHaveText('qwen-mt-turbo');
    await expect(page.locator('[data-test="status-badge"]')).toContainText('Online');
  });

  test('strategy presets exist', async ({ page }) => {
    await expect(page.locator('[data-test="strategy-fast"]')).toBeVisible();
    await expect(page.locator('[data-test="strategy-cheap"]')).toBeVisible();
    await expect(page.locator('[data-test="strategy-balanced"]')).toBeVisible();
  });

  test('Copy Debug returns JSON', async ({ page }) => {
    await page.click('#copy-debug');
    // We cannot read clipboard in all CI contexts; instead, call the exposed test API
    const info = await page.evaluate(() => window.qwenTestApi.gatherDebugInfo());
    expect(info).toHaveProperty('app');
    expect(info).toHaveProperty('background');
    expect(info).toHaveProperty('home');
  });
});

test.describe('Settings UX', () => {
  test('settings loads and has provider list', async ({ page }) => {
    await page.goto('http://127.0.0.1:8080/popup/settings.html');
    await expect(page.locator('#providerList')).toBeVisible();
  });
});
