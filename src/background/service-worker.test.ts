/**
 * Service Worker unit tests
 *
 * Tests the message handling and lifecycle events of the background service worker.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock chrome API before any imports
const mockAddMessageListener = vi.fn();
const mockAddInstalledListener = vi.fn();
const mockAddClickedListener = vi.fn();
const mockStorageSet = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    onMessage: {
      addListener: mockAddMessageListener,
    },
    onInstalled: {
      addListener: mockAddInstalledListener,
    },
  },
  action: {
    onClicked: {
      addListener: mockAddClickedListener,
    },
  },
  storage: {
    local: {
      set: mockStorageSet,
    },
  },
});

// Mock translation router
vi.mock('../core/translation-router', () => ({
  translationRouter: {
    initialize: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockResolvedValue('translated'),
    setStrategy: vi.fn(),
    getStrategy: vi.fn().mockReturnValue('balanced'),
    listProviders: vi.fn().mockReturnValue([
      { id: 'opus-mt-local', name: 'OPUS-MT', type: 'local' },
    ]),
    getStats: vi.fn().mockReturnValue({ 'opus-mt-local': 5 }),
  },
}));

// Mock throttle
vi.mock('../core/throttle', () => ({
  throttle: {
    runWithRetry: vi.fn().mockImplementation((fn) => fn()),
    getUsage: vi.fn().mockReturnValue({
      requests: 10,
      tokens: 500,
      queue: 0,
    }),
  },
}));

describe('Service Worker', () => {
  let messageHandler: (
    message: unknown,
    sender: unknown,
    sendResponse: (response: unknown) => void
  ) => boolean;
  let installHandler: (details: { reason: string; previousVersion?: string }) => void;
  let actionHandler: (tab: { id?: number }) => void;

  beforeAll(async () => {
    // Import module to trigger registration
    await import('./service-worker');

    // Capture handlers
    messageHandler = mockAddMessageListener.mock.calls[0]?.[0];
    installHandler = mockAddInstalledListener.mock.calls[0]?.[0];
    actionHandler = mockAddClickedListener.mock.calls[0]?.[0];
  });

  describe('initialization', () => {
    it('registers message handler', () => {
      expect(mockAddMessageListener).toHaveBeenCalled();
      expect(messageHandler).toBeDefined();
    });

    it('registers install handler', () => {
      expect(mockAddInstalledListener).toHaveBeenCalled();
      expect(installHandler).toBeDefined();
    });

    it('registers action click handler', () => {
      expect(mockAddClickedListener).toHaveBeenCalled();
      expect(actionHandler).toBeDefined();
    });
  });

  describe('message handling', () => {
    it('handles translate message', async () => {
      const sendResponse = vi.fn();

      const result = messageHandler(
        {
          type: 'translate',
          text: 'Hello',
          sourceLang: 'en',
          targetLang: 'fi',
        },
        {},
        sendResponse
      );

      expect(result).toBe(true); // Async response

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          result: 'translated',
        })
      );
    });

    it('handles getUsage message', async () => {
      const sendResponse = vi.fn();

      messageHandler({ type: 'getUsage' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        throttle: expect.objectContaining({ requests: 10 }),
        providers: expect.any(Object),
      });
    });

    it('handles getProviders message', async () => {
      const sendResponse = vi.fn();

      messageHandler({ type: 'getProviders' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        providers: expect.arrayContaining([
          expect.objectContaining({ id: 'opus-mt-local' }),
        ]),
        strategy: 'balanced',
      });
    });

    it('handles unknown message type with error', async () => {
      const sendResponse = vi.fn();

      messageHandler({ type: 'unknown' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Unknown message type'),
      });
    });

    it('handles translate with strategy option', async () => {
      const { translationRouter } = await import('../core/translation-router');
      const sendResponse = vi.fn();

      messageHandler(
        {
          type: 'translate',
          text: 'Hello',
          sourceLang: 'en',
          targetLang: 'fi',
          options: { strategy: 'fast' },
        },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(translationRouter.setStrategy).toHaveBeenCalledWith('fast');
    });

    it('handles translation error', async () => {
      const { throttle } = await import('../core/throttle');
      vi.mocked(throttle.runWithRetry).mockRejectedValueOnce(new Error('Translation failed'));

      const sendResponse = vi.fn();

      messageHandler(
        {
          type: 'translate',
          text: 'Hello',
          sourceLang: 'en',
          targetLang: 'fi',
        },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Translation failed',
        })
      );
    });
  });

  describe('install handler', () => {
    it('sets default preferences on fresh install', () => {
      mockStorageSet.mockClear();

      installHandler({ reason: 'install' });

      expect(mockStorageSet).toHaveBeenCalledWith({
        sourceLang: 'auto',
        targetLang: 'fi',
        strategy: 'smart',
      });
    });

    it('does not set preferences on update', () => {
      mockStorageSet.mockClear();

      installHandler({ reason: 'update', previousVersion: '1.0.0' });

      expect(mockStorageSet).not.toHaveBeenCalled();
    });
  });

  describe('action click handler', () => {
    it('logs tab id when clicked', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      actionHandler({ id: 123 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Extension icon clicked'),
        123
      );
    });
  });
});
