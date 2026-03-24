import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '..', 'dist');
const BACKGROUND_MODE = process.env.BACKGROUND !== 'false';

interface ExtensionFixtureOptions {
  enableGpu?: boolean;
}

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

function buildExtensionArgs({ enableGpu = false }: ExtensionFixtureOptions = {}): string[] {
  return [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--disable-component-update',
    ...(BACKGROUND_MODE
      ? [
          '--window-position=-32000,-32000',
          '--window-size=1280,720',
          ...(enableGpu ? [] : ['--disable-gpu']),
          '--mute-audio',
        ]
      : []),
  ];
}

function createExtensionTest(options: ExtensionFixtureOptions = {}) {
  return base.extend<ExtensionFixtures>({
    // eslint-disable-next-line no-empty-pattern
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        headless: false,
        args: buildExtensionArgs(options),
      });

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
  message: Record<string, unknown>
): Promise<T> {
  return page.evaluate(async (msg) => {
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
