/**
 * Network Status unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
});

describe('onNetworkChange', () => {
  it('returns unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = onNetworkChange(listener);
    expect(typeof unsub).toBe('function');
    unsub();
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
});
