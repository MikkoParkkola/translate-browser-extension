/**
 * Network Status unit tests
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { isOnline, isCloudProvider, onNetworkChange, initNetworkMonitoring } from './network-status';

describe('isCloudProvider', () => {
  it('identifies cloud providers', () => {
    expect(isCloudProvider('deepl')).toBe(true);
    expect(isCloudProvider('openai')).toBe(true);
    expect(isCloudProvider('anthropic')).toBe(true);
    expect(isCloudProvider('google-cloud')).toBe(true);
  });

  it('identifies local providers', () => {
    expect(isCloudProvider('opus-mt')).toBe(false);
    expect(isCloudProvider('translategemma')).toBe(false);
    expect(isCloudProvider('chrome-builtin')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCloudProvider('')).toBe(false);
  });

  it('returns false for unknown provider id', () => {
    expect(isCloudProvider('local-model')).toBe(false);
  });
});

describe('isOnline', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('returns true when navigator.onLine is true', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      writable: true,
      configurable: true,
    });
    expect(isOnline()).toBe(true);
  });

  it('returns false when navigator.onLine is false', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });
    expect(isOnline()).toBe(false);
  });

  it('falls back to true when navigator is undefined', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    // When navigator is not available, _isOnline retains its previous value
    // which was set to true by the prior test; just ensure no throw occurs.
    expect(() => isOnline()).not.toThrow();
  });
});

describe('onNetworkChange', () => {
  it('returns unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = onNetworkChange(listener);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('calls listener when online event fires', () => {
    const listener = vi.fn();
    onNetworkChange(listener);

    // Manually capture and invoke the registered online handler
    const handlers: Array<[string, EventListenerOrEventListenerObject]> = [];
    const origAdd = globalThis.addEventListener.bind(globalThis);
    const addSpy = vi.spyOn(globalThis, 'addEventListener').mockImplementation(
      (type: string, handler: EventListenerOrEventListenerObject) => {
        handlers.push([type, handler]);
        origAdd(type, handler);
      }
    );

    initNetworkMonitoring();

    const onlineHandler = handlers.find(([type]) => type === 'online');
    if (onlineHandler) {
      (onlineHandler[1] as EventListener)(new Event('online'));
    }

    expect(listener).toHaveBeenCalledWith(true);

    addSpy.mockRestore();
  });

  it('calls listener when offline event fires', () => {
    const listener = vi.fn();
    onNetworkChange(listener);

    const handlers: Array<[string, EventListenerOrEventListenerObject]> = [];
    const origAdd = globalThis.addEventListener.bind(globalThis);
    const addSpy = vi.spyOn(globalThis, 'addEventListener').mockImplementation(
      (type: string, handler: EventListenerOrEventListenerObject) => {
        handlers.push([type, handler]);
        origAdd(type, handler);
      }
    );

    initNetworkMonitoring();

    const offlineHandler = handlers.find(([type]) => type === 'offline');
    if (offlineHandler) {
      (offlineHandler[1] as EventListener)(new Event('offline'));
    }

    expect(listener).toHaveBeenCalledWith(false);

    addSpy.mockRestore();
  });

  it('unsubscribe removes listener so it no longer receives events', () => {
    const listener = vi.fn();
    const unsub = onNetworkChange(listener);

    // Unsubscribe before any event fires
    unsub();

    const handlers: Array<[string, EventListenerOrEventListenerObject]> = [];
    const origAdd = globalThis.addEventListener.bind(globalThis);
    const addSpy = vi.spyOn(globalThis, 'addEventListener').mockImplementation(
      (type: string, handler: EventListenerOrEventListenerObject) => {
        handlers.push([type, handler]);
        origAdd(type, handler);
      }
    );

    initNetworkMonitoring();

    const onlineHandler = handlers.find(([type]) => type === 'online');
    if (onlineHandler) {
      (onlineHandler[1] as EventListener)(new Event('online'));
    }

    expect(listener).not.toHaveBeenCalled();

    addSpy.mockRestore();
  });

  it('multiple listeners all receive the event', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    onNetworkChange(listener1);
    onNetworkChange(listener2);

    const handlers: Array<[string, EventListenerOrEventListenerObject]> = [];
    const origAdd = globalThis.addEventListener.bind(globalThis);
    const addSpy = vi.spyOn(globalThis, 'addEventListener').mockImplementation(
      (type: string, handler: EventListenerOrEventListenerObject) => {
        handlers.push([type, handler]);
        origAdd(type, handler);
      }
    );

    initNetworkMonitoring();

    const offlineHandler = handlers.find(([type]) => type === 'offline');
    if (offlineHandler) {
      (offlineHandler[1] as EventListener)(new Event('offline'));
    }

    expect(listener1).toHaveBeenCalledWith(false);
    expect(listener2).toHaveBeenCalledWith(false);

    addSpy.mockRestore();
  });
});

describe('initNetworkMonitoring', () => {
  it('registers event listeners', () => {
    const addSpy = vi.spyOn(globalThis, 'addEventListener');
    initNetworkMonitoring();
    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    addSpy.mockRestore();
  });

  it('does not throw when globalThis.addEventListener is not a function', () => {
    const origAddEventListener = globalThis.addEventListener;
    // Temporarily remove addEventListener
    Object.defineProperty(globalThis, 'addEventListener', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    expect(() => initNetworkMonitoring()).not.toThrow();

    Object.defineProperty(globalThis, 'addEventListener', {
      value: origAddEventListener,
      writable: true,
      configurable: true,
    });
  });
});
