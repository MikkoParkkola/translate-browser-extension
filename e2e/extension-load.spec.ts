import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '..', 'dist');

// Custom test fixture that launches Chromium with extension loaded
// using launchPersistentContext (required for MV3 extensions)
const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const BACKGROUND_MODE = process.env.BACKGROUND !== 'false';
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-component-update',
        ...(BACKGROUND_MODE ? [
          '--window-position=-32000,-32000',
          '--window-size=1280,720',
          '--disable-gpu',
          '--mute-audio',
        ] : []),
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // Wait for the service worker to be registered
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 30000 });
    }
    const url = sw.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (!match) {
      throw new Error(`Could not extract extension ID from: ${url}`);
    }
    await use(match[1]);
  },
});

test.describe('Extension Loading', () => {
  test('service worker registers and extension is active', async ({ extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(10);
    console.log(`Extension loaded with ID: ${extensionId}`);
  });

  test('popup page loads without errors', async ({ context, extensionId }) => {
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(popupUrl);
    await page.waitForLoadState('domcontentloaded');

    // Check that the popup rendered something meaningful
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(0);

    // No fatal errors in console (filter out expected noise)
    const fatalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('DevTools')
    );
    expect(fatalErrors).toHaveLength(0);

    await page.close();
  });

  test('chrome.storage API works in extension context', async ({ context, extensionId }) => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popupPage.waitForLoadState('domcontentloaded');

    // Verify extension storage is accessible (basic runtime check)
    const storageWorks = await popupPage.evaluate(async () => {
      try {
        await chrome.storage.local.set({ __test: true });
        const result = await chrome.storage.local.get('__test');
        await chrome.storage.local.remove('__test');
        return result.__test === true;
      } catch {
        return false;
      }
    });
    expect(storageWorks).toBe(true);

    await popupPage.close();
  });
});
