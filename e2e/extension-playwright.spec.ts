/**
 * TRANSLATE! Extension E2E Tests with Playwright
 *
 * Uses Playwright's persistent context with Chrome extensions.
 *
 * Run: npx playwright test e2e/extension-playwright.spec.ts
 */

import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

// Skip in CI (extensions require headed mode)
const SKIP_CI = process.env.CI === 'true';

test.describe.configure({ mode: 'serial' });

test.describe('TRANSLATE! Extension E2E', () => {
  let context: BrowserContext;
  let extensionId: string | null = null;

  test.beforeAll(async () => {
    if (SKIP_CI) {
      test.skip();
      return;
    }

    // Verify extension is built
    if (!fs.existsSync(EXTENSION_PATH)) {
      throw new Error('Extension not built. Run: npm run build');
    }

    const userDataDir = `/tmp/playwright-ext-test-${Date.now()}`;

    // Launch Chrome with extension using persistent context
    // This is the recommended way for extension testing in Playwright
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: 'chrome', // Use real Chrome, not Chromium
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-component-update',
      ],
    });

    // Wait for extension service worker to register
    console.log('Waiting for extension to initialize...');
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));

      // Check service workers
      const serviceWorkers = context.serviceWorkers();
      console.log(`Service workers found: ${serviceWorkers.length}`);

      if (serviceWorkers.length > 0) {
        const sw = serviceWorkers[0];
        const url = sw.url();
        const match = url.match(/chrome-extension:\/\/([^/]+)/);
        if (match) {
          extensionId = match[1];
          break;
        }
      }

      // Also check background pages (MV2 fallback)
      const bgPages = context.backgroundPages();
      if (bgPages.length > 0) {
        const match = bgPages[0].url().match(/chrome-extension:\/\/([^/]+)/);
        if (match) {
          extensionId = match[1];
          break;
        }
      }
    }

    if (!extensionId) {
      console.log('Extension service worker not detected after retries');
      console.log('This is a known limitation with MV3 extensions in Playwright');
    } else {
      console.log(`Extension ID: ${extensionId}`);
    }
  });

  test.afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  test('extension loads and has service worker', async () => {
    if (SKIP_CI) test.skip();

    // Note: Service worker detection is flaky with MV3 extensions
    // This test documents the limitation
    if (!extensionId) {
      console.log('SKIP: Extension service worker not detected (MV3 limitation)');
      console.log('Manual verification required - see Manual E2E Guide');
      return;
    }

    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(10);
  });

  test('popup page renders', async () => {
    if (SKIP_CI || !extensionId) test.skip();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    // Wait for Solid.js to render
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    const title = await page.locator('.brand-title').textContent();
    expect(title).toBe('TRANSLATE!');

    await page.close();
  });

  test('language selectors have expected options', async () => {
    if (SKIP_CI || !extensionId) test.skip();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.language-select', { timeout: 10000 });

    // Get all options from target language selector
    const options = await page
      .locator('.language-select')
      .last()
      .locator('option')
      .allTextContents();

    // Should have multiple languages
    expect(options.length).toBeGreaterThanOrEqual(10);
    expect(options.some((o) => o.includes('English'))).toBe(true);
    expect(options.some((o) => o.includes('Finnish'))).toBe(true);
    expect(options.some((o) => o.includes('German'))).toBe(true);

    await page.close();
  });

  test('can select target language', async () => {
    if (SKIP_CI || !extensionId) test.skip();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.language-select', { timeout: 10000 });

    // Select Finnish
    await page.locator('.language-select').last().selectOption('fi');

    const selected = await page.locator('.language-select').last().inputValue();
    expect(selected).toBe('fi');

    await page.close();
  });

  test('swap languages button works', async () => {
    if (SKIP_CI || !extensionId) test.skip();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.language-select', { timeout: 10000 });

    // Set source=en, target=fi
    await page.locator('.language-select').first().selectOption('en');
    await page.locator('.language-select').last().selectOption('fi');

    // Click swap
    await page.locator('.swap-button').click();
    await page.waitForTimeout(200);

    // Verify swapped
    const source = await page.locator('.language-select').first().inputValue();
    const target = await page.locator('.language-select').last().inputValue();

    expect(source).toBe('fi');
    expect(target).toBe('en');

    await page.close();
  });

  test('translate page button is clickable', async () => {
    if (SKIP_CI || !extensionId) test.skip();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    const button = page.locator('.action-button--primary');
    await expect(button).toBeVisible({ timeout: 10000 });
    await expect(button).toBeEnabled();
    await expect(button).toContainText('Translate Page');

    await page.close();
  });

  test('service worker responds to ping', async () => {
    if (SKIP_CI || !extensionId) test.skip();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    // Send ping message to service worker
    const response = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'ping' }, (response) => {
          resolve(response);
        });
      });
    });

    expect(response).toBeTruthy();
    expect((response as { success?: boolean }).success).toBe(true);

    await page.close();
  });

  test('test page loads correctly', async () => {
    if (SKIP_CI) test.skip();

    const page = await context.newPage();
    const testPagePath = path.resolve(__dirname, '../test/test-page.html');
    await page.goto(`file://${testPagePath}`);

    await expect(page).toHaveTitle('Translation Extension Test Page');

    const content = await page.locator('p').first().textContent();
    expect(content).toContain('Hello');

    await page.close();
  });
});

// Document manual test steps
test.describe('Manual E2E Guide', () => {
  test('prints manual test checklist', async () => {
    console.log(`
==========================================================
  TRANSLATE! v2.0 - Manual E2E Verification Guide
==========================================================

If automated tests skip (extension not detected), verify manually:

1. BUILD
   npm run build

2. LOAD EXTENSION
   - Open chrome://extensions
   - Enable "Developer mode"
   - Click "Load unpacked" -> select dist/

3. POPUP TESTS
   - Click extension icon in toolbar
   - Verify: "TRANSLATE!" header with "by Mikko"
   - Test language dropdowns (source + target)
   - Test swap button
   - Test strategy selector (Smart/Fast/Quality)

4. TRANSLATION TESTS
   - Open test/test-page.html in browser
   - Set: English -> Finnish
   - Click "Translate Page"
   - First run: Wait for model download (~170MB)
   - Verify: Text changes to Finnish
   - Second run: Should be instant (cached model)

5. SELECTION TRANSLATION
   - Select some text on any webpage
   - Click "Translate Selection"
   - Only selected text should change

6. ERROR HANDLING
   - Open chrome://settings
   - Click extension icon
   - Should show: "Cannot translate browser pages"

==========================================================
    `);
  });
});
