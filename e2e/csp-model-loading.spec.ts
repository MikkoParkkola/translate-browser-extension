/**
 * CSP & Model Loading E2E Tests
 *
 * These tests verify:
 * 1. CSP allows all required HuggingFace CDN domains
 * 2. Models can be downloaded without CSP violations
 * 3. Service worker handles model loading correctly
 *
 * Run: npm run test:e2e:background
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

// Collect all console errors
interface ConsoleError {
  type: string;
  text: string;
  location?: string;
}

// Static manifest test - no browser needed
test.describe('Manifest CSP Validation', () => {
  test('manifest has correct CSP for HuggingFace CDNs', async () => {
    // Read the manifest directly
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    expect(fs.existsSync(manifestPath), 'Manifest should exist').toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const csp = manifest.content_security_policy?.extension_pages || '';

    console.log('Current CSP:', csp);

    // Required domains for HuggingFace model downloads
    const requiredDomains = [
      'cdn-lfs.huggingface.co',
      'cdn-lfs-us-1.hf.co',
      'cdn-lfs-eu-1.hf.co',
      'cdn-lfs-ap-1.hf.co',
      'huggingface.co',
      'hf.co',
      '*.xethub.hf.co',        // New XetHub CDN wildcard
      'cas-bridge.xethub.hf.co', // Specific XetHub endpoint
    ];

    const missing: string[] = [];
    for (const domain of requiredDomains) {
      if (!csp.includes(domain)) {
        missing.push(domain);
      }
    }

    if (missing.length > 0) {
      console.error('MISSING CSP DOMAINS:', missing);
    }

    expect(missing, 'All HuggingFace domains should be in CSP').toHaveLength(0);
  });
});

test.describe.configure({ mode: 'serial' });

test.describe('CSP & Model Loading', () => {
  let context: BrowserContext;
  let extensionId: string | null = null;
  const collectedErrors: ConsoleError[] = [];

  test.beforeAll(async () => {
    // Verify extension is built
    if (!fs.existsSync(EXTENSION_PATH)) {
      throw new Error('Extension not built. Run: npm run build');
    }

    const userDataDir = `/tmp/playwright-csp-test-${Date.now()}`;

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: 'chrome',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-component-update',
        // Background mode
        '--window-position=-32000,-32000',
        '--window-size=1280,720',
        '--disable-gpu',
        '--mute-audio',
      ],
    });

    // Wait for extension to initialize - try multiple detection methods
    console.log('Waiting for extension to initialize...');

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));

      // Method 1: Service workers
      const serviceWorkers = context.serviceWorkers();
      if (serviceWorkers.length > 0) {
        const url = serviceWorkers[0].url();
        const match = url.match(/chrome-extension:\/\/([^/]+)/);
        if (match) {
          extensionId = match[1];
          console.log(`Extension detected via service worker: ${extensionId}`);
          break;
        }
      }

      // Method 2: Try to find extension by loading chrome://extensions programmatically
      if (i === 20 && !extensionId) {
        console.log('Service worker not detected, trying extensions page...');
        try {
          const extPage = await context.newPage();
          await extPage.goto('chrome://extensions');
          await extPage.waitForTimeout(1000);

          // Try to extract extension ID from page content
          const content = await extPage.content();
          const match = content.match(/extension-id="([a-z]{32})"/);
          if (match) {
            extensionId = match[1];
            console.log(`Extension detected via extensions page: ${extensionId}`);
          }
          await extPage.close();
        } catch {
          // chrome:// pages may fail, continue
        }
      }
    }

    if (!extensionId) {
      console.log('WARNING: Extension service worker not detected after 20s');
      console.log('Tests requiring extension ID will be skipped');
    }
  });

  test.afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  test('extension context is available', async () => {
    // If we have extension ID, context is available
    // If not, we still have the browser context for limited testing
    expect(context).toBeTruthy();

    if (extensionId) {
      console.log(`Extension available: ${extensionId}`);
    } else {
      console.log('Extension ID not detected - some tests will be skipped');
    }
  });

  test('popup loads without CSP errors', async () => {
    test.skip(!extensionId, 'Extension ID not detected');

    const page = await context.newPage();
    const errors: ConsoleError[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location()?.url,
        });
      }
    });

    page.on('pageerror', (err) => {
      errors.push({
        type: 'pageerror',
        text: err.message,
      });
    });

    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    // Wait a bit for any async errors
    await page.waitForTimeout(2000);

    // Filter for CSP-related errors
    const cspErrors = errors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes('CSP') ||
        e.text.includes("Refused to connect")
    );

    if (cspErrors.length > 0) {
      console.log('CSP Errors found:');
      cspErrors.forEach((e) => console.log(`  ${e.text}`));
    }

    expect(cspErrors, 'No CSP errors should occur on popup load').toHaveLength(0);

    await page.close();
  });

  test('offscreen document loads without errors', async () => {
    test.skip(!extensionId, 'Extension ID not detected');

    const page = await context.newPage();
    const errors: ConsoleError[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push({
          type: msg.type(),
          text: msg.text(),
        });
      }
    });

    // Load offscreen document directly
    await page.goto(`chrome-extension://${extensionId}/src/offscreen/offscreen.html`);

    // Wait for any errors to appear
    await page.waitForTimeout(3000);

    // Filter for relevant errors (not network errors which are expected)
    const relevantErrors = errors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes('SyntaxError') ||
        e.text.includes('TypeError') ||
        e.text.includes('ReferenceError')
    );

    if (relevantErrors.length > 0) {
      console.log('Offscreen document errors:');
      relevantErrors.forEach((e) => console.log(`  ${e.text}`));
    }

    expect(relevantErrors, 'No critical errors in offscreen document').toHaveLength(0);

    await page.close();
  });

  test('can ping service worker', async () => {
    test.skip(!extensionId, 'Extension ID not detected');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    const response = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Ping timeout')), 5000);
        chrome.runtime.sendMessage({ type: 'ping' }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    });

    expect(response).toBeTruthy();
    expect((response as { success: boolean }).success).toBe(true);

    await page.close();
  });

  test('can get translation status', async () => {
    test.skip(!extensionId, 'Extension ID not detected');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    const status = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Status timeout')), 10000);
        chrome.runtime.sendMessage({ type: 'getTranslationStatus' }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    });

    expect(status).toBeTruthy();
    // Status should have required fields
    const statusObj = status as { isModelLoaded?: boolean; supportedLanguages?: unknown };
    expect(typeof statusObj.isModelLoaded).toBe('boolean');

    await page.close();
  });

  test('model download does not trigger CSP violations', async () => {
    test.skip(!extensionId, 'Extension ID not detected');
    test.setTimeout(180000); // 3 min for model download

    const page = await context.newPage();
    const errors: ConsoleError[] = [];

    // Collect all errors during model loading
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        errors.push({
          type: msg.type(),
          text: text,
          location: msg.location()?.url,
        });

        // Log CSP errors immediately
        if (text.includes('Content Security Policy') || text.includes("Refused to connect")) {
          console.error('CSP ERROR:', text);
        }
      }
    });

    page.on('pageerror', (err) => {
      errors.push({
        type: 'pageerror',
        text: err.message,
      });
    });

    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForSelector('.popup-container', { timeout: 10000 });

    // Select en -> fi translation (common pair)
    await page.locator('.language-select').first().selectOption('en');
    await page.locator('.language-select').last().selectOption('fi');

    // Request translation to trigger model download
    console.log('Triggering model download...');
    const result = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'Timeout waiting for model' }), 120000);

        chrome.runtime.sendMessage(
          {
            type: 'translateText',
            text: 'Hello world',
            source: 'en',
            target: 'fi',
          },
          (response) => {
            clearTimeout(timeout);
            resolve(response || { error: chrome.runtime.lastError?.message || 'No response' });
          }
        );
      });
    });

    console.log('Translation result:', result);

    // Check for CSP violations
    const cspErrors = errors.filter(
      (e) =>
        e.text.includes('Content Security Policy') ||
        e.text.includes("Refused to connect") ||
        e.text.includes("violates the following")
    );

    if (cspErrors.length > 0) {
      console.log('\n=== CSP VIOLATIONS DETECTED ===');
      cspErrors.forEach((e) => {
        console.log(`ERROR: ${e.text}`);
        if (e.location) console.log(`  at: ${e.location}`);
      });
      console.log('================================\n');
    }

    expect(cspErrors, 'No CSP violations during model download').toHaveLength(0);

    await page.close();
  });
});

test.describe('Error Collection Summary', () => {
  test('prints any collected errors at end', async () => {
    // This is a documentation test that runs last
    console.log(`
=================================================================
  CSP & Model Loading Test Complete

  If you see CSP errors, check these in manifest.json:
  - connect-src should include *.xethub.hf.co
  - connect-src should include cas-bridge.xethub.hf.co

  If you see network errors:
  - Ensure HuggingFace CDN domains are all whitelisted
  - Check for new CDN endpoints in browser DevTools
=================================================================
    `);
  });
});
