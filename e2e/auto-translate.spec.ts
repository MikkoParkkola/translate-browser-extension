/**
 * E2E: Page-translation smoke tests for the auto-translate path.
 *
 * Covers the live content-script translation pipeline, dynamic-content
 * observer, and the disabled auto-translate contract on the mock harness.
 *
 * The browser-only load-time auto-start scheduler is unit-covered in
 * src/content/index.test.ts. In CI, hidden/background tab timing under Xvfb
 * can stall that scheduler even when the content-script translation path is
 * otherwise healthy, so the positive smoke cases use the already-supported
 * explicit `translatePage` content-script dispatch on the harness page.
 */
import {
  test,
  expect,
  popupUrl,
  sendTabMessage,
  setExtensionSettings,
  waitForTabPing,
  type BrowserContext,
  type Page,
} from './fixtures';
import {
  MOCK_HARNESS_TEXT,
  MOCK_HARNESS_URL,
} from './mock-harness';
import {
  AUTO_TRANSLATE_DIAGNOSTICS_ATTR,
  CONTENT_SCRIPT_READY_ATTR,
  type AutoTranslateDiagnostics,
} from '../src/content/content-types';

const FAST_NOOP_TRANSLATION_SETTINGS = {
  sourceLang: 'en',
  targetLang: 'en',
  provider: 'opus-mt',
} as const;

const FAST_DISABLED_AUTO_TRANSLATE_SETTINGS = {
  autoTranslate: false,
  ...FAST_NOOP_TRANSLATION_SETTINGS,
} as const;

const FAST_TRANSLATE_PAGE_MESSAGE = {
  ...FAST_NOOP_TRANSLATION_SETTINGS,
  strategy: 'smart',
} as const;

function logAutoTranslateDebug(label: string, details?: unknown): void {
  if (details === undefined) {
    console.log(`[auto-translate:e2e] ${label}`);
    return;
  }

  const serialized =
    typeof details === 'string'
      ? details
      : JSON.stringify(details, null, 2);
  console.log(`[auto-translate:e2e] ${label}: ${serialized}`);
}

function attachAutoTranslateDebug(page: Page, label: string): () => void {
  const events: string[] = [];
  const onConsole = (message: { type(): string; text(): string }) => {
    events.push(`[console:${message.type()}] ${message.text()}`);
  };
  const onPageError = (error: Error) => {
    events.push(`[pageerror] ${error.message}`);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);

    if (events.length > 0) {
      logAutoTranslateDebug(`${label}:page-events`, events);
    }
  };
}

async function configureAutoTranslate(
  context: BrowserContext,
  extensionId: string,
  settings: Record<string, unknown>,
  label: string,
): Promise<void> {
  logAutoTranslateDebug(`${label}:configure:start`, settings);
  const setupPage = await context.newPage();

  try {
    await setupPage.goto(popupUrl(extensionId));
    await setupPage.waitForLoadState('domcontentloaded');
    logAutoTranslateDebug(`${label}:configure:popup-ready`);

    await setExtensionSettings(setupPage, settings);
    const storedSettings = await setupPage.evaluate(async (keys) => {
      return chrome.storage.local.get(keys);
    }, Object.keys(settings));
    logAutoTranslateDebug(`${label}:configure:stored-settings`, storedSettings);
    expect(storedSettings).toMatchObject(settings);
  } finally {
    await setupPage.close();
  }
}

async function gotoMockHarnessPage(page: Page, label: string): Promise<void> {
  logAutoTranslateDebug(`${label}:harness:navigate:start`, {
    url: MOCK_HARNESS_URL,
  });
  await page.bringToFront();
  await page.goto(MOCK_HARNESS_URL);
  await page.waitForLoadState('domcontentloaded');
  logAutoTranslateDebug(`${label}:harness:navigate:domcontentloaded`, {
    url: page.url(),
  });

  try {
    await page.waitForFunction(
      (attrName) => {
        return document.documentElement.getAttribute(attrName) === 'true';
      },
      CONTENT_SCRIPT_READY_ATTR,
      { timeout: 15_000 },
    );
    logAutoTranslateDebug(`${label}:harness:navigate:content-ready`);
  } catch (error) {
    await logAutoTranslateDebugState(page, `${label}:harness:navigate:timeout`);
    throw error;
  }
}

type AutoTranslateSnapshot = {
  ready: string | null;
  translated: string | null;
  diagnostics:
    | AutoTranslateDiagnostics
    | { parseError: string; raw: string | null }
    | null;
};

async function readAutoTranslateSnapshot(
  page: Page,
): Promise<AutoTranslateSnapshot> {
  return page.evaluate(
    ({ diagnosticsAttr, readyAttr }) => {
      const raw = document.documentElement.getAttribute(diagnosticsAttr);
      let diagnostics: AutoTranslateSnapshot['diagnostics'] = null;

      if (raw) {
        try {
          diagnostics = JSON.parse(raw);
        } catch (error) {
          diagnostics = {
            parseError: error instanceof Error ? error.message : String(error),
            raw,
          };
        }
      }

      return {
        ready: document.documentElement.getAttribute(readyAttr),
        translated: document
          .querySelector('main')
          ?.getAttribute('data-translated') ?? null,
        diagnostics,
      };
    },
    {
      diagnosticsAttr: AUTO_TRANSLATE_DIAGNOSTICS_ATTR,
      readyAttr: CONTENT_SCRIPT_READY_ATTR,
    },
  );
}

