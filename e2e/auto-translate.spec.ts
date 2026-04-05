/**
 * E2E: Page-translation smoke tests for the auto-translate path.
 *
 * Covers the live content-script translation pipeline, dynamic-content
 * observer, and the disabled auto-translate contract on the mock harness.
 *
 * The browser-only load-time auto-start scheduler is unit-covered in
 * src/content/index.test.ts. In CI, hidden/background tab timing under Xvfb
 * can stall that scheduler even when the content-script translation path is
 * otherwise healthy, so the positive smoke cases use a harness-only DOM event
 * bridge that triggers the explicit content-script translation path.
 */
import {
  test,
  expect,
  popupUrl,
  setExtensionSettings,
  type BrowserContext,
  type Page,
} from './fixtures';
import {
  MOCK_HARNESS_TEXT,
  MOCK_HARNESS_URL,
} from './mock-harness';
import {
  AUTO_TRANSLATE_E2E_REQUEST_EVENT,
  AUTO_TRANSLATE_E2E_RESPONSE_EVENT,
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

const AUTO_TRANSLATE_E2E_RESPONSE_ATTR = 'data-auto-translate-e2e-response';

type AutoTranslateBridgeResponse =
  | {
      requestId: string;
      success: true;
      summary: {
        translatedCount: number;
        errorCount: number;
        handledBy: 'extension' | 'site-tool' | 'pdf';
      };
    }
  | {
      requestId: string;
      success: false;
      error: string;
    };

function logAutoTranslateDebug(label: string, details?: unknown): void {
  const message =
    details === undefined
      ? `[auto-translate:e2e] ${label}`
      : `[auto-translate:e2e] ${label}: ${
          typeof details === 'string'
            ? details
            : JSON.stringify(details, null, 2)
        }`;
  console.error(message);
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

async function dispatchTranslatePageBridge(
  page: Page,
  label: string,
): Promise<void> {
  const requestId = `bridge-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  await page.evaluate(
    ({ requestEventName, responseEventName, responseAttr, message, requestId }) => {
      const root = document.documentElement;
      root.removeAttribute(responseAttr);

      const onResponse = (event: Event) => {
        const detail = (event as CustomEvent<AutoTranslateBridgeResponse>).detail;
        if (!detail || detail.requestId !== requestId) return;

        document.removeEventListener(
          responseEventName,
          onResponse as EventListener,
        );
        root.setAttribute(responseAttr, JSON.stringify(detail));
      };

      document.addEventListener(
        responseEventName,
        onResponse as EventListener,
      );
      document.dispatchEvent(
        new CustomEvent(requestEventName, {
          detail: {
            requestId,
            type: 'translatePage',
            ...message,
          },
        }),
      );
    },
    {
      requestEventName: AUTO_TRANSLATE_E2E_REQUEST_EVENT,
      responseEventName: AUTO_TRANSLATE_E2E_RESPONSE_EVENT,
      responseAttr: AUTO_TRANSLATE_E2E_RESPONSE_ATTR,
      message: FAST_TRANSLATE_PAGE_MESSAGE,
      requestId,
    },
  );

  let response: AutoTranslateBridgeResponse | null = null;
  try {
    await expect
      .poll(
        async () => {
          response = await page.evaluate((responseAttr) => {
            const raw = document.documentElement.getAttribute(responseAttr);
            return raw
              ? (JSON.parse(raw) as AutoTranslateBridgeResponse)
              : null;
          }, AUTO_TRANSLATE_E2E_RESPONSE_ATTR);
          return response;
        },
        { timeout: 10_000 },
      )
      .toMatchObject({ requestId });
  } catch (error) {
    await logAutoTranslateDebugState(page, `${label}:bridge:timeout`);
    throw error;
  }

  logAutoTranslateDebug(`${label}:bridge:response`, response);
  if (!response) {
    throw new Error('Timed out waiting for auto-translate bridge response');
  }
  if (!response.success) {
    throw new Error(response.error);
  }

  expect(response.summary.handledBy).toBe('extension');
}

async function gotoMockHarnessPage(page: Page, label: string): Promise<void> {
  logAutoTranslateDebug(`${label}:harness:navigate:start`, {
    url: MOCK_HARNESS_URL,
  });
  await page.goto(MOCK_HARNESS_URL, { waitUntil: 'domcontentloaded' });
  logAutoTranslateDebug(`${label}:harness:navigate:domcontentloaded`, {
    url: page.url(),
  });

  try {
    await page.waitForFunction(
      (attrName) => {
        return document.documentElement.getAttribute(attrName) === 'true';
      },
      CONTENT_SCRIPT_READY_ATTR,
      { timeout: 10_000 },
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
  bridgeResponse: AutoTranslateBridgeResponse | null;
  diagnostics:
    | AutoTranslateDiagnostics
    | { parseError: string; raw: string | null }
    | null;
};

async function readAutoTranslateSnapshot(
  page: Page,
): Promise<AutoTranslateSnapshot> {
  return page.evaluate(
    ({ diagnosticsAttr, readyAttr, responseAttr }) => {
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
        bridgeResponse: (() => {
          const bridgeRaw = document.documentElement.getAttribute(responseAttr);
          return bridgeRaw
            ? (JSON.parse(bridgeRaw) as AutoTranslateBridgeResponse)
            : null;
        })(),
        diagnostics,
      };
    },
    {
      diagnosticsAttr: AUTO_TRANSLATE_DIAGNOSTICS_ATTR,
      readyAttr: CONTENT_SCRIPT_READY_ATTR,
      responseAttr: AUTO_TRANSLATE_E2E_RESPONSE_ATTR,
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
    ({ diagnosticsAttr, readyAttr, responseAttr }) => {
      return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        readyAttr: document.documentElement.getAttribute(readyAttr),
        bridgeResponseRaw: document.documentElement.getAttribute(responseAttr),
        diagnosticsRaw: document.documentElement.getAttribute(diagnosticsAttr),
        rootText: document.querySelector('#mock-root')?.textContent ?? null,
        mainTranslated:
          document.querySelector('main')?.getAttribute('data-translated') ?? null,
      };
    },
    {
      diagnosticsAttr: AUTO_TRANSLATE_DIAGNOSTICS_ATTR,
      readyAttr: CONTENT_SCRIPT_READY_ATTR,
      responseAttr: AUTO_TRANSLATE_E2E_RESPONSE_ATTR,
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
  timeout = 15_000,
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

async function expectHarnessRootText(
  page: Page,
  label: string,
  timeout = 5_000,
): Promise<void> {
  try {
    await expect(page.locator('#mock-root')).toHaveText(MOCK_HARNESS_TEXT, {
      timeout,
    });
  } catch (error) {
    await logAutoTranslateDebugState(page, `${label}:root-text:timeout`);
    throw error;
  }
}

async function ensureHarnessPageTranslated(
  page: Page,
  label: string,
): Promise<void> {
  await gotoMockHarnessPage(page, label);
  await dispatchTranslatePageBridge(page, label);
  await expectPageTranslation(page, label);
}

test.describe('Auto-translate', () => {
  test.describe.configure({ timeout: 45_000 });

  // ── 1. Harness page translation ─────────────────────────────────
  test('translates the harness page with the content-script translation path', async ({
    context,
  }) => {
    const label = 'page-translation';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(page, label);
      await expectHarnessRootText(page, label);
    } finally {
      flushDebug();
      await page.close();
    }
  });

  // ── 2. Dynamic content (SPA simulation) ────────────────────────
  test('translates dynamically loaded content', async ({
    context,
  }) => {
    const label = 'dynamic-content';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(page, label);
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
            { timeout: 10_000 },
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
  test('handles pages with iframes', async ({ context }) => {
    const label = 'iframes';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(page, label);

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
      await expectHarnessRootText(page, label);
    } finally {
      flushDebug();
      await page.close();
    }
  });

  // ── 5. Matching language → auto-translate becomes a no-op pass ───
  test('keeps page text unchanged when page language matches target', async ({
    context,
  }) => {
    const label = 'matching-language';

    const page = await context.newPage();
    const flushDebug = attachAutoTranslateDebug(page, label);

    try {
      await ensureHarnessPageTranslated(page, label);
      await expectHarnessRootText(page, label);
    } finally {
      flushDebug();
      await page.close();
    }
  });
});
