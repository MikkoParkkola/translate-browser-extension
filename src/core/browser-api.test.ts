/**
 * Browser API compatibility layer unit tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Set up chrome global BEFORE module import via vi.hoisted
// vi.hoisted runs before any imports in the file
vi.hoisted(() => {
  const mockChromeObj = {
    runtime: {
      getURL: (path: string) => `chrome-extension://mock-id/${path}`,
      sendMessage: () => Promise.resolve(),
      onMessage: {
        addListener: () => {},
      },
    },
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        clear: () => Promise.resolve(),
      },
    },
  };
  (globalThis as Record<string, unknown>).chrome = mockChromeObj;
});

// Now we can safely import - chrome is already defined
import {
  browserAPI,
  isFirefox,
  isChrome,
  getURL,
  sendMessage,
  onMessage,
  storage,
  getPlatform,
} from './browser-api';

// Spy on the actual chrome functions after import
const chromeRuntime = (globalThis as Record<string, unknown>).chrome as {
  runtime: {
    getURL: (path: string) => string;
    sendMessage: (msg: unknown) => Promise<unknown>;
    onMessage: { addListener: (cb: unknown) => void };
  };
  storage: {
    local: {
      get: (keys: string | string[]) => Promise<unknown>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
      clear: () => Promise<void>;
    };
  };
};

describe('browserAPI', () => {
  it('exports a browser API object', () => {
    expect(browserAPI).toBeDefined();
    expect(browserAPI.runtime).toBeDefined();
    expect(browserAPI.storage).toBeDefined();
  });

  it('uses chrome when browser global is not defined', () => {
    // In test environment, browser is undefined, so it should fall back to chrome
    expect(browserAPI).toBe(chromeRuntime);
  });
});

describe('isFirefox', () => {
  it('returns false when browser global is not defined', () => {
    expect(isFirefox()).toBe(false);
  });
});

describe('isChrome', () => {
  it('returns true when chrome is defined and not Firefox', () => {
    expect(isChrome()).toBe(true);
  });
});

describe('getURL', () => {
  it('calls runtime.getURL with the path', () => {
    const result = getURL('popup.html');
    expect(result).toBe('chrome-extension://mock-id/popup.html');
  });

  it('handles paths with leading slash', () => {
    const result = getURL('/assets/icon.png');
    expect(result).toBe('chrome-extension://mock-id//assets/icon.png');
  });

  it('handles empty path', () => {
    const result = getURL('');
    expect(result).toBe('chrome-extension://mock-id/');
  });
});

describe('sendMessage', () => {
  it('returns a promise', () => {
    const result = sendMessage({ type: 'test' });
    expect(result).toBeInstanceOf(Promise);
  });
});

describe('onMessage', () => {
  it('does not throw when registering a callback', () => {
    const callback = vi.fn();
    expect(() => onMessage(callback)).not.toThrow();
  });
});

describe('storage', () => {
  describe('get', () => {
    it('returns a promise', async () => {
      const result = storage.get('test');
      expect(result).toBeInstanceOf(Promise);
      const resolved = await result;
      expect(resolved).toBeDefined();
    });
  });

  describe('set', () => {
    it('returns a promise', () => {
      const result = storage.set({ key: 'value' });
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('remove', () => {
    it('returns a promise', () => {
      const result = storage.remove('key');
      expect(result).toBeInstanceOf(Promise);
    });

    it('accepts array of keys', () => {
      const result = storage.remove(['a', 'b']);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('clear', () => {
    it('returns a promise', () => {
      const result = storage.clear();
      expect(result).toBeInstanceOf(Promise);
    });
  });
});

describe('getPlatform', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('returns chrome for Chrome user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    expect(getPlatform()).toBe('chrome');
  });

  it('returns firefox for Firefox user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      configurable: true,
    });
    expect(getPlatform()).toBe('firefox');
  });

  it('returns edge for Edge user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      configurable: true,
    });
    expect(getPlatform()).toBe('edge');
  });

  it('returns unknown for unrecognized user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'CustomBrowser/1.0',
      configurable: true,
    });
    expect(getPlatform()).toBe('unknown');
  });
});
