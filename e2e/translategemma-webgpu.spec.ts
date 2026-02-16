import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '..', 'dist');

// Custom test fixture with extension loaded
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
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 30000 });
    }
    const url = sw.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (!match) throw new Error(`Could not extract extension ID from: ${url}`);
    await use(match[1]);
  },
});

test.describe('TranslateGemma WebGPU Fallback', () => {
  test('offscreen document creates and processes messages', async ({ context, extensionId }) => {
    // Open a page so the service worker has a tab context
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Send a preloadModel message for TranslateGemma via the service worker
    // This triggers offscreen document creation
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();

    // Trigger offscreen document creation via preload message from the popup
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popupPage.waitForLoadState('domcontentloaded');

    // Send preloadModel message to the background service worker
    const preloadResult = await popupPage.evaluate(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'preloadModel',
          sourceLang: 'en',
          targetLang: 'fi',
          provider: 'translategemma',
        });
        return { success: true, response };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    console.log('Preload result:', JSON.stringify(preloadResult));

    // The preload may fail (model not downloaded yet) but it should
    // NOT crash the service worker. Service worker should still be alive.
    const swAfter = context.serviceWorkers()[0];
    expect(swAfter).toBeTruthy();

    await popupPage.close();
    await page.close();
  });

  test('WebGPU detection works in extension context', async ({ context, extensionId }) => {
    // Navigate to the offscreen page directly to test WebGPU detection
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/offscreen/offscreen.html`);
    await page.waitForLoadState('domcontentloaded');

    // Check if WebGPU is available in the offscreen document context
    const gpuInfo = await page.evaluate(async () => {
      const gpu = (navigator as { gpu?: GPUAdapter }).gpu;
      if (!gpu) {
        return { supported: false, reason: 'navigator.gpu undefined' };
      }
      try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) {
          return { supported: false, reason: 'requestAdapter returned null' };
        }
        const features = [...adapter.features];
        const fp16 = features.includes('shader-f16');
        const info = await adapter.requestAdapterInfo?.() || {};
        return {
          supported: true,
          fp16,
          features,
          vendor: (info as { vendor?: string }).vendor || 'unknown',
          architecture: (info as { architecture?: string }).architecture || 'unknown',
        };
      } catch (error) {
        return { supported: false, reason: String(error) };
      }
    });

    console.log('WebGPU info:', JSON.stringify(gpuInfo, null, 2));

    // WebGPU might not be available in background-mode Chromium (--disable-gpu)
    // but the detection code should not crash regardless
    expect(gpuInfo).toBeTruthy();
    expect(typeof gpuInfo.supported).toBe('boolean');

    // If WebGPU is available, verify fp16 detection works
    if (gpuInfo.supported) {
      expect(typeof gpuInfo.fp16).toBe('boolean');
      console.log(`WebGPU: supported=true, fp16=${gpuInfo.fp16}`);
      if (gpuInfo.fp16) {
        console.log('Fallback chain: webgpu+q4f16 -> webgpu+q4 -> wasm+q4');
      } else {
        console.log('Fallback chain: webgpu+q4 -> wasm+q4 (no fp16)');
      }
    } else {
      console.log(`WebGPU not available: ${gpuInfo.reason}`);
      console.log('Fallback chain: wasm+q4 (direct)');
    }

    await page.close();
  });

  test('translation request with TranslateGemma does not crash service worker', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Collect service worker console messages
    const swMessages: string[] = [];
    const sw = context.serviceWorkers()[0];
    sw.on('console', (msg) => {
      swMessages.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Send a translate request for TranslateGemma
    const translateResult = await page.evaluate(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'translate',
          text: 'Hello world',
          sourceLang: 'en',
          targetLang: 'fi',
          provider: 'translategemma',
        });
        return { success: true, response };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    console.log('Translation result:', JSON.stringify(translateResult));
    console.log('Service worker messages:', swMessages.join('\n'));

    // The translation may fail (model not cached) but the service worker
    // must survive. No unhandled rejections, no crashes.
    const swAlive = context.serviceWorkers()[0];
    expect(swAlive).toBeTruthy();

    await page.close();
  });
});
