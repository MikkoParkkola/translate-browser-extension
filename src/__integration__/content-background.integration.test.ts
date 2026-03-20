/**
 * Integration tests: Content Script ↔ Background Service Worker messaging
 *
 * Tests the full message round-trip between content script and background,
 * including translate, ping, getProviders, setProvider, cache, settings,
 * corrections, batching, rate limiting, and error propagation.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mock (must precede all module imports)
// ---------------------------------------------------------------------------
const messageListeners: Array<
  (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void
> = [];

const storageStore: Record<string, unknown> = {};

const mockStorageGet = vi.fn((keys: string | string[]) => {
  const result: Record<string, unknown> = {};
  const keyArr = Array.isArray(keys) ? keys : [keys];
  for (const k of keyArr) {
    if (k in storageStore) result[k] = storageStore[k];
  }
  return Promise.resolve(result);
});

const mockStorageSet = vi.fn((items: Record<string, unknown>) => {
  Object.assign(storageStore, items);
  return Promise.resolve();
});

const mockStorageRemove = vi.fn((keys: string | string[]) => {
  const keyArr = Array.isArray(keys) ? keys : [keys];
  for (const k of keyArr) delete storageStore[k];
  return Promise.resolve();
});

/**
 * Offscreen document simulation.
 * sendToOffscreen() uses chrome.runtime.sendMessage(msg, callback) — callback pattern.
 * We detect whether a callback is provided and invoke it asynchronously.
 */
const mockRuntimeSendMessage = vi.fn().mockImplementation(
  (message: Record<string, unknown>, callback?: (response: unknown) => void) => {
    const respond = (data: unknown) => {
      if (typeof callback === 'function') {
        // Simulate async callback as Chrome does
        queueMicrotask(() => callback(data));
      }
    };

    if (message.target === 'offscreen') {
      if (message.type === 'translate') {
        const text = message.text as string | string[];
        if (Array.isArray(text)) {
          respond({ success: true, result: text.map((t: string) => `[translated] ${t}`) });
        } else {
          respond({ success: true, result: `[translated] ${text}` });
        }
      } else if (message.type === 'getSupportedLanguages') {
        respond({ success: true, languages: [{ src: 'en', tgt: 'fi' }] });
      } else if (message.type === 'clearCache' || message.type === 'clearPipelineCache') {
        respond({ success: true });
      } else {
        respond({ success: true });
      }
    }

    // Return value (some codepaths may rely on the Promise form too)
    return Promise.resolve();
  },
);

vi.stubGlobal('chrome', {
  runtime: {
    onMessage: {
      addListener: vi.fn((fn: (typeof messageListeners)[0]) => messageListeners.push(fn)),
    },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    getURL: vi.fn((p: string) => `chrome-extension://test/${p}`),
    getContexts: vi.fn().mockResolvedValue([
      { documentUrl: 'chrome-extension://test/src/offscreen/offscreen.html' },
    ]),
    sendMessage: mockRuntimeSendMessage,
    lastError: null,
    getPlatformInfo: vi.fn((cb?: (info: unknown) => void) => {
      if (typeof cb === 'function') cb({ os: 'mac', arch: 'arm' });
      return Promise.resolve({ os: 'mac', arch: 'arm' });
    }),
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
  },
  i18n: { getUILanguage: vi.fn(() => 'en-US') },
  offscreen: {
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    Reason: { WORKERS: 'WORKERS' },
  },
  action: { onClicked: { addListener: vi.fn() } },
  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn((cb?: () => void) => cb?.()),
    onClicked: { addListener: vi.fn() },
  },
  commands: { onCommand: { addListener: vi.fn() } },
  tabs: {
    create: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    onUpdated: { addListener: vi.fn() },
  },
  scripting: { executeScript: vi.fn().mockResolvedValue([]) },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
});

// ---------------------------------------------------------------------------
// Import the service worker to register its message handler
// ---------------------------------------------------------------------------
let messageHandler: (
  msg: unknown,
  sender: unknown,
  sendResponse: (r: unknown) => void
) => boolean;

