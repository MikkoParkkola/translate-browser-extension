import { test, expect, popupUrl, type Page } from './fixtures';
import { MOCK_HARNESS_FRAGMENT, MOCK_HARNESS_URL } from './mock-harness';

async function getTabIdForContentPage(popupPage: Page, urlFragment: string): Promise<number> {
  const tabId = await popupPage.evaluate(async (fragment) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => typeof candidate.id === 'number' && candidate.url?.includes(fragment));
    return tab?.id ?? null;
  }, urlFragment);

  expect(tabId).not.toBeNull();
  return tabId as number;
}

async function sendTabMessage<T>(
  popupPage: Page,
  tabId: number,
  message: Record<string, unknown>
): Promise<T> {
  const response = await popupPage.evaluate(async ({ targetTabId, payload }) => {
    return new Promise<unknown>((resolve, reject) => {
      chrome.tabs.sendMessage(targetTabId, payload, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }, { targetTabId: tabId, payload: message });

  return response as T;
}

test.describe('Context menu dispatch contracts', () => {
  test.describe.configure({ timeout: 60_000 });

  test('translate-selection dispatch is accepted by the content script', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(MOCK_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);

    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.textContent = 'Selected text for context menu translation.';
      document.body.appendChild(paragraph);

      const selection = window.getSelection();
      const textNode = paragraph.firstChild;
      if (!(selection && textNode && textNode.nodeType === Node.TEXT_NODE)) {
        throw new Error('Could not create selection for context-menu test');
      }

      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(12, textNode.textContent?.length ?? 12));
      selection.removeAllRanges();
      selection.addRange(range);
    });

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await getTabIdForContentPage(popupPage, MOCK_HARNESS_FRAGMENT);
    const response = await sendTabMessage<{ success: boolean; status: string }>(popupPage, tabId, {
      type: 'translateSelection',
      sourceLang: 'en',
      targetLang: 'de',
      strategy: 'smart',
      provider: 'opus-mt',
    });

    expect(response).toEqual({ success: true, status: 'started' });

    await popupPage.close();
    await page.close();
  });

  test('translate-page dispatch is accepted by the content script', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(MOCK_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await getTabIdForContentPage(popupPage, MOCK_HARNESS_FRAGMENT);
    const response = await sendTabMessage<{ success: boolean; status: string }>(popupPage, tabId, {
      type: 'translatePage',
      sourceLang: 'en',
      targetLang: 'de',
      strategy: 'smart',
      provider: 'opus-mt',
    });

    expect(response).toEqual({ success: true, status: 'started' });

    await popupPage.close();
    await page.close();
  });

  test('undo-translation restores translated markers', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(MOCK_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);

    await page.evaluate(() => {
      const heading = document.createElement('h1');
      heading.textContent = 'Translated heading';
      heading.setAttribute('data-translated', 'true');
      heading.setAttribute('data-original-text', 'Original heading');
      heading.setAttribute('data-source-lang', 'en');
      heading.setAttribute('data-target-lang', 'de');
      document.body.appendChild(heading);
    });

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await getTabIdForContentPage(popupPage, MOCK_HARNESS_FRAGMENT);
    const response = await sendTabMessage<{ success: boolean; restoredCount: number }>(popupPage, tabId, {
      type: 'undoTranslation',
    });

    expect(response.success).toBe(true);
    expect(response.restoredCount).toBe(1);

    const restoredState = await page.evaluate(() => {
      const heading = document.querySelector('h1');
      return {
        text: heading?.textContent,
        translated: heading?.hasAttribute('data-translated'),
        originalText: heading?.getAttribute('data-original-text'),
      };
    });

    expect(restoredState).toEqual({
      text: 'Original heading',
      translated: false,
      originalText: null,
    });

    await popupPage.close();
    await page.close();
  });

  test('translate-image dispatch accepts an image payload', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(MOCK_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);

    const imageUrl = await page.evaluate(() => {
      const image = document.createElement('img');
      image.alt = 'context menu test image';
      image.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="white"/><text x="12" y="35" font-size="20">Hello</text></svg>`
        );
      image.id = 'context-menu-image';
      document.body.appendChild(image);
      return image.src;
    });

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await getTabIdForContentPage(popupPage, MOCK_HARNESS_FRAGMENT);
    const response = await sendTabMessage<{ success: boolean; status: string }>(popupPage, tabId, {
      type: 'translateImage',
      imageUrl,
      sourceLang: 'auto',
      targetLang: 'de',
      provider: 'opus-mt',
    });

    expect(response).toEqual({ success: true, status: 'started' });

    await popupPage.close();
    await page.close();
  });
});
