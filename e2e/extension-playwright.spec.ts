/**
 * TRANSLATE! Extension E2E Tests with Playwright
 *
 * Uses Playwright's persistent context with Chrome extensions.
 *
 * Run: npx playwright test e2e/extension-playwright.spec.ts
 */

import { test as base } from '@playwright/test';
import { test, expect, popupUrl } from './fixtures';
import path from 'path';

// Skip in CI (extensions require headed mode)
const SKIP_CI = process.env.CI === 'true';

test.describe.configure({ mode: 'serial' });

test.describe('TRANSLATE! Extension E2E', () => {
  test('extension loads and has service worker', async ({ extensionId }) => {
    if (SKIP_CI) test.skip();

    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(10);
  });

  test('popup page renders', async ({ context, extensionId }) => {
    if (SKIP_CI) test.skip();

    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));

    // Wait for Solid.js to render
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    const title = await page.locator('.brand-title').textContent();
    expect(title).toBe('TRANSLATE!');

    await page.close();
  });

  test('language selectors have expected options', async ({ context, extensionId }) => {
    if (SKIP_CI) test.skip();

    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
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

  test('can select target language', async ({ context, extensionId }) => {
    if (SKIP_CI) test.skip();

    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
    await page.waitForSelector('.language-select', { timeout: 10000 });

    // Select Finnish
    await page.locator('.language-select').last().selectOption('fi');

    const selected = await page.locator('.language-select').last().inputValue();
    expect(selected).toBe('fi');

    await page.close();
  });

  test('swap languages button works', async ({ context, extensionId }) => {
    if (SKIP_CI) test.skip();

    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
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

  test('translate page button is clickable', async ({ context, extensionId }) => {
    if (SKIP_CI) test.skip();

    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));

    const button = page.locator('.action-btn--primary');
    await expect(button).toBeVisible({ timeout: 10000 });
    await expect(button).toBeEnabled();
    await expect(button).toContainText('Page');

    await page.close();
  });

  test('service worker responds to ping', async ({ context, extensionId }) => {
    if (SKIP_CI) test.skip();

    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
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

  test('test page loads correctly', async ({ context }) => {
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
base.describe('Manual E2E Guide', () => {
  base('prints manual test checklist', async () => {
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