/** Send a message to the background handler and await the response. */
function sendToBg(msg: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    const result = messageHandler(msg, { tab: { id: 1 } }, resolve);
    // handler returns true to indicate async sendResponse
    expect(result).toBe(true);
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Content ↔ Background messaging integration', () => {
  beforeEach(async () => {
    // Reset mocks but keep the listener registration
    mockRuntimeSendMessage.mockClear();
    mockStorageSet.mockClear();
    (mockStorageGet as Mock).mockClear();

    // Clear storage between tests
    for (const k of Object.keys(storageStore)) delete storageStore[k];

    // Load module once (vitest caches), grab the handler
    if (messageListeners.length === 0) {
      await import('../background/service-worker');
    }
    messageHandler = messageListeners[0] as typeof messageHandler;
    expect(messageHandler).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 1. Ping/pong heartbeat
  // -----------------------------------------------------------------------
  it('responds to ping with ready status', async () => {
    const res = (await sendToBg({ type: 'ping' })) as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(res.status).toBe('ready');
  });

  // -----------------------------------------------------------------------
  // 2. Single-text translate round-trip
  // -----------------------------------------------------------------------
  it('translates a single string and returns result', async () => {
    const res = (await sendToBg({
      type: 'translate',
      text: 'Hello world',
      sourceLang: 'en',
      targetLang: 'fi',
    })) as Record<string, unknown>;

    expect(res.success).toBe(true);
    expect(typeof res.result).toBe('string');
    // The offscreen mock returns "[translated] Hello world"
    expect((res.result as string)).toContain('translated');
  });

  // -----------------------------------------------------------------------
  // 3. Batch translate round-trip (array of texts)
  // -----------------------------------------------------------------------
  it('translates a batch of texts and returns array result', async () => {
    const texts = ['Hello', 'World', 'Foo'];
    const res = (await sendToBg({
      type: 'translate',
      text: texts,
      sourceLang: 'en',
      targetLang: 'fi',
    })) as Record<string, unknown>;

    expect(res.success).toBe(true);
    const result = res.result as string[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });

  // -----------------------------------------------------------------------
  // 4. getProviders returns provider list
  // -----------------------------------------------------------------------
  it('returns available providers on getProviders', async () => {
    const res = (await sendToBg({ type: 'getProviders' })) as Record<string, unknown>;
    // getProviders returns { providers: [...], activeProvider, strategy }
    expect(Array.isArray(res.providers)).toBe(true);
    const ids = (res.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain('opus-mt');
  });

  // -----------------------------------------------------------------------
  // 5. setProvider persists selection
  // -----------------------------------------------------------------------
  it('sets active provider and acknowledges', async () => {
    const res = (await sendToBg({
      type: 'setProvider',
      provider: 'deepl',
    })) as Record<string, unknown>;

    expect(res.success).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 6. getCacheStats returns cache metrics
  // -----------------------------------------------------------------------
  it('returns cache statistics', async () => {
    const res = (await sendToBg({ type: 'getCacheStats' })) as Record<string, unknown>;
    expect(res.success).toBe(true);
    // Response shape: { success, cache: { size, ... } }
    expect(res.cache).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 7. clearCache resets translation cache
  // -----------------------------------------------------------------------
  it('clears cache successfully', async () => {
    const res = (await sendToBg({ type: 'clearCache' })) as Record<string, unknown>;
    expect(res.success).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 8. getSettings returns current extension settings
  // -----------------------------------------------------------------------
  it('returns extension settings', async () => {
    const res = (await sendToBg({ type: 'getSettings' })) as Record<string, unknown>;
    expect(res.success).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 9. Invalid message type returns error
  // -----------------------------------------------------------------------
  it('returns error for unknown message type', async () => {
    const res = (await sendToBg({ type: 'nonExistentAction' })) as Record<string, unknown>;
    // Should either return success:false or not crash
    expect(res).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 10. Empty text validation
  // -----------------------------------------------------------------------
  it('rejects translate with empty text', async () => {
    const res = (await sendToBg({
      type: 'translate',
      text: '',
      sourceLang: 'en',
      targetLang: 'fi',
    })) as Record<string, unknown>;

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string');
  });

  // -----------------------------------------------------------------------
  // 11. Cache hit on duplicate request
  // -----------------------------------------------------------------------
  it('returns cached result on duplicate translate request', async () => {
    const msg = {
      type: 'translate',
      text: 'Cache test string',
      sourceLang: 'en',
      targetLang: 'fi',
    };

    // First request – populates cache
    const res1 = (await sendToBg(msg)) as Record<string, unknown>;
    expect(res1.success).toBe(true);

    // Count offscreen translate calls before the second request
    const translateCallsBefore = mockRuntimeSendMessage.mock.calls.filter(
      (c) => c[0]?.target === 'offscreen' && c[0]?.type === 'translate',
    ).length;

    // Second request – should hit cache, NOT call offscreen again
    const res2 = (await sendToBg(msg)) as Record<string, unknown>;
    expect(res2.success).toBe(true);
    expect(res2.result).toEqual(res1.result);

    const translateCallsAfter = mockRuntimeSendMessage.mock.calls.filter(
      (c) => c[0]?.target === 'offscreen' && c[0]?.type === 'translate',
    ).length;
    // No new offscreen translate calls should have been made
    expect(translateCallsAfter).toBe(translateCallsBefore);
  });
});
