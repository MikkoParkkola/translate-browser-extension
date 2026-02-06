/**
 * Extension E2E Tests (Puppeteer)
 *
 * These tests require a headed Chrome browser and manual setup.
 * Marked as skip since they need manual browser interaction.
 *
 * To run manually:
 *   1. npm run build
 *   2. Remove .skip from tests
 *   3. npm run test:e2e
 *
 * See extension.v2.test.ts for full E2E implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  getExtensionId,
  getExtensionIdFromChrome,
  openPopup,
  waitForElement,
  shouldSkipE2E,
  delay,
  TIMEOUTS,
} from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

describe('Extension E2E', () => {
  let browser: Browser;
  let page: Page;
  let extensionId: string | null = null;
  let userDataDir: string;

  beforeAll(async () => {
    // Skip in CI
    if (shouldSkipE2E()) {
      return;
    }

    // Verify dist exists
    if (!fs.existsSync(EXTENSION_PATH)) {
      console.warn('Extension not built. Run: npm run build');
      return;
    }

    userDataDir = `/tmp/puppeteer-e2e-${Date.now()}`;

    browser = await puppeteer.launch({
      headless: false,
      executablePath:
        process.platform === 'darwin'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : undefined,
      userDataDir,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    });

    await delay(4000);
    page = await browser.newPage();

    // Try to get extension ID
    extensionId = await getExtensionId(browser);
    if (!extensionId) {
      extensionId = await getExtensionIdFromChrome(page);
    }

    if (extensionId) {
      console.log(`Extension ID: ${extensionId}`);
    }
  }, TIMEOUTS.extensionLoad * 2);

  afterAll(async () => {
    if (browser) await browser.close();
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it.skip('extension loads without errors', async () => {
    // This test verifies the extension loads and service worker starts
    // Skip: Requires manual browser with extension loaded
    expect(extensionId).toBeTruthy();

    if (!extensionId) return;

    // Check for console errors in popup
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await openPopup(page, extensionId);
    await delay(2000);

    // Filter out expected extension-related messages
    const unexpectedErrors = errors.filter(
      (e) =>
        !e.includes('net::ERR_') && // Network errors are expected in test
        !e.includes('Failed to load resource') // Resource loading may fail
    );

    expect(unexpectedErrors).toHaveLength(0);
  });

  it.skip('popup opens and shows UI', async () => {
    // This test verifies popup HTML renders with Solid.js components
    // Skip: Requires extension ID discovery which is unreliable in automation
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    await openPopup(page, extensionId);
    await waitForElement(page, '.popup-container');

    // Verify main UI elements
    const header = await page.$eval('.brand-title', (el) => el.textContent);
    expect(header).toBe('TRANSLATE!');

    // Verify action buttons exist
    const translateButton = await page.$('.action-button--primary');
    expect(translateButton).toBeTruthy();
  });

  it.skip('language selectors are functional', async () => {
    // This test verifies language dropdowns work and can be changed
    // Skip: Requires headed browser with extension popup access
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    await openPopup(page, extensionId);
    await waitForElement(page, '.language-select');

    // Get all language options from target selector
    const options = await page.$$eval(
      '.language-select:last-of-type option',
      (opts) => opts.map((o) => (o as HTMLOptionElement).value)
    );

    // Should have multiple languages
    expect(options.length).toBeGreaterThanOrEqual(5);
    expect(options).toContain('en');
    expect(options).toContain('fi');

    // Test changing language
    const selects = await page.$$('.language-select');
    if (selects.length >= 2) {
      await selects[1].select('de');
      const selected = await page.$eval(
        '.language-select:last-of-type',
        (el) => (el as HTMLSelectElement).value
      );
      expect(selected).toBe('de');
    }
  });
});
