import { describe, expect, it, vi } from 'vitest';
import { setupChromeApiMock } from './chrome-mocks';
import { setupChromeRuntimeMessagingMocks } from './chrome-runtime-messaging-mocks';
import { cleanupGlobalFixtures } from './global-fixture-registry';

describe('chrome runtime messaging mocks', () => {
  it('restores seeded storage state without dropping captured listeners', async () => {
    const chromeApiMock = setupChromeApiMock({
      storage: {
        localState: {
          seeded: 'initial',
        },
      },
    });
    const runtimeMocks = setupChromeRuntimeMessagingMocks({
      chromeApi: chromeApiMock.chrome as unknown as Record<string, any>,
    });
    const listener = vi.fn();

    globalThis.chrome.runtime.onMessage.addListener(listener);
    await globalThis.chrome.storage.local.set({ dirty: true });

    expect(runtimeMocks.runtime.onMessage.addListener).toHaveBeenCalledWith(listener);
    await expect(globalThis.chrome.storage.local.get(null)).resolves.toEqual({
      seeded: 'initial',
      dirty: true,
    });

    cleanupGlobalFixtures();

    expect(runtimeMocks.runtime.onMessage.listeners).toEqual([listener]);
    expect(runtimeMocks.runtime.onMessage.addListener).not.toHaveBeenCalled();
    await expect(globalThis.chrome.storage.local.get(null)).resolves.toEqual({
      seeded: 'initial',
    });
  });

  it('preserves callback and promise runtime messaging behavior across cleanup', async () => {
    const runtimeSendMessage = vi.fn(
      (
        message: Record<string, unknown>,
        callback?: (response: Record<string, unknown>) => void,
      ) => {
        const response = { echoed: message.type };
        callback?.(response);
        return Promise.resolve(response);
      },
    );

    const chromeApiMock = setupChromeApiMock({
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      storage: {
        localState: {
          seeded: true,
        },
      },
    });

    setupChromeRuntimeMessagingMocks({
      chromeApi: chromeApiMock.chrome as unknown as Record<string, any>,
    });

    const firstCallback = vi.fn();
    await expect(
      (
        chromeApiMock.chrome.runtime.sendMessage as (
          message: Record<string, unknown>,
          callback?: (response: Record<string, unknown>) => void,
        ) => Promise<Record<string, unknown>>
      )({ type: 'ping' }, firstCallback),
    ).resolves.toEqual({
      echoed: 'ping',
    });
    expect(firstCallback).toHaveBeenCalledWith({
      echoed: 'ping',
    });

    cleanupGlobalFixtures();

    const secondCallback = vi.fn();
    await expect(
      (
        chromeApiMock.chrome.runtime.sendMessage as (
          message: Record<string, unknown>,
          callback?: (response: Record<string, unknown>) => void,
        ) => Promise<Record<string, unknown>>
      )({ type: 'pong' }, secondCallback),
    ).resolves.toEqual({
      echoed: 'pong',
    });
    expect(secondCallback).toHaveBeenCalledWith({
      echoed: 'pong',
    });
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1);
  });
});
