import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupChromeApiMock } from './chrome-mocks';
import {
  createExecuteScriptResult,
  setupChromeTabsScriptingMocks,
} from './chrome-tabs-scripting-mocks';

describe('chrome tabs scripting mocks', () => {
  let chromeApiMock: ReturnType<typeof setupChromeApiMock>;
  let tabsScriptingMocks: ReturnType<typeof setupChromeTabsScriptingMocks>;
  let originalCaptureVisibleTab: ReturnType<
    typeof setupChromeApiMock
  >['chrome']['tabs']['captureVisibleTab'];

  beforeAll(() => {
    chromeApiMock = setupChromeApiMock({
      tabs: {
        query: vi.fn().mockResolvedValue([]),
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([]),
      },
    });
    tabsScriptingMocks = setupChromeTabsScriptingMocks(chromeApiMock.chrome);
    originalCaptureVisibleTab = chromeApiMock.chrome.tabs.captureVisibleTab;
  });

  it('queues active tab, executeScript result, and captureVisibleTab result using Chrome response shapes', async () => {
    tabsScriptingMocks.queueActiveTab({ id: 99 });
    tabsScriptingMocks.queueExecuteScriptResult(['Hei']);
    tabsScriptingMocks.queueCaptureVisibleTabResult('data:image/png;base64,screenshot');

    await expect(globalThis.chrome.tabs.query({ active: true })).resolves.toEqual([
      { id: 99 },
    ]);
    await expect(
      globalThis.chrome.scripting.executeScript({
        target: { tabId: 99 },
      } as any),
    ).resolves.toEqual(createExecuteScriptResult(['Hei']));
    await expect(globalThis.chrome.tabs.captureVisibleTab()).resolves.toBe(
      'data:image/png;base64,screenshot',
    );
  });

  it('restores baseline query, executeScript, and captureVisibleTab behavior after cleanup', async () => {
    expect(globalThis.chrome.tabs.captureVisibleTab).toBe(originalCaptureVisibleTab);
    await expect(globalThis.chrome.tabs.query({ active: true })).resolves.toEqual([]);
    await expect(
      globalThis.chrome.scripting.executeScript({
        target: { tabId: 1 },
      } as any),
    ).resolves.toEqual([]);
    await expect(globalThis.chrome.tabs.captureVisibleTab()).resolves.toBeUndefined();
  });

  it('allows tests to replace the captureVisibleTab mock instance temporarily', async () => {
    globalThis.chrome.tabs.captureVisibleTab = vi
      .fn()
      .mockResolvedValue('data:image/png;base64,dirty');

    await expect(globalThis.chrome.tabs.captureVisibleTab()).resolves.toBe(
      'data:image/png;base64,dirty',
    );
  });

  it('restores the original captureVisibleTab mock instance after cleanup', async () => {
    expect(globalThis.chrome.tabs.captureVisibleTab).toBe(originalCaptureVisibleTab);
    await expect(globalThis.chrome.tabs.captureVisibleTab()).resolves.toBeUndefined();
  });
});
