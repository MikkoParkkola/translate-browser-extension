// e2e/popup.spec.js
const { test, expect, chromium } = require('@playwright/test');

test.describe('Extension Popup UI', () => {
  let browser, context, page;

  test.beforeAll(async () => {
    const extensionPath = require('path').join(__dirname, '../src');
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('should open the popup and display more than one language', async () => {
    await page.goto('chrome-extension://<extension-id>/popup.html'.replace('<extension-id>', await getExtensionId(page)));
    await page.waitForSelector('#target-language');
    const languages = await page.$$('#target-language option');
    expect(languages.length).toBeGreaterThan(1);
  });

  test('should open the options page when the settings button is clicked', async () => {
    await page.goto('chrome-extension://<extension-id>/popup.html'.replace('<extension-id>', await getExtensionId(page)));
    await page.waitForSelector('#settings-button');
    await page.click('#settings-button');
    await page.waitForTimeout(1000);
    const pages = await app.windows();
    const optionsPage = pages.find(p => p.url().includes('options.html'));
    expect(optionsPage).toBeTruthy();
  });
});

async function getExtensionId(page) {
  await page.goto('chrome://extensions');
  await page.waitForSelector('extensions-manager');
  return await page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const items = manager.shadowRoot.querySelectorAll('extensions-item');
    const item = Array.from(items).find(i => i.name === 'TRANSLATE! by Mikko');
    return item.id;
  });
}
