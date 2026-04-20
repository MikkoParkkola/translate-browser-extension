import { describe, expect, it, vi } from 'vitest';

import {
  assertNever,
  isAuthorizedExtensionSender,
  isExtensionMessage,
  isHandledExtensionMessage,
  routeHandledExtensionMessage,
  SENSITIVE_EXTENSION_MESSAGE_TYPES,
} from './message-routing';

describe('isExtensionMessage', () => {
  it('accepts objects with a string type', () => {
    expect(isExtensionMessage({ type: 'ping' })).toBe(true);
  });

  it('rejects non-objects and objects without string types', () => {
    expect(isExtensionMessage(null)).toBe(false);
    expect(isExtensionMessage({})).toBe(false);
    expect(isExtensionMessage({ type: 123 })).toBe(false);
  });
});

describe('isHandledExtensionMessage', () => {
  it('accepts messages whose type is in the handled set', () => {
    expect(isHandledExtensionMessage({ type: 'ping' }, ['ping', 'translate'])).toBe(true);
  });

  it('rejects messages whose type is outside the handled set', () => {
    expect(isHandledExtensionMessage({ type: 'ping' }, ['translate'])).toBe(false);
  });
});

describe('SENSITIVE_EXTENSION_MESSAGE_TYPES', () => {
  it('includes internal model-tracking and cloud provider mutation messages', () => {
    expect(SENSITIVE_EXTENSION_MESSAGE_TYPES).toContain('offscreenModelProgress');
    expect(SENSITIVE_EXTENSION_MESSAGE_TYPES).toContain('offscreenDownloadedModelUpdate');
    expect(SENSITIVE_EXTENSION_MESSAGE_TYPES).toContain('setCloudApiKey');
    expect(SENSITIVE_EXTENSION_MESSAGE_TYPES).toContain('clearCloudApiKey');
    expect(SENSITIVE_EXTENSION_MESSAGE_TYPES).toContain('setCloudProviderEnabled');
  });
});

describe('isAuthorizedExtensionSender', () => {
  it('allows sensitive messages from extension pages', () => {
    expect(
      isAuthorizedExtensionSender(
        { type: 'setCloudApiKey', provider: 'deepl', apiKey: 'secret' },
        'chrome-extension://abc/popup.html',
        'chrome-extension://'
      )
    ).toBe(true);
  });

  it('blocks sensitive messages from web pages', () => {
    expect(
      isAuthorizedExtensionSender(
        { type: 'clearCloudApiKey', provider: 'deepl' },
        'https://example.com',
        'chrome-extension://'
      )
    ).toBe(false);
  });

  it('allows non-sensitive messages from web pages', () => {
    expect(
      isAuthorizedExtensionSender(
        { type: 'ping' },
        'https://example.com',
        'chrome-extension://'
      )
    ).toBe(true);
  });
});

describe('routeHandledExtensionMessage', () => {
  it('returns an unknown-message error for unhandled messages', () => {
    const sendResponse = vi.fn();
    const logUnknownMessage = vi.fn();

    const result = routeHandledExtensionMessage({
      message: { type: 'translate', text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      sendResponse,
      isHandledMessage: (message): message is { type: 'ping' } => message.type === 'ping',
      dispatch: vi.fn(),
      logUnknownMessage,
      createErrorResponse: vi.fn(),
    });

    expect(result).toBe(true);
    expect(logUnknownMessage).toHaveBeenCalledWith('translate');
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Unknown message type: translate',
    });
  });

  it('dispatches handled messages and forwards the async response', async () => {
    const sendResponse = vi.fn();

    routeHandledExtensionMessage({
      message: { type: 'ping' },
      sendResponse,
      isHandledMessage: (message): message is { type: 'ping' } => message.type === 'ping',
      dispatch: vi.fn().mockResolvedValue({ success: true, status: 'ready' }),
      createErrorResponse: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: true, status: 'ready' });
    });
  });

  it('uses the shared error factory when dispatch rejects', async () => {
    const sendResponse = vi.fn();
    const createErrorResponse = vi.fn().mockReturnValue({ success: false, error: 'boom' });

    routeHandledExtensionMessage({
      message: { type: 'ping' },
      sendResponse,
      isHandledMessage: (message): message is { type: 'ping' } => message.type === 'ping',
      dispatch: vi.fn().mockRejectedValue(new Error('boom')),
      createErrorResponse,
    });

    await vi.waitFor(() => {
      expect(createErrorResponse).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'boom' });
    });
  });

  it('uses the shared error factory when dispatch throws synchronously', async () => {
    const sendResponse = vi.fn();
    const createErrorResponse = vi.fn().mockReturnValue({ success: false, error: 'boom' });
    const error = new Error('boom');

    routeHandledExtensionMessage({
      message: { type: 'ping' },
      sendResponse,
      isHandledMessage: (message): message is { type: 'ping' } => message.type === 'ping',
      dispatch: vi.fn(() => {
        throw error;
      }),
      createErrorResponse,
    });

    await vi.waitFor(() => {
      expect(createErrorResponse).toHaveBeenCalledWith(error);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'boom' });
    });
  });
});

describe('assertNever', () => {
  it('throws with the unhandled value payload', () => {
    expect(() => assertNever('ping' as never)).toThrow('Unhandled message type');
  });
});
