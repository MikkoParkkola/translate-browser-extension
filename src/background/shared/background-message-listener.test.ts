import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTranslationError: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
    technicalDetails: error instanceof Error ? error.message : String(error),
  })),
  formatUserError: vi.fn(() => 'Formatted error'),
}));

vi.mock('../../core/errors', () => ({
  createTranslationError: mocks.createTranslationError,
}));

vi.mock('./provider-management', () => ({
  formatUserError: mocks.formatUserError,
}));

function flushAsyncWork(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

describe('createBackgroundMessageListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores non-extension messages', async () => {
    const { createBackgroundMessageListener } = await import('./background-message-listener');

    const sendResponse = vi.fn();
    const listener = createBackgroundMessageListener({
      extensionUrlPrefix: 'chrome-extension://',
      isHandledMessage: ((_message): _message is never => false),
      dispatch: vi.fn(),
      log: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(listener({ invalid: true }, {} as chrome.runtime.MessageSender, sendResponse)).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('ignores offscreen-targeted messages before routing', async () => {
    const { createBackgroundMessageListener } = await import('./background-message-listener');

    const sendResponse = vi.fn();
    const listener = createBackgroundMessageListener({
      extensionUrlPrefix: 'chrome-extension://',
      isHandledMessage: ((_message): _message is never => false),
      dispatch: vi.fn(),
      log: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(
      listener(
        { type: 'ping', target: 'offscreen' },
        {} as chrome.runtime.MessageSender,
        sendResponse,
      )
    ).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('short-circuits when beforeRoute handles the message', async () => {
    const { createBackgroundMessageListener } = await import('./background-message-listener');

    const sendResponse = vi.fn();
    const beforeRoute = vi.fn(() => true);
    const dispatch = vi.fn();
    const listener = createBackgroundMessageListener({
      extensionUrlPrefix: 'chrome-extension://',
      isHandledMessage: ((_message): _message is never => false),
      dispatch,
      beforeRoute,
      log: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(
      listener(
        { type: 'ping' },
        {} as chrome.runtime.MessageSender,
        sendResponse,
      )
    ).toBe(true);
    expect(beforeRoute).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('preserves unauthorized sender responses for sensitive messages', async () => {
    const { createBackgroundMessageListener } = await import('./background-message-listener');

    const sendResponse = vi.fn();
    const listener = createBackgroundMessageListener({
      extensionUrlPrefix: 'chrome-extension://',
      isHandledMessage: ((_message): _message is never => false),
      dispatch: vi.fn(),
      log: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(
      listener(
        { type: 'clearCache' },
        { url: 'https://example.com/page' } as chrome.runtime.MessageSender,
        sendResponse,
      )
    ).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Unauthorized sender',
    });
  });

  it('routes handled messages through the provided dispatcher', async () => {
    const { createBackgroundMessageListener } = await import('./background-message-listener');

    const sendResponse = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      success: true,
      status: 'ready',
      provider: 'opus-mt',
    });
    const listener = createBackgroundMessageListener({
      extensionUrlPrefix: 'chrome-extension://',
      isHandledMessage: (
        message,
      ): message is Extract<import('../../types').BackgroundRequestMessage, { type: 'ping' }> => message.type === 'ping',
      dispatch,
      log: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(
      listener(
        { type: 'ping' },
        { url: 'chrome-extension://test-id/popup.html' } as chrome.runtime.MessageSender,
        sendResponse,
      )
    ).toBe(true);

    await flushAsyncWork();

    expect(dispatch).toHaveBeenCalledWith({ type: 'ping' });
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      status: 'ready',
      provider: 'opus-mt',
    });
  });

  it('formats dispatch failures with the shared error mapping', async () => {
    const { createBackgroundMessageListener } = await import('./background-message-listener');

    const sendResponse = vi.fn();
    const log = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const listener = createBackgroundMessageListener({
      extensionUrlPrefix: 'chrome-extension://',
      isHandledMessage: (
        message,
      ): message is Extract<import('../../types').BackgroundRequestMessage, { type: 'ping' }> => message.type === 'ping',
      dispatch: vi.fn().mockRejectedValue(new Error('boom')),
      log,
      errorLogPrefix: ' ',
    });

    expect(
      listener(
        { type: 'ping' },
        { url: 'chrome-extension://test-id/popup.html' } as chrome.runtime.MessageSender,
        sendResponse,
      )
    ).toBe(true);

    await flushAsyncWork();

    expect(mocks.createTranslationError).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.formatUserError).toHaveBeenCalledWith({
      message: 'boom',
      technicalDetails: 'boom',
    });
    expect(log.error).toHaveBeenCalledWith(' Error:', 'boom');
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Formatted error',
    });
  });
});
