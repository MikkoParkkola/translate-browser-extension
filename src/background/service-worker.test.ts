/**
 * Service Worker unit tests
 *
 * Tests the message handling and lifecycle events of the background service worker.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Mock chrome API before any imports
const mockAddMessageListener = vi.fn();
const mockAddInstalledListener = vi.fn();
const mockAddClickedListener = vi.fn();
const mockAddStartupListener = vi.fn();
const mockStorageSet = vi.fn();

// Mock offscreen document response
const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    onMessage: {
      addListener: mockAddMessageListener,
    },
    onInstalled: {
      addListener: mockAddInstalledListener,
    },
    onStartup: {
      addListener: mockAddStartupListener,
    },
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    getContexts: vi.fn().mockResolvedValue([
      { documentUrl: 'chrome-extension://test-id/src/offscreen/offscreen.html' },
    ]),
    sendMessage: vi.fn((message, callback) => {
      // Simulate async callback pattern
      const response = mockSendMessage(message);
      if (callback && typeof callback === 'function') {
        Promise.resolve(response).then(callback);
      }
      return response;
    }),
    lastError: null,
    ContextType: {
      OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT',
    },
  },
  i18n: {
    getUILanguage: vi.fn(() => 'en-US'), // Mock browser language as English
  },
  offscreen: {
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    Reason: {
      WORKERS: 'WORKERS',
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
      get: vi.fn((_keys, callback) => {
        // Return empty result by default
        if (callback && typeof callback === 'function') {
          callback({});
        }
        return Promise.resolve({});
      }),
    },
  },
});

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

  beforeEach(() => {
    // Reset mock state between tests
    mockSendMessage.mockReset();
    mockSendMessage.mockReturnValue({ success: true, result: 'translated' });
    vi.mocked(chrome.runtime.sendMessage).mockClear();
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

    it('registers startup handler', () => {
      expect(mockAddStartupListener).toHaveBeenCalled();
    });
  });

  describe('message handling', () => {
    it('handles ping message', async () => {
      const sendResponse = vi.fn();

      messageHandler({ type: 'ping' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        status: 'ready',
        provider: 'opus-mt',
      });
    });

    it('handles getUsage message', async () => {
      const sendResponse = vi.fn();

      messageHandler({ type: 'getUsage' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          throttle: expect.objectContaining({
            requestLimit: 60,
            tokenLimit: 100000,
          }),
        })
      );
    });

    it('handles unknown message type with error', async () => {
      const sendResponse = vi.fn();

      messageHandler({ type: 'unknown' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
    });
  });

  describe('message filtering', () => {
    it('ignores messages targeting offscreen', () => {
      const sendResponse = vi.fn();

      const result = messageHandler(
        { type: 'translate', target: 'offscreen' },
        {},
        sendResponse
      );

      expect(result).toBe(false);
    });
  });

  describe('install handler', () => {
    it('sets default preferences on fresh install with browser language', () => {
      mockStorageSet.mockClear();

      installHandler({ reason: 'install' });

      // Browser language 'en-US' is detected and shortened to 'en'
      expect(mockStorageSet).toHaveBeenCalledWith({
        sourceLang: 'auto',
        targetLang: 'en', // Detected from mocked chrome.i18n.getUILanguage()
        strategy: 'smart',
        provider: 'opus-mt',
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

    it('handles tab without id', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      consoleSpy.mockClear();

      // Tab without id should not log the click message
      actionHandler({});

      // The log with tab ID should not have been called
      const clickLogs = consoleSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('Extension icon clicked')
      );
      expect(clickLogs.length).toBe(0);
    });
  });
});

// Test pure functions extracted from service-worker logic
describe('Service Worker Pure Functions', () => {
  describe('estimateTokens', () => {
    function estimateTokens(text: string | string[]): number {
      const str = Array.isArray(text) ? text.join(' ') : text;
      return Math.max(1, Math.ceil(str.length / 4));
    }

    it('estimates single string', () => {
      expect(estimateTokens('Hello')).toBe(2); // 5 / 4 = 1.25 -> 2
    });

    it('estimates array of strings', () => {
      expect(estimateTokens(['Hello', 'world'])).toBe(3); // 'Hello world' = 11 / 4 = 2.75 -> 3
    });

    it('returns minimum 1 for empty', () => {
      expect(estimateTokens('')).toBe(1);
    });

    it('handles long text', () => {
      expect(estimateTokens('a'.repeat(100))).toBe(25);
    });
  });

  describe('checkRateLimit', () => {
    const RATE_LIMIT = {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      windowMs: 60000,
    };

    interface RateLimitState {
      requests: number;
      tokens: number;
      windowStart: number;
    }

    function checkRateLimit(
      state: RateLimitState,
      tokenEstimate: number,
      now: number
    ): { allowed: boolean; newState: RateLimitState } {
      let newState = { ...state };

      if (now - state.windowStart > RATE_LIMIT.windowMs) {
        newState = { requests: 0, tokens: 0, windowStart: now };
      }

      if (newState.requests >= RATE_LIMIT.requestsPerMinute) {
        return { allowed: false, newState };
      }
      if (newState.tokens + tokenEstimate > RATE_LIMIT.tokensPerMinute) {
        return { allowed: false, newState };
      }

      return { allowed: true, newState };
    }

    it('allows requests under limits', () => {
      const now = Date.now();
      const state: RateLimitState = { requests: 0, tokens: 0, windowStart: now };
      const { allowed } = checkRateLimit(state, 100, now);
      expect(allowed).toBe(true);
    });

    it('allows at edge of request limit', () => {
      const now = Date.now();
      const state: RateLimitState = { requests: 59, tokens: 0, windowStart: now };
      const { allowed } = checkRateLimit(state, 100, now);
      expect(allowed).toBe(true);
    });

    it('denies when request limit reached', () => {
      const now = Date.now();
      const state: RateLimitState = { requests: 60, tokens: 0, windowStart: now };
      const { allowed } = checkRateLimit(state, 100, now);
      expect(allowed).toBe(false);
    });

    it('allows at edge of token limit', () => {
      const now = Date.now();
      const state: RateLimitState = { requests: 0, tokens: 99900, windowStart: now };
      const { allowed } = checkRateLimit(state, 100, now);
      expect(allowed).toBe(true);
    });

    it('denies when token limit would be exceeded', () => {
      const now = Date.now();
      const state: RateLimitState = { requests: 0, tokens: 99950, windowStart: now };
      const { allowed } = checkRateLimit(state, 100, now);
      expect(allowed).toBe(false);
    });

    it('resets after window expires', () => {
      const now = Date.now();
      const state: RateLimitState = {
        requests: 60,
        tokens: 100000,
        windowStart: now - 70000,
      };
      const { allowed, newState } = checkRateLimit(state, 100, now);
      expect(allowed).toBe(true);
      expect(newState.requests).toBe(0);
      expect(newState.tokens).toBe(0);
    });
  });

  describe('error message extraction', () => {
    function extractError(error: unknown): string {
      if (error instanceof Error) return error.message;
      if (typeof error === 'string') return error;
      return JSON.stringify(error) || 'Unknown error';
    }

    it('extracts from Error', () => {
      expect(extractError(new Error('test'))).toBe('test');
    });

    it('returns string directly', () => {
      expect(extractError('direct error')).toBe('direct error');
    });

    it('stringifies objects', () => {
      expect(extractError({ code: 123 })).toBe('{"code":123}');
    });

    it('handles null', () => {
      expect(extractError(null)).toBe('null');
    });

    it('handles undefined', () => {
      expect(extractError(undefined)).toBe('Unknown error');
    });
  });

  describe('cache key generation', () => {
    function getCacheKey(
      text: string | string[],
      sourceLang: string,
      targetLang: string
    ): string {
      const normalizedText = Array.isArray(text) ? text.join('|||') : text;
      return `${sourceLang}:${targetLang}:${normalizedText}`;
    }

    it('generates key for single text', () => {
      expect(getCacheKey('Hello', 'en', 'fi')).toBe('en:fi:Hello');
    });

    it('generates key for array of texts', () => {
      expect(getCacheKey(['Hello', 'World'], 'en', 'fi')).toBe(
        'en:fi:Hello|||World'
      );
    });

    it('handles empty text', () => {
      expect(getCacheKey('', 'en', 'fi')).toBe('en:fi:');
    });

    it('handles empty array', () => {
      expect(getCacheKey([], 'en', 'fi')).toBe('en:fi:');
    });
  });
});
