import { expect, test } from '@playwright/test';

import {
  clearMockCache,
  gotoMockHarness,
  installCachedBatchTranslate,
  installLocalStorageCache,
  installLocalStorageConfig,
  loadMockConfig,
  registerMockProviders,
  saveMockConfig,
  translateBatch,
  translateBatchAndCaptureProviderCalls,
} from './mock-harness';

async function setupCacheHarness(page: import('@playwright/test').Page): Promise<void> {
  await installLocalStorageCache(page);
  await installCachedBatchTranslate(page);
}

test.describe('Mock harness cache and config', () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshot = await page.screenshot({
        path: testInfo.outputPath('failure.png'),
        fullPage: true,
      });
      await testInfo.attach('screenshot', { body: screenshot, contentType: 'image/png' });
    }
  });

  test('batch translations cache results and support provider change', async ({ page }) => {
    await gotoMockHarness(page);
    await setupCacheHarness(page);
    await registerMockProviders(page, [{ id: 'mock2', type: 'suffix', suffix: '-es' }]);

    const first = await translateBatch(page, {
      texts: ['hello'],
      source: 'en',
      target: 'fr',
      provider: 'mock',
    });
    expect(first.texts[0]).toBe('hello-fr');

    const second = await translateBatch(page, {
      texts: ['hello'],
      source: 'en',
      target: 'es',
      provider: 'mock2',
    });
    expect(second.texts[0]).toBe('hello-es');

    await translateBatch(page, {
      texts: ['cacheme'],
      source: 'en',
      target: 'es',
      provider: 'mock2',
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await setupCacheHarness(page);
    await registerMockProviders(page, [{ id: 'mock2', type: 'suffix', suffix: '-es' }]);

    const cached = await translateBatchAndCaptureProviderCalls(page, 'mock2', {
      texts: ['cacheme'],
      source: 'en',
      target: 'es',
      provider: 'mock2',
    });
    expect(cached.texts[0]).toBe('cacheme-es');
    expect(cached.calls).toBe(0);

    await clearMockCache(page);

    const cleared = await translateBatchAndCaptureProviderCalls(page, 'mock2', {
      texts: ['cacheme'],
      source: 'en',
      target: 'es',
      provider: 'mock2',
    });
    expect(cleared.texts[0]).toBe('cacheme-es');
    expect(cleared.calls).toBe(1);
  });

  test('persists settings across reloads', async ({ page }) => {
    await gotoMockHarness(page);
    await installLocalStorageConfig(page);

    await saveMockConfig(page, { providerOrder: ['mock', 'mock2'], debug: true });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await installLocalStorageConfig(page);

    const config = await loadMockConfig(page);
    expect(config.providerOrder).toEqual(['mock', 'mock2']);
    expect(config.debug).toBe(true);
  });
});
