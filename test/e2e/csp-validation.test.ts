/**
 * CSP Validation E2E Tests (Puppeteer)
 *
 * Tests that the extension's CSP allows all required HuggingFace CDN domains
 * and that model loading works without CSP violations.
 *
 * Run: npm run test:e2e:csp
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getExtensionId, getExtensionIdFromChrome, delay, TIMEOUTS, findChromeForTesting } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

// Chrome for Testing (regular Chrome ignores extension loading flags)
const CHROME_FOR_TESTING = findChromeForTesting();

interface ConsoleError {
  type: string;
  text: string;
  url?: string;
}

describe('CSP Validation', () => {
  let browser: Browser;
  let page: Page;
  let extensionId: string | null = null;
  let userDataDir: string;
  const consoleErrors: ConsoleError[] = [];

  beforeAll(async () => {
    // Verify dist exists
    if (!fs.existsSync(EXTENSION_PATH)) {
      console.error('Extension not built. Run: npm run build');
      return;
    }

    if (!CHROME_FOR_TESTING) {
      console.error('Chrome for Testing not found. Run: npx puppeteer browsers install chrome@stable');
      return;
    }

    userDataDir = `/tmp/puppeteer-csp-${Date.now()}`;

    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROME_FOR_TESTING,
      userDataDir,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Background mode - window off-screen
        '--window-position=2000,1000',
        '--window-size=800,600',
        '--disable-gpu',
        '--mute-audio',
        '--disable-component-update',
        '--no-first-run',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    });

    await delay(3000);
    page = await browser.newPage();

    // Collect console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          url: msg.location()?.url,
        });
      }
    });

    // Get extension ID
    extensionId = await getExtensionId(browser);

    if (extensionId) {
      console.log(`Extension ID: ${extensionId}`);
    } else {
      console.log('Extension ID not detected - will run limited tests');
    }
  }, TIMEOUTS.extensionLoad * 2);

  afterAll(async () => {
    if (browser) await browser.close();
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('manifest has all required HuggingFace CDN domains', () => {
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const csp = manifest.content_security_policy?.extension_pages || '';

    console.log('Current CSP:', csp);

    const requiredDomains = [
      'cdn-lfs.huggingface.co',
      'cdn-lfs-us-1.hf.co',
      'cdn-lfs-eu-1.hf.co',
      'cdn-lfs-ap-1.hf.co',
      'huggingface.co',
      'hf.co',
      '*.xethub.hf.co',
      'cas-bridge.xethub.hf.co',
    ];

    const missing: string[] = [];
    for (const domain of requiredDomains) {
      if (!csp.includes(domain)) {
        missing.push(domain);
      }
    }

    if (missing.length > 0) {
      console.error('MISSING DOMAINS:', missing);
    }

    expect(missing).toHaveLength(0);
  });

  it('popup loads without CSP errors', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    consoleErrors.length = 0; // Clear previous errors

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await delay(2000);

    const cspErrors = consoleErrors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes('CSP') ||
        e.text.includes("Refused to connect")
    );

    if (cspErrors.length > 0) {
      console.log('\n=== CSP ERRORS ON POPUP ===');
      cspErrors.forEach((e) => console.log(e.text));
      console.log('===========================\n');
    }

    expect(cspErrors).toHaveLength(0);
  });

  it('offscreen page loads without CSP errors', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    consoleErrors.length = 0;

    const offscreenUrl = `chrome-extension://${extensionId}/src/offscreen/offscreen.html`;
    await page.goto(offscreenUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await delay(3000);

    const cspErrors = consoleErrors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes('CSP') ||
        e.text.includes("Refused to connect")
    );

    if (cspErrors.length > 0) {
      console.log('\n=== CSP ERRORS ON OFFSCREEN ===');
      cspErrors.forEach((e) => console.log(e.text));
      console.log('===============================\n');
    }

    expect(cspErrors).toHaveLength(0);
  });

  it('service worker responds to ping', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    const response = await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        chrome.runtime.sendMessage({ type: 'ping' }, (res) => {
          clearTimeout(timeout);
          resolve(res);
        });
      });
    });

    expect(response).toBeTruthy();
    expect((response as { success: boolean }).success).toBe(true);
  });

  it('prints error summary', () => {
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Total console errors collected: ${consoleErrors.length}`);

    const cspErrors = consoleErrors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes("Refused to connect")
    );

    if (cspErrors.length > 0) {
      console.log('\nCSP VIOLATIONS:');
      cspErrors.forEach((e) => console.log(`  - ${e.text}`));
    } else {
      console.log('\nNo CSP violations detected');
    }
    console.log('====================\n');
  });
});

// Model loading test (separate describe for timeout)
describe('Model Loading', () => {
  let browser: Browser;
  let page: Page;
  let extensionId: string | null = null;
  let userDataDir: string;
  const consoleErrors: ConsoleError[] = [];

  beforeAll(async () => {
    if (!fs.existsSync(EXTENSION_PATH) || !CHROME_FOR_TESTING) {
      return;
    }

    userDataDir = `/tmp/puppeteer-model-${Date.now()}`;

    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROME_FOR_TESTING,
      userDataDir,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-position=2000,1000',
        '--window-size=800,600',
        '--disable-gpu',
        '--mute-audio',
        '--no-first-run',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    });

    await delay(3000);
    page = await browser.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          url: msg.location()?.url,
        });
        // Log CSP errors immediately
        if (msg.text().includes('Content Security Policy')) {
          console.error('CSP ERROR:', msg.text());
        }
      }
    });

    extensionId = await getExtensionId(browser);
  }, TIMEOUTS.extensionLoad * 2);

  afterAll(async () => {
    if (browser) await browser.close();
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('translation request does not cause CSP violations', async () => {
    if (!extensionId) {
      console.log('SKIP: Extension ID not available');
      return;
    }

    consoleErrors.length = 0;

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    // Wait for UI to be ready
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    // Trigger a translation request (this may start model download)
    console.log('Triggering translation...');
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ timeout: true }), 60000);
        chrome.runtime.sendMessage(
          {
            type: 'translateText',
            text: 'Hello',
            source: 'en',
            target: 'fi',
          },
          (res) => {
            clearTimeout(timeout);
            resolve(res || { error: 'No response' });
          }
        );
      });
    });

    console.log('Translation result:', result);

    // Check for CSP violations
    const cspErrors = consoleErrors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes("Refused to connect") ||
        e.text.includes("violates the following")
    );

    if (cspErrors.length > 0) {
      console.log('\n=== CSP VIOLATIONS DURING TRANSLATION ===');
      cspErrors.forEach((e) => console.log(e.text));
      console.log('=========================================\n');
    }

    expect(cspErrors).toHaveLength(0);
  }, 120000); // 2 min timeout for model download
});
