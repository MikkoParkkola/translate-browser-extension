import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupCachesMock,
  setupNavigatorStorageEstimateMock,
} from './browser-mocks';
import { setupChromeApiMock, setupUiChromeMock } from './chrome-mocks';

describe('global fixture cleanup barrier', () => {
  describe('chrome api helper', () => {
    let chromeApiMock: ReturnType<typeof setupChromeApiMock>;

    beforeAll(() => {
      chromeApiMock = setupChromeApiMock({
        runtime: {
          sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        },
        storage: {
          localState: {
            seeded: 'initial',
          },
        },
      });
    });

    it('allows fixture state to be dirtied within a test', async () => {
      await globalThis.chrome.runtime.sendMessage({ hello: 'world' });
      await globalThis.chrome.storage.local.set({ dirty: true });

      expect(chromeApiMock.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
      await expect(globalThis.chrome.storage.local.get(null)).resolves.toEqual({
        seeded: 'initial',
        dirty: true,
      });
    });

    it('restores storage state and call history after each test', async () => {
      await expect(globalThis.chrome.storage.local.get(null)).resolves.toEqual({
        seeded: 'initial',
      });
      expect(globalThis.chrome).toBe(chromeApiMock.chrome);
    });
  });

  describe('ui and browser helpers', () => {
    let uiSendMessage: ReturnType<typeof vi.fn>;
    let uiChromeMock: ReturnType<typeof setupUiChromeMock>;
    let navigatorEstimateMock: ReturnType<typeof setupNavigatorStorageEstimateMock>;
    let cachesMock: ReturnType<typeof setupCachesMock>;

    beforeAll(() => {
      uiSendMessage = vi.fn().mockResolvedValue({ view: 'initial' });
      uiChromeMock = setupUiChromeMock({
        runtimeSendMessage: uiSendMessage,
      });
      navigatorEstimateMock = setupNavigatorStorageEstimateMock({
        usage: 12,
        quota: 120,
      });
      cachesMock = setupCachesMock();
    });

    it('allows helper globals to be mutated within a test', async () => {
      uiSendMessage.mockResolvedValue({ view: 'dirty' });
      await globalThis.chrome.runtime.sendMessage({ ping: true });
      navigatorEstimateMock.mockResolvedValue({ usage: 99, quota: 120 });
      cachesMock.keys.mockResolvedValue(['cache-a']);

      await expect(globalThis.navigator.storage.estimate()).resolves.toEqual({
        usage: 99,
        quota: 120,
      });
      await expect(globalThis.caches.keys()).resolves.toEqual(['cache-a']);
    });

    it('restores helper globals to their baseline implementations', async () => {
      expect(uiChromeMock.runtime.sendMessage).not.toHaveBeenCalled();
      await expect(globalThis.chrome.runtime.sendMessage({ ping: true })).resolves.toEqual({
        view: 'initial',
      });

      expect(navigatorEstimateMock).not.toHaveBeenCalled();
      await expect(globalThis.navigator.storage.estimate()).resolves.toEqual({
        usage: 12,
        quota: 120,
      });

      expect(cachesMock.keys).not.toHaveBeenCalled();
      await expect(globalThis.caches.keys()).resolves.toEqual([]);
    });
  });
});
