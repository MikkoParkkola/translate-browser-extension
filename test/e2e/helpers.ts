/**
 * E2E Test Helpers
 *
 * Utilities for Chrome extension testing with Puppeteer.
 * Handles extension ID discovery, popup navigation, and element waiting.
 *
 * IMPORTANT: Uses Chrome for Testing, not regular Chrome.
 * Regular Chrome ignores --disable-extensions-except for security.
 */

import { Browser, Page } from 'puppeteer';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Find Chrome for Testing executable.
 * Puppeteer downloads this to ~/.cache/puppeteer/chrome/
 */
export function findChromeForTesting(): string | undefined {
  const cacheDir = join(homedir(), '.cache', 'puppeteer', 'chrome');

  // Common paths for Chrome for Testing on macOS
  const possiblePaths = [
    // Specific version we know exists
    join(cacheDir, 'mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    // Try to find any version
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Try to find any Chrome for Testing in cache
  try {
    const { execSync } = require('child_process');
    const result = execSync(`find "${cacheDir}" -name "Google Chrome for Testing" -type f 2>/dev/null | head -1`, { encoding: 'utf-8' });
    const found = result.trim();
    if (found && existsSync(found)) {
      return found;
    }
  } catch {
    // Ignore errors
  }

  return undefined;
}

/**
 * Default timeouts for E2E operations
 */
export const TIMEOUTS = {
  element: 10000,
  navigation: 15000,
  extensionLoad: 30000,
} as const;

/**
 * Get extension ID from browser targets (service worker or extension pages).
 *
 * Tries multiple detection methods:
 * 1. Service worker target (MV3)
 * 2. Any chrome-extension:// target
 * 3. Background page (MV2/hybrid)
 *
 * @param browser - Puppeteer Browser instance
 * @param maxRetries - Number of retry attempts (default: 40)
 * @param delayMs - Delay between retries in ms (default: 500)
 * @returns Extension ID or null if not found
 */
export async function getExtensionId(
  browser: Browser,
  maxRetries = 40,
  delayMs = 500
): Promise<string | null> {
  for (let i = 0; i < maxRetries; i++) {
    const targets = await browser.targets();

    // Method 1: Find service worker (MV3)
    const swTarget = targets.find(
      (t) =>
        t.type() === 'service_worker' &&
        t.url().startsWith('chrome-extension://')
    );
    if (swTarget) {
      const match = swTarget.url().match(/chrome-extension:\/\/([^/]+)/);
      if (match) return match[1];
    }

    // Method 2: Find background page (some MV3 extensions register this)
    const bgTarget = targets.find(
      (t) =>
        t.type() === 'background_page' &&
        t.url().startsWith('chrome-extension://')
    );
    if (bgTarget) {
      const match = bgTarget.url().match(/chrome-extension:\/\/([^/]+)/);
      if (match) return match[1];
    }

    // Method 3: Find any extension-related target (popup, options, etc.)
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
 * Get extension ID by querying chrome://extensions page.
 * Fallback method when service worker detection fails.
 *
 * @param page - Puppeteer Page instance
 * @param extensionName - Partial name to match (default: 'TRANSLATE')
 * @returns Extension ID or null if not found
 */
export async function getExtensionIdFromChrome(
  page: Page,
  extensionName = 'TRANSLATE'
): Promise<string | null> {
  try {
    await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));

    const extensionId = await page.evaluate((name: string) => {
      const manager = document.querySelector('extensions-manager');
      if (!manager || !manager.shadowRoot) return null;

      const itemsList = manager.shadowRoot.querySelector('extensions-item-list');
      if (!itemsList || !itemsList.shadowRoot) return null;

      const items = itemsList.shadowRoot.querySelectorAll('extensions-item');
      for (const item of items) {
        const itemName = item.shadowRoot?.querySelector('#name')?.textContent;
        if (itemName?.includes(name)) {
          return item.id;
        }
      }
      return null;
    }, extensionName);

    return extensionId;
  } catch {
    return null;
  }
}

/**
 * Navigate to extension popup page.
 *
 * @param page - Puppeteer Page instance
 * @param extensionId - Extension ID
 * @param popupPath - Path to popup HTML (default: 'src/popup/index.html')
 * @returns Promise that resolves when popup loads
 */
export async function openPopup(
  page: Page,
  extensionId: string,
  popupPath = 'src/popup/index.html'
): Promise<void> {
  const popupUrl = `chrome-extension://${extensionId}/${popupPath}`;
  await page.goto(popupUrl, {
    waitUntil: 'networkidle0',
    timeout: TIMEOUTS.navigation,
  });
}

/**
 * Wait for an element to appear on the page.
 *
 * @param page - Puppeteer Page instance
 * @param selector - CSS selector
 * @param timeout - Timeout in ms (default: 10000)
 * @returns Promise that resolves when element is found
 */
export async function waitForElement(
  page: Page,
  selector: string,
  timeout = TIMEOUTS.element
): Promise<void> {
  await page.waitForSelector(selector, { timeout });
}

/**
 * Wait for element and get its text content.
 *
 * @param page - Puppeteer Page instance
 * @param selector - CSS selector
 * @param timeout - Timeout in ms
 * @returns Text content of the element
 */
export async function getElementText(
  page: Page,
  selector: string,
  timeout = TIMEOUTS.element
): Promise<string | null> {
  await waitForElement(page, selector, timeout);
  return page.$eval(selector, (el) => el.textContent);
}

/**
 * Check if extension should be skipped (CI environment or explicit flag).
 *
 * @returns true if E2E tests should be skipped
 */
export function shouldSkipE2E(): boolean {
  return process.env.CI === 'true' || process.env.SKIP_E2E === 'true';
}

/**
 * Create a delay promise.
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