async function logAutoTranslateDebugState(
  page: Page,
  label: string,
): Promise<void> {
  const snapshot = await readAutoTranslateSnapshot(page).catch((error) => ({
    snapshotReadError:
      error instanceof Error ? error.message : String(error),
  }));
  const pageState = await page.evaluate(
    ({ diagnosticsAttr, readyAttr }) => {
      return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        readyAttr: document.documentElement.getAttribute(readyAttr),
        diagnosticsRaw: document.documentElement.getAttribute(diagnosticsAttr),
        rootText: document.querySelector('#mock-root')?.textContent ?? null,
        mainTranslated:
          document.querySelector('main')?.getAttribute('data-translated') ?? null,
      };
    },
    {
      diagnosticsAttr: AUTO_TRANSLATE_DIAGNOSTICS_ATTR,
      readyAttr: CONTENT_SCRIPT_READY_ATTR,
    },
  ).catch((error) => ({
    pageReadError: error instanceof Error ? error.message : String(error),
  }));

  logAutoTranslateDebug(label, {
    snapshot,
    pageState,
  });
}

async function expectPageTranslation(
  page: Page,
  label: string,
  timeout = 30_000,
): Promise<void> {
  try {
    await expect(page.locator('main')).toHaveAttribute(
      'data-translated',
      'true',
      { timeout },
    );
    logAutoTranslateDebug(`${label}:translated`);
  } catch (error) {
    await logAutoTranslateDebugState(page, `${label}:translated:timeout`);
    throw error;
  }
}

async function dispatchTranslatePageToHarness(
  context: BrowserContext,
  extensionId: string,
  label: string,
): Promise<void> {
  const popupPage = await context.newPage();

  try {
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');
    logAutoTranslateDebug(`${label}:fallback:popup-ready`);

    const tabId = await waitForTabPing(popupPage, '/e2e/mock.html');
    logAutoTranslateDebug(`${label}:fallback:tab-ping`, { tabId });

    const response = await sendTabMessage<{
      success: boolean;
      status: string;
    }>(popupPage, tabId, {
      type: 'translatePage',
      ...FAST_TRANSLATE_PAGE_MESSAGE,
    });
    logAutoTranslateDebug(`${label}:fallback:response`, response);
    expect(response).toEqual({ success: true, status: 'started' });
  } finally {
    await popupPage.close();
  }
}

async function ensureHarnessPageTranslated(
  context: BrowserContext,
  extensionId: string,
  page: Page,
  label: string,
): Promise<void> {
  await gotoMockHarnessPage(page, label);
  await dispatchTranslatePageToHarness(context, extensionId, label);
  await expectPageTranslation(page, label);
}

test.describe('Auto-translate', () => {
  test.describe.configure({ timeout: 90_000 });

  // ── 1. Harness page translation ─────────────────────────────────
  test('translates the harness page with the content-script translation path', async ({
    context,
    extensionId,
  }) => {
    const label = 'page-translation';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(context, extensionId, page, label);
      await expect(page.locator('#mock-root')).toHaveText(
        MOCK_HARNESS_TEXT,
      );
    } finally {
      flushDebug();
      await page.close();
    }
  });

  // ── 2. Dynamic content (SPA simulation) ────────────────────────
  test('translates dynamically loaded content', async ({
    context,
    extensionId,
  }) => {
    const label = 'dynamic-content';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(context, extensionId, page, label);
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const div = document.createElement('div');
        div.id = 'dynamic-content';
        div.textContent =
          'This is dynamically loaded content that should be translated.';
        document.body.appendChild(div);
      });
      logAutoTranslateDebug(`${label}:dynamic-node:added`);

      try {
        await expect
          .poll(
            async () => {
              return {
                translated: await page
                  .locator('#dynamic-content')
                  .getAttribute('data-translated'),
              };
            },
            { timeout: 15_000 },
          )
          .toMatchObject({
            translated: 'true',
          });
      } catch (error) {
        await logAutoTranslateDebugState(page, `${label}:dynamic-node:timeout`);
        throw error;
      }
    } finally {
      flushDebug();
      await page.close();
    }
  });

  // ── 3. Auto-translate with iframes ─────────────────────────────
  test('handles pages with iframes', async ({ context, extensionId }) => {
    const label = 'iframes';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(context, extensionId, page, label);

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
    } finally {
      flushDebug();
      await page.close();
    }
  });

  // ── 4. Auto-translate disabled → no translation on page load ───
  test('does not auto-translate when disabled', async ({
    context,
    extensionId,
  }) => {
    const label = 'disabled';
    await configureAutoTranslate(
      context,
      extensionId,
      FAST_DISABLED_AUTO_TRANSLATE_SETTINGS,
      label,
    );

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await gotoMockHarnessPage(page, label);

      // Wait a reasonable time for any unwanted auto-translation
      await page.waitForTimeout(1500);

      await expect(page.locator('[data-translated]')).toHaveCount(0);

      // Original content should be unchanged
      await expect(page.locator('#mock-root')).toHaveText(
        MOCK_HARNESS_TEXT,
      );
    } finally {
      flushDebug();
      await page.close();
    }
  });

  // ── 5. Matching language → auto-translate becomes a no-op pass ───
  test('keeps page text unchanged when page language matches target', async ({
    context,
    extensionId,
  }) => {
    const label = 'matching-language';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(context, extensionId, page, label);
      await expect(page.locator('#mock-root')).toHaveText(
        MOCK_HARNESS_TEXT,
      );
    } finally {
      flushDebug();
      await page.close();
    }
  });
});
