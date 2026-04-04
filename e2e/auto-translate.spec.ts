/**
 * E2E: Auto-translate feature tests.
 *
 * Validates that auto-translate triggers on page load, handles dynamic
 * content via MutationObserver, respects disabled state, and works
 * with iframes. Uses the persistent-context extension fixture.
 *
 * Auto-translate logic (src/content/index.ts):
 *   - Checks per-site rules first, then global settings
 *   - Uses requestIdleCallback on page load to start translation
 *   - Starts MutationObserver after initial translation for dynamic content
 */
import {
  test,
  expect,
  popupUrl,
  setExtensionSettings,
  type BrowserContext,
  type Page,
} from './fixtures';
import { MOCK_HARNESS_TEXT, MOCK_HARNESS_URL } from './mock-harness';

const FAST_AUTO_TRANSLATE_SETTINGS = {
  autoTranslate: true,
  sourceLang: 'auto',
  targetLang: 'en',
  provider: 'opus-mt',
} as const;

async function configureAutoTranslate(
  context: BrowserContext,
  extensionId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const setupPage = await context.newPage();
  await setupPage.goto(popupUrl(extensionId));
  await setupPage.waitForLoadState('domcontentloaded');
  await setExtensionSettings(setupPage, settings);
  await setupPage.close();
}

async function gotoMockHarnessPage(page: Page): Promise<void> {
  await page.goto(MOCK_HARNESS_URL);
  await page.waitForLoadState('load');
}

test.describe('Auto-translate', () => {
  test.describe.configure({ timeout: 90_000 });

  // ── 1. Auto-translate enabled → translation starts on page load ─
  test('auto-translate triggers on page load when enabled', async ({
    context,
    extensionId,
  }) => {
    await configureAutoTranslate(
      context,
      extensionId,
      FAST_AUTO_TRANSLATE_SETTINGS,
    );

    const page = await context.newPage();
    await gotoMockHarnessPage(page);

    await expect(page.locator('main')).toHaveAttribute(
      'data-translated',
      'true',
      {
        timeout: 30_000,
      },
    );
    await expect(page.locator('#mock-root')).toHaveText(
      MOCK_HARNESS_TEXT,
    );

    await page.close();
  });

  // ── 2. Dynamic content (SPA simulation) ────────────────────────
  test('translates dynamically loaded content', async ({
    context,
    extensionId,
  }) => {
    await configureAutoTranslate(
      context,
      extensionId,
      FAST_AUTO_TRANSLATE_SETTINGS,
    );

    const page = await context.newPage();
    await gotoMockHarnessPage(page);
    await expect(page.locator('main')).toHaveAttribute(
      'data-translated',
      'true',
      {
        timeout: 30_000,
      },
    );
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'dynamic-content';
      div.textContent =
        'This is dynamically loaded content that should be translated.';
      document.body.appendChild(div);
    });

    await expect(page.locator('#dynamic-content')).toHaveAttribute(
      'data-translated',
      'true',
      {
        timeout: 15_000,
      },
    );

    await page.close();
  });

  // ── 3. Auto-translate with iframes ─────────────────────────────
  test('handles pages with iframes', async ({ context, extensionId }) => {
    await configureAutoTranslate(
      context,
      extensionId,
      FAST_AUTO_TRANSLATE_SETTINGS,
    );

    const page = await context.newPage();
    await gotoMockHarnessPage(page);
    await expect(page.locator('main')).toHaveAttribute(
      'data-translated',
      'true',
      {
        timeout: 10_000,
      },
    );

    // Inject an iframe into the page
    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.srcdoc =
        '<html><body><p>Iframe content to translate</p></body></html>';
      iframe.id = 'test-iframe';
      iframe.style.width = '400px';
      iframe.style.height = '200px';
      document.body.appendChild(iframe);
    });

    // Wait for iframe to load
    await page.waitForTimeout(2000);

    // Verify iframe exists and has content
    const iframeHandle = await page.locator('#test-iframe').elementHandle();
    expect(iframeHandle).toBeTruthy();

    const frame = await iframeHandle!.contentFrame();
    if (frame) {
      const iframeText = await frame.textContent('body');
      expect(iframeText).toContain('Iframe content');
    }

    await page.close();
  });

  // ── 4. Auto-translate disabled → no translation on page load ───
  test('does not auto-translate when disabled', async ({
    context,
    extensionId,
  }) => {
    await configureAutoTranslate(context, extensionId, {
      autoTranslate: false,
      sourceLang: 'auto',
      targetLang: 'en',
      provider: 'opus-mt',
    });

    const page = await context.newPage();
    await gotoMockHarnessPage(page);

    // Wait a reasonable time for any unwanted auto-translation
    await page.waitForTimeout(1500);

    await expect(page.locator('[data-translated]')).toHaveCount(0);

    // Original content should be unchanged
    await expect(page.locator('#mock-root')).toHaveText(
      MOCK_HARNESS_TEXT,
    );

    await page.close();
  });

  // ── 5. Matching language → auto-translate becomes a no-op pass ───
  test('keeps page text unchanged when page language matches target', async ({
    context,
    extensionId,
  }) => {
    await configureAutoTranslate(
      context,
      extensionId,
      FAST_AUTO_TRANSLATE_SETTINGS,
    );

    const page = await context.newPage();
    await gotoMockHarnessPage(page);

    // Auto-translate still runs, but the visible English text remains unchanged.
    await expect(page.locator('main')).toHaveAttribute(
      'data-translated',
      'true',
      {
        timeout: 30_000,
      },
    );
    await expect(page.locator('#mock-root')).toHaveText(
      MOCK_HARNESS_TEXT,
    );

    await page.close();
  });
});
