/**
 * Quick E2E Validation (Headed but Fast)
 *
 * Runs headed Chrome briefly to validate extension loading and CSP.
 * Closes automatically after tests complete.
 *
 * Run: npm run test:e2e:quick
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { findChromeForTesting, getExtensionId, delay, TIMEOUTS } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

// Chrome for Testing path (regular Chrome ignores --disable-extensions-except)
const CHROME_FOR_TESTING = findChromeForTesting();

interface ConsoleError {
  type: string;
  text: string;
  url?: string;
}

describe('Quick Extension Validation', () => {
  let browser: Browser;
  let page: Page;
  let extensionId: string | null = null;
  let userDataDir: string;
  const consoleErrors: ConsoleError[] = [];

  beforeAll(async () => {
    // Verify dist exists
    if (!fs.existsSync(EXTENSION_PATH)) {
      throw new Error('Extension not built. Run: npm run build');
    }

    if (!CHROME_FOR_TESTING) {
      throw new Error('Chrome for Testing not found. Run: npx puppeteer browsers install chrome@stable');
    }

    userDataDir = `/tmp/puppeteer-quick-${Date.now()}`;

    // Launch Chrome for Testing (regular Chrome ignores extension flags)
    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROME_FOR_TESTING,
      userDataDir,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=800,600',
        '--window-position=2000,1000', // Bottom right (less intrusive)
        '--disable-component-update',
        '--mute-audio',
        '--disable-infobars',
        '--no-first-run',
        '--disable-gpu',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    });

    // Wait for extension to load
    await delay(3000);

    // Get extension ID
    extensionId = await getExtensionId(browser);

    if (!extensionId) {
      throw new Error('Extension service worker not detected after 20s');
    }

    console.log(`Extension ID: ${extensionId}`);

    page = await browser.newPage();

    // Collect console errors
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') {
        consoleErrors.push({
          type: msg.type(),
          text: text,
          url: msg.location()?.url,
        });
        // Print CSP errors immediately
        if (text.includes('Content Security Policy') || text.includes('Refused to connect')) {
          console.error('\n!!! CSP ERROR:', text);
        }
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push({
        type: 'pageerror',
        text: err.message,
      });
      console.error('\n!!! PAGE ERROR:', err.message);
    });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('popup loads without errors', async () => {
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    // Check for UI elements
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    const title = await page.$eval('.brand-title', (el) => el.textContent);
    expect(title).toBe('TRANSLATE!');

    // Check for CSP errors
    const cspErrors = consoleErrors.filter(
      (e) => e.text.includes('Content Security Policy') || e.text.includes('Refused to connect')
    );
    expect(cspErrors, 'No CSP errors on popup').toHaveLength(0);
  });

  it('offscreen document loads without errors', async () => {
    const prevErrors = consoleErrors.length;

    const offscreenUrl = `chrome-extension://${extensionId}/src/offscreen/offscreen.html`;
    await page.goto(offscreenUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2000));

    // Check for new critical errors
    const newErrors = consoleErrors.slice(prevErrors);
    const criticalErrors = newErrors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes('SyntaxError') ||
        e.text.includes('ReferenceError') ||
        e.text.includes('TypeError')
    );

    expect(criticalErrors, 'No critical errors in offscreen').toHaveLength(0);
  });

  it('service worker responds to ping', async () => {
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    const response = await page.evaluate(() => {
      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Ping timeout')), 5000);
        chrome.runtime.sendMessage({ type: 'ping' }, (res) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(res);
        });
      });
    });

    expect(response).toBeTruthy();
    expect((response as { success: boolean }).success).toBe(true);
  });

  it('can request usage status', async () => {
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    const status = await page.evaluate(() => {
      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Status timeout')), 10000);
        chrome.runtime.sendMessage({ type: 'getUsage' }, (res) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(res);
        });
      });
    });

    expect(status).toBeTruthy();
    console.log('Usage status:', status);
  });

  it('translation request works (may trigger model download)', async () => {
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    const prevErrorCount = consoleErrors.length;

    // Request translation - use 'translate' message type (not 'translateText')
    console.log('Requesting translation (this may take 20-30s for first model download)...');
    const startTime = Date.now();
    const result = await page.evaluate(() => {
      return new Promise<unknown>((resolve) => {
        // 90 second timeout for model download
        const timeout = setTimeout(() => resolve({ timeout: true }), 90000);
        chrome.runtime.sendMessage(
          {
            type: 'translate',
            text: 'Hello world',
            sourceLang: 'en',
            targetLang: 'fi',
          },
          (res) => {
            clearTimeout(timeout);
            resolve(res || { error: chrome.runtime.lastError?.message || 'No response' });
          }
        );
      });
    });

    const duration = Date.now() - startTime;
    console.log(`Translation completed in ${duration}ms:`, result);

    // Verify translation succeeded
    const resultObj = result as { success?: boolean; result?: string; error?: string };
    if (!resultObj.success) {
      console.error('Translation failed:', resultObj.error);
    } else {
      console.log('Translated to:', resultObj.result);
    }

    // Check for CSP violations during translation
    const newErrors = consoleErrors.slice(prevErrorCount);
    const cspErrors = newErrors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes('Refused to connect') ||
        e.text.includes('violates the following')
    );

    if (cspErrors.length > 0) {
      console.error('\n=== CSP VIOLATIONS DURING TRANSLATION ===');
      cspErrors.forEach((e) => console.error(e.text));
      console.error('==========================================\n');
    }

    expect(cspErrors, 'No CSP violations during translation').toHaveLength(0);
    expect(resultObj.success, 'Translation should succeed').toBe(true);
  }, 180000); // 3 min for model download

  it('prints final error summary', () => {
    console.log('\n========== FINAL ERROR SUMMARY ==========');
    console.log(`Total errors collected: ${consoleErrors.length}`);

    if (consoleErrors.length > 0) {
      console.log('\nAll errors:');
      consoleErrors.forEach((e, i) => {
        console.log(`${i + 1}. [${e.type}] ${e.text.substring(0, 200)}`);
      });
    }

    const cspErrors = consoleErrors.filter(
      (e) => e.text.includes('Content Security Policy') || e.text.includes('Refused to connect')
    );

    console.log(`\nCSP violations: ${cspErrors.length}`);
    console.log('==========================================\n');

    // This test doesn't fail - it just reports
    expect(true).toBe(true);
  });
});
