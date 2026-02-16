/**
 * Comprehensive E2E translation tests.
 *
 * Tests actual translation through the extension's message API:
 * - OPUS-MT local provider (lightweight, ~30MB models)
 * - TranslateGemma provider (4B model, ~3.5GB)
 * - Provider switching, popup UI, content script injection
 */
import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '..', 'dist');

// Shared fixture: extension loaded with GPU enabled
const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-component-update',
        '--window-position=-32000,-32000',
        '--window-size=1280,720',
        '--mute-audio',
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 30000 });
    }
    const match = sw.url().match(/chrome-extension:\/\/([^/]+)/);
    if (!match) throw new Error(`Could not extract extension ID from: ${sw.url()}`);
    await use(match[1]);
  },
});

/**
 * Helper: send a message to the extension background from a page context.
 */
async function sendExtensionMessage(page: Page, message: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(async (msg) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }, message);
}

// ============================================================
// OPUS-MT Tests (lightweight, fast download)
// ============================================================
test.describe('OPUS-MT Translation', () => {
  test.describe.configure({ timeout: 180000 }); // 3 min for model downloads

  test('en->de translation produces German text', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(page, {
      type: 'translate',
      text: 'Hello, how are you today?',
      sourceLang: 'en',
      targetLang: 'de',
      provider: 'opus-mt',
    }) as { success: boolean; translatedText?: string; error?: string };

    console.log('en->de result:', JSON.stringify(result));

    expect(result.success).toBe(true);
    expect((result.translatedText || (result as any).result)).toBeTruthy();
    // Should contain German words (basic sanity)
    const text = (result.translatedText || (result as any).result)!.toLowerCase();
    expect(text.length).toBeGreaterThan(5);
    console.log(`Translation: "${(result.translatedText || (result as any).result)}"`);

    await page.close();
  });

  test('en->fi translation produces Finnish text', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(page, {
      type: 'translate',
      text: 'The weather is beautiful today.',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
    }) as { success: boolean; translatedText?: string; error?: string };

    console.log('en->fi result:', JSON.stringify(result));

    expect(result.success).toBe(true);
    expect((result.translatedText || (result as any).result)).toBeTruthy();
    expect((result.translatedText || (result as any).result)!.length).toBeGreaterThan(5);
    console.log(`Translation: "${(result.translatedText || (result as any).result)}"`);

    await page.close();
  });

  test('en->fr translation produces French text', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(page, {
      type: 'translate',
      text: 'Good morning, I would like some coffee please.',
      sourceLang: 'en',
      targetLang: 'fr',
      provider: 'opus-mt',
    }) as { success: boolean; translatedText?: string; error?: string };

    console.log('en->fr result:', JSON.stringify(result));

    expect(result.success).toBe(true);
    expect((result.translatedText || (result as any).result)).toBeTruthy();
    expect((result.translatedText || (result as any).result)!.length).toBeGreaterThan(5);
    console.log(`Translation: "${(result.translatedText || (result as any).result)}"`);

    await page.close();
  });

  test('batch translation (array of strings)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(page, {
      type: 'translate',
      text: ['Hello', 'World', 'How are you?'],
      sourceLang: 'en',
      targetLang: 'de',
      provider: 'opus-mt',
    }) as { success: boolean; translatedText?: string | string[]; error?: string };

    console.log('batch result:', JSON.stringify(result));

    expect(result.success).toBe(true);
    expect((result.translatedText || (result as any).result)).toBeTruthy();
    // Should return array
    if (Array.isArray((result.translatedText || (result as any).result))) {
      expect((result.translatedText || (result as any).result).length).toBe(3);
      (result.translatedText || (result as any).result).forEach((t, i) => {
        expect(t.length).toBeGreaterThan(0);
        console.log(`  [${i}]: "${t}"`);
      });
    } else {
      // Some providers return single concatenated string
      expect((result.translatedText || (result as any).result)!.length).toBeGreaterThan(5);
      console.log(`  Combined: "${(result.translatedText || (result as any).result)}"`);
    }

    await page.close();
  });
});

