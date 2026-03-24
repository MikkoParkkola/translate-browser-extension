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

import { test as base } from '@playwright/test';
import { test, expect, popupUrl, offscreenUrl } from './fixtures';
import path from 'path';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../dist');

interface ConsoleError {
  type: string;
  text: string;
  location?: string;
}

base.describe('Manifest CSP Validation', () => {
  base('manifest has correct CSP for HuggingFace CDNs', async () => {
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    expect(fs.existsSync(manifestPath), 'Manifest should exist').toBe(true);

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
      console.error('MISSING CSP DOMAINS:', missing);
    }

    expect(missing, 'All HuggingFace domains should be in CSP').toHaveLength(0);
  });
});

test.describe.configure({ mode: 'serial' });

test.describe('CSP & Model Loading', () => {
  test('extension context is available', async ({ context, extensionId }) => {
    expect(context).toBeTruthy();
    expect(extensionId).toBeTruthy();
    console.log(`Extension available: ${extensionId}`);
  });

  test('popup loads without CSP errors', async ({ context, extensionId }) => {
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

    await page.goto(popupUrl(extensionId));
    await page.waitForSelector('.popup-container', { timeout: 10_000 });
    await page.waitForTimeout(2_000);

    const cspErrors = errors.filter(
      (entry) =>
        entry.text.includes('Content Security Policy') ||
        entry.text.includes('CSP') ||
        entry.text.includes('Refused to connect')
    );

    if (cspErrors.length > 0) {
      console.log('CSP Errors found:');
      cspErrors.forEach((entry) => console.log(`  ${entry.text}`));
    }

    expect(cspErrors, 'No CSP errors should occur on popup load').toHaveLength(0);
    await page.close();
  });

  test('offscreen document loads without errors', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const errors: ConsoleError[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push({ type: msg.type(), text: msg.text() });
      }
    });

    await page.goto(offscreenUrl(extensionId));
    await page.waitForTimeout(3_000);

    const relevantErrors = errors.filter(
      (entry) =>
        entry.text.includes('Content Security Policy') ||
        entry.text.includes('SyntaxError') ||
        entry.text.includes('TypeError') ||
        entry.text.includes('ReferenceError')
    );

    if (relevantErrors.length > 0) {
      console.log('Offscreen document errors:');
      relevantErrors.forEach((entry) => console.log(`  ${entry.text}`));
    }

    expect(relevantErrors, 'No critical errors in offscreen document').toHaveLength(0);
    await page.close();
  });

  test('can ping service worker', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
    await page.waitForSelector('.popup-container', { timeout: 10_000 });

    const response = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Ping timeout')), 5_000);
        chrome.runtime.sendMessage({ type: 'ping' }, (result) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    });

    expect(response).toBeTruthy();
    expect((response as { success: boolean }).success).toBe(true);
    await page.close();
  });

  test('can read downloaded model inventory', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));
    await page.waitForSelector('.popup-container', { timeout: 10_000 });

    const status = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Downloaded models timeout')), 10_000);
        chrome.runtime.sendMessage({ type: 'getDownloadedModels' }, (result) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    });

    expect(status).toBeTruthy();
    const statusObj = status as { success?: boolean; models?: unknown[] };
    expect(statusObj.success).toBe(true);
    expect(Array.isArray(statusObj.models)).toBe(true);
    await page.close();
  });

  test('model download does not trigger CSP violations @slow', async ({ context, extensionId }) => {
    test.setTimeout(180_000);

    const page = await context.newPage();
    const errors: ConsoleError[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        errors.push({
          type: msg.type(),
          text,
          location: msg.location()?.url,
        });

        if (text.includes('Content Security Policy') || text.includes('Refused to connect')) {
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

    await page.goto(popupUrl(extensionId));
    await page.waitForSelector('.popup-container', { timeout: 10_000 });

    await page.locator('.language-select').first().selectOption('en');
    await page.locator('.language-select').last().selectOption('fi');

    console.log('Triggering model download...');
    const result = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'Timeout waiting for model' }), 120_000);

        chrome.runtime.sendMessage(
          {
            type: 'translate',
            text: 'Hello world',
            sourceLang: 'en',
            targetLang: 'fi',
            provider: 'opus-mt',
          },
          (response) => {
            clearTimeout(timeout);
            resolve(response || { error: chrome.runtime.lastError?.message || 'No response' });
          }
        );
      });
    });

    console.log('Translation result:', result);
    expect((result as { success?: boolean; result?: unknown }).success).toBe(true);
    expect(typeof (result as { result?: unknown }).result).toBe('string');

    const cspErrors = errors.filter(
      (entry) =>
        entry.text.includes('Content Security Policy') ||
        entry.text.includes('Refused to connect') ||
        entry.text.includes('violates the following')
    );

    if (cspErrors.length > 0) {
      console.log('\n=== CSP VIOLATIONS DETECTED ===');
      cspErrors.forEach((entry) => {
        console.log(`ERROR: ${entry.text}`);
        if (entry.location) console.log(`  at: ${entry.location}`);
      });
      console.log('================================\n');
    }

    expect(cspErrors, 'No CSP violations during model download').toHaveLength(0);
    await page.close();
  });
});

base.describe('Error Collection Summary', () => {
  base('prints any collected errors at end', async () => {
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
