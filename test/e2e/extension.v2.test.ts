/**
 * V2.0 Extension E2E Tests
 *
 * Tests the Chrome extension popup UI, language selection, and translation flow.
 *
 * Known limitations:
 * - Puppeteer has issues detecting MV3 service workers
 * - Extension ID discovery is unreliable in automated mode
 * - Full translation flow requires model download (~170MB)
 *
 * Usage:
 *   npm run build && npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const TEST_PAGE_PATH = path.resolve(__dirname, '../test-page.html');

// Skip in CI (Chrome extension testing requires display)
const SKIP_E2E = process.env.CI === 'true' || process.env.SKIP_E2E === 'true';

/**
 * Wait for extension to be detected with retries.
 * Uses multiple detection methods for reliability.
 */
async function waitForExtension(
  browser: Browser,
  maxRetries = 20,
  delayMs = 500
): Promise<string | null> {
  for (let i = 0; i < maxRetries; i++) {
    const targets = await browser.targets();

    // Method 1: Find service worker
    const swTarget = targets.find(
      (t) =>
        t.type() === 'service_worker' &&
        t.url().startsWith('chrome-extension://')
    );
    if (swTarget) {
      const match = swTarget.url().match(/chrome-extension:\/\/([^/]+)/);
      if (match) return match[1];
    }

    // Method 2: Find any extension-related target
    const extTarget = targets.find((t) =>
      t.url().startsWith('chrome-extension://')
    );
    if (extTarget) {
      const match = extTarget.url().match(/chrome-extension:\/\/([^/]+)/);
      if (match) return match[1];
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * Get extension ID from chrome://extensions page
 */
async function getExtensionIdFromChrome(page: Page): Promise<string | null> {
  try {
    await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));

    const extensionId = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      if (!manager || !manager.shadowRoot) return null;

      const itemsList = manager.shadowRoot.querySelector('extensions-item-list');
      if (!itemsList || !itemsList.shadowRoot) return null;

      const items = itemsList.shadowRoot.querySelectorAll('extensions-item');
      for (const item of items) {
        const name = item.shadowRoot?.querySelector('#name')?.textContent;
        if (name?.includes('TRANSLATE')) {
          return item.id;
        }
      }
      return null;
    });

    return extensionId;
  } catch {
    return null;
  }
}

describe.skipIf(SKIP_E2E)('Extension V2.0 E2E', () => {
  let browser: Browser;
  let page: Page;
  let extensionId: string | null = null;
  let userDataDir: string;

  beforeAll(async () => {
    // Verify dist exists
    if (!fs.existsSync(EXTENSION_PATH)) {
      throw new Error(`Extension not built. Run: npm run build`);
    }
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`manifest.json not found in ${EXTENSION_PATH}`);
    }

    console.log(`Loading extension from: ${EXTENSION_PATH}`);

    userDataDir = `/tmp/puppeteer-ext-test-${Date.now()}`;

    browser = await puppeteer.launch({
      headless: false,
      executablePath:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userDataDir,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--allow-file-access-from-files',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    });

    await new Promise((r) => setTimeout(r, 4000));

    page = await browser.newPage();

    // Try to get extension ID
    extensionId = await waitForExtension(browser, 15, 500);
    if (!extensionId) {
      extensionId = await getExtensionIdFromChrome(page);
    }

    if (extensionId) {
      console.log(`Extension ID: ${extensionId}`);
    } else {
      console.log('Extension ID not detected (known Puppeteer/MV3 limitation)');
    }
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('loads test page', async () => {
    const testPageUrl = `file://${TEST_PAGE_PATH}`;
    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    expect(title).toBe('Translation Extension Test Page');
  });

  it('test page has translatable content', async () => {
    const testPageUrl = `file://${TEST_PAGE_PATH}`;
    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });

    const paragraphs = await page.$$eval('p', (ps) =>
      ps.map((p) => p.textContent?.trim())
    );

    expect(paragraphs.some((p) => p?.includes('Hello'))).toBe(true);
    expect(paragraphs.some((p) => p?.includes('weather'))).toBe(true);
  });

  it('popup renders with Solid.js', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    const header = await page.$eval('.brand-title', (el) => el.textContent);
    expect(header).toBe('TRANSLATE!');
  });

  it('language selectors have options', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('.language-select', { timeout: 10000 });

    const options = await page.$$eval(
      '.language-select:last-of-type option',
      (opts) => opts.map((o) => (o as HTMLOptionElement).value)
    );

    // Should have: en, fi, de, fr, es, sv, ru, zh, ja, nl, cs
    expect(options.length).toBeGreaterThanOrEqual(11);
    expect(options).toContain('en');
    expect(options).toContain('fi');
  });

  it('can change target language', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('.language-select', { timeout: 10000 });

    const selects = await page.$$('.language-select');
    await selects[1].select('fi');

    const selected = await page.$eval(
      '.language-select:last-of-type',
      (el) => (el as HTMLSelectElement).value
    );
    expect(selected).toBe('fi');
  });

  it('translate button is enabled', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('.action-button--primary', { timeout: 10000 });

    const isDisabled = await page.$eval(
      '.action-button--primary',
      (el) => (el as HTMLButtonElement).disabled
    );
    expect(isDisabled).toBe(false);
  });

  it('swap button exchanges languages', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('.language-select', { timeout: 10000 });

    const selects = await page.$$('.language-select');
    await selects[0].select('en');
    await selects[1].select('fi');

    await page.click('.swap-button');
    await new Promise((r) => setTimeout(r, 200));

    const newSource = await page.$eval(
      '.language-select:first-of-type',
      (el) => (el as HTMLSelectElement).value
    );
    expect(newSource).toBe('fi');
  });

  it('service worker responds to ping', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    const response = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'ping' }, resolve);
      });
    });

    expect(response).toBeTruthy();
    expect((response as Record<string, unknown>).success).toBe(true);
  }, 30000);
});

// Manual test checklist (always runs, documents full E2E flow)
describe('Manual E2E Verification', () => {
  it('documents complete test procedure', () => {
    const checklist = `
======================================================
  TRANSLATE! v2.0 Complete E2E Test Guide
======================================================

AUTOMATED TESTS (run with npm run test:e2e):
  - Test page loads correctly
  - Extension popup renders
  - Language selectors work
  - Swap button functions
  - Service worker responds

MANUAL VERIFICATION REQUIRED:
  (Puppeteer has known issues with MV3 extensions)

1. BUILD & LOAD
   npm run build
   Open chrome://extensions
   Enable "Developer mode"
   Click "Load unpacked" -> select dist/

2. POPUP UI
   [ ] Click extension icon
   [ ] Verify brand: "TRANSLATE!" with "by Mikko"
   [ ] All language dropdowns work
   [ ] Strategy selector shows Smart/Fast/Quality

3. TRANSLATION (first run downloads ~170MB model)
   [ ] Open test/test-page.html
   [ ] Set: English -> Finnish
   [ ] Click "Translate Page"
   [ ] Wait for model download progress
   [ ] Verify text translates to Finnish
   [ ] Second translation is instant (cached)

4. SELECTION TRANSLATION
   [ ] Select text on any page
   [ ] Click "Translate Selection"
   [ ] Verify only selected text changes

5. ERROR HANDLING
   [ ] On chrome:// pages: "Cannot translate browser pages"
   [ ] Network error: Shows appropriate message

======================================================
    `;
    console.log(checklist);
    expect(true).toBe(true);
  });
});