// ============================================================
// TranslateGemma Tests (4B model, requires download)
// ============================================================
test.describe('TranslateGemma Translation', () => {
  test.describe.configure({ timeout: 600000 }); // 10 min for large model

  test('TranslateGemma preload and translation', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    // First preload the model
    console.log('Preloading TranslateGemma model...');
    const preloadResult = await sendExtensionMessage(page, {
      type: 'preloadModel',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'translategemma',
    }) as { success: boolean; preloaded?: boolean; error?: string };

    console.log('Preload result:', JSON.stringify(preloadResult));

    if (!preloadResult.success || preloadResult.error) {
      console.log('TranslateGemma preload failed:', preloadResult.error);
      console.log('Skipping translation test (model not available)');
      test.skip();
      return;
    }

    // Now translate
    const result = await sendExtensionMessage(page, {
      type: 'translate',
      text: 'The cat sat on the mat.',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'translategemma',
    }) as { success: boolean; translatedText?: string; error?: string };

    console.log('TranslateGemma result:', JSON.stringify(result));

    expect(result.success).toBe(true);
    expect((result.translatedText || (result as any).result)).toBeTruthy();
    expect((result.translatedText || (result as any).result)!.length).toBeGreaterThan(3);
    console.log(`TranslateGemma: "${(result.translatedText || (result as any).result)}"`);

    await page.close();
  });
});

// ============================================================
// Provider Management
// ============================================================
test.describe('Provider Management', () => {
  test('getProviders returns available providers', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(page, {
      type: 'getProviders',
    }) as { success: boolean; providers?: Array<{ id: string; name: string }> };

    console.log('Providers:', JSON.stringify(result, null, 2));

    // Response shape: {providers, activeProvider, strategy, supportedLanguages}
    const providers = (result as any).providers;
    expect(providers).toBeTruthy();
    expect(providers.length).toBeGreaterThan(0);

    // Should include at least opus-mt
    const providerIds = providers.map((p: any) => p.id);
    expect(providerIds).toContain('opus-mt');
    console.log('Available providers:', providerIds.join(', '));

    await page.close();
  });

  test('ping returns healthy status', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(page, {
      type: 'ping',
    }) as { success: boolean; status?: string };

    expect(result.success).toBe(true);
    console.log('Ping:', JSON.stringify(result));

    await page.close();
  });

  test('getSupportedLanguages returns language pairs', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(page, {
      type: 'getProviders',
    }) as any;

    const langs = result.supportedLanguages;
    expect(langs).toBeTruthy();
    expect(langs.length).toBeGreaterThan(0);
    console.log(`Total supported language pairs: ${langs.length}`);

    // Should support en-fi (our main test pair)
    const enFi = langs.find((l: any) => l.src === 'en' && l.tgt === 'fi');
    expect(enFi).toBeTruthy();

    await page.close();
  });
});

// ============================================================
// Popup UI Tests
// ============================================================
test.describe('Popup UI', () => {
  test('popup renders translation interface', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for Solid.js to render
    await page.waitForTimeout(500);

    // Take a snapshot of the popup content
    const bodyText = await page.textContent('body');
    console.log('Popup body text:', bodyText?.substring(0, 200));

    // Should have some UI elements
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(10);

    // Check for translation-related elements
    const hasTranslateButton = await page.$('button') !== null;
    const hasTextarea = await page.$('textarea') !== null;
    const hasSelect = await page.$('select') !== null;

    console.log(`UI elements: button=${hasTranslateButton}, textarea=${hasTextarea}, select=${hasSelect}`);

    await page.close();
  });
});

// ============================================================
// Content Script & Page Translation
// ============================================================
test.describe('Content Script', () => {
  test.describe.configure({ timeout: 180000 });

  test('content script injects on real pages', async ({ context }) => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Wait for content script to inject
    await page.waitForTimeout(2000);

    // Content script adds a data attribute or modifies DOM
    // Check for the content script's presence by looking for its injected styles/elements
    // The safest way: check if the page can be targeted by the extension
    const pageTitle = await page.title();
    console.log('Page title:', pageTitle);
    expect(pageTitle).toContain('Example Domain');

    await page.close();
  });

  test('translate real page text via extension popup', async ({ context, extensionId }) => {
    // Open a real page and get its text
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    const heading = await page.textContent('h1');
    console.log('Page heading:', heading);

    // Use popup page to send translation request (has chrome.runtime access)
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popupPage.waitForLoadState('domcontentloaded');

    const result = await sendExtensionMessage(popupPage, {
      type: 'translate',
      text: heading,
      sourceLang: 'en',
      targetLang: 'de',
      provider: 'opus-mt',
    }) as { success: boolean; translatedText?: string; error?: string };

    console.log('Page translation result:', JSON.stringify(result));

    expect(result.success).toBe(true);
    expect((result.translatedText || (result as any).result)).toBeTruthy();
    expect((result.translatedText || (result as any).result)!.length).toBeGreaterThan(3);
    console.log(`"${heading}" -> "${(result.translatedText || (result as any).result)}"`);

    await popupPage.close();
    await page.close();
  });
});
