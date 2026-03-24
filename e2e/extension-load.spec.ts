import { test, expect, popupUrl } from './fixtures';

test.describe('Extension Loading', () => {
  test('service worker registers and extension is active', async ({ extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(10);
    console.log(`Extension loaded with ID: ${extensionId}`);
  });

  test('popup page loads without errors', async ({ context, extensionId }) => {
    const popupPageUrl = popupUrl(extensionId);

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(popupPageUrl);
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
    await popupPage.goto(popupUrl(extensionId));
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
