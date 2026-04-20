import { describe, expect, it, vi } from 'vitest';

import { createTabMessageSender, isRecoverableContentScriptConnectionError } from './tab-message-delivery';

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe('tab-message-delivery', () => {
  it('recognizes recoverable content-script connection failures', () => {
    expect(isRecoverableContentScriptConnectionError('Could not establish connection')).toBe(true);
    expect(isRecoverableContentScriptConnectionError('Receiving end does not exist')).toBe(true);
    expect(isRecoverableContentScriptConnectionError('Permission denied')).toBe(false);
  });

  it('delivers directly when the content script is already available', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const injectContentScript = vi.fn();
    const waitForContentScriptReady = vi.fn();

    const sendToTab = createTabMessageSender({
      log: createLogger(),
      sendMessage,
      injectContentScript,
      waitForContentScriptReady,
    });

    await sendToTab(7, { type: 'translatePage' } as never);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(injectContentScript).not.toHaveBeenCalled();
    expect(waitForContentScriptReady).not.toHaveBeenCalled();
  });

  it('injects and retries when the content script connection is missing', async () => {
    const log = createLogger();
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce(undefined);
    const injectContentScript = vi.fn().mockResolvedValue(undefined);
    const waitForContentScriptReady = vi.fn().mockResolvedValue(undefined);

    const sendToTab = createTabMessageSender({
      log,
      sendMessage,
      injectContentScript,
      waitForContentScriptReady,
    });

    await sendToTab(12, { type: 'translatePage' } as never);

    expect(injectContentScript).toHaveBeenCalledWith(12);
    expect(waitForContentScriptReady).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith('Content script not ready in tab 12, injecting...');
    expect(log.info).toHaveBeenCalledWith('Message delivered to tab 12 after injection');
  });

  it('rethrows non-connection errors without injecting', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const injectContentScript = vi.fn();

    const sendToTab = createTabMessageSender({
      log: createLogger(),
      sendMessage,
      injectContentScript,
      waitForContentScriptReady: vi.fn(),
    });

    await expect(sendToTab(3, { type: 'translatePage' } as never)).rejects.toThrow('Permission denied');
    expect(injectContentScript).not.toHaveBeenCalled();
  });

  it('wraps injection failures with the extension availability message', async () => {
    const log = createLogger();
    const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection'));
    const injectContentScript = vi.fn().mockRejectedValue(new Error('Cannot access chrome:// URL'));

    const sendToTab = createTabMessageSender({
      log,
      sendMessage,
      injectContentScript,
      waitForContentScriptReady: vi.fn(),
    });

    await expect(sendToTab(99, { type: 'translatePage' } as never))
      .rejects
      .toThrow('Translation not available on this page. Cannot access chrome:// URL');
    expect(log.warn).toHaveBeenCalledWith(
      'Cannot inject content script into tab 99: Cannot access chrome:// URL'
    );
  });
});
