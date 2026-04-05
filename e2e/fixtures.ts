import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import {
  EXTENSION_PATH,
  getExtensionLaunchSettings,
  type ExtensionLaunchOptions,
} from './extension-launch';

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

interface MessageOptions {
  timeoutMs?: number;
  label?: string;
}

function withMessageTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number,
  label = 'message'
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

function createExtensionTest(options: ExtensionLaunchOptions = {}) {
  return base.extend<ExtensionFixtures>({
    // eslint-disable-next-line no-empty-pattern
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext(
        '',
        getExtensionLaunchSettings(options)
      );

      await use(context);
      await context.close();
    },
    extensionId: async ({ context }, use) => {
      let serviceWorker = context.serviceWorkers()[0];
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
      }

      const match = serviceWorker.url().match(/chrome-extension:\/\/([^/]+)/);
      if (!match) {
        throw new Error(`Could not extract extension ID from: ${serviceWorker.url()}`);
      }

      await use(match[1]);
    },
  });
}

export const test = createExtensionTest();
export const gpuTest = createExtensionTest({ enableGpu: true });

export function popupUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/popup/index.html`;
}

export function offscreenUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/offscreen/offscreen.html`;
}

export async function sendExtensionMessage<T>(
  page: Page,
  message: Record<string, unknown>,
  options?: MessageOptions
): Promise<T> {
  const promise = page.evaluate(async (msg) => {
    return new Promise<T>((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response: T) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }, message);

  return withMessageTimeout(
    promise,
    options?.timeoutMs,
    options?.label ?? `extension message ${(message.type as string | undefined) ?? 'unknown'}`
  );
}

export async function findTabIdByUrlFragment(
  page: Page,
  urlFragment: string
): Promise<number> {
  const tabId = await page.evaluate(async (fragment) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => typeof candidate.id === 'number' && candidate.url?.includes(fragment));
    return tab?.id ?? null;
  }, urlFragment);

  expect(tabId).not.toBeNull();
  return tabId as number;
}

export async function sendTabMessage<T>(
  page: Page,
  tabId: number,
  message: Record<string, unknown>,
  options?: MessageOptions
): Promise<T> {
  const response = await withMessageTimeout(
    page.evaluate(async ({ targetTabId, payload }) => {
      return new Promise<unknown>((resolve, reject) => {
        chrome.tabs.sendMessage(targetTabId, payload, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    }, { targetTabId: tabId, payload: message }),
    options?.timeoutMs,
    options?.label ?? `tab message ${(message.type as string | undefined) ?? 'unknown'}`
  );

  return response as T;
}

export async function waitForTabPing(
  page: Page,
  urlFragment: string
): Promise<number> {
  let tabId: number | null = null;

  await expect.poll(async () => {
    tabId = await page.evaluate(async (fragment) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => typeof candidate.id === 'number' && candidate.url?.includes(fragment));
      return tab?.id ?? null;
    }, urlFragment);
    return tabId;
  }, { timeout: 15_000 }).toBeTruthy();

  await expect.poll(async () => {
    try {
      return await sendTabMessage<{ loaded: boolean }>(
        page,
        tabId as number,
        { type: 'ping' },
        { timeoutMs: 2_000, label: 'tab ping' }
      );
    } catch {
      return null;
    }
  }, { timeout: 15_000 }).toEqual({ loaded: true });

  return tabId as number;
}

export async function setExtensionSettings(
  page: Page,
  settings: Record<string, unknown>
): Promise<void> {
  await page.evaluate(async (updates) => {
    await chrome.storage.local.set(updates);
  }, settings);
}

export { expect, EXTENSION_PATH, type BrowserContext, type Page };
