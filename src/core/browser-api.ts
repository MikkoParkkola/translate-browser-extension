/**
 * Browser API Compatibility Layer
 *
 * Provides a unified API that works across Chrome, Firefox, and Edge.
 * Firefox uses the Promise-based browser.* API natively.
 * Chrome uses the callback-based chrome.* API (with Promise wrappers in newer versions).
 *
 * This module exports a `browserAPI` object that normalizes these differences.
 */

// Type declaration for browser.* (Firefox WebExtension API)
declare const browser: typeof chrome | undefined;

/**
 * Get the appropriate browser API object.
 * Firefox exposes `browser`, Chrome/Edge expose `chrome`.
 * Modern Chrome also supports `chrome` with Promises, so we prefer `browser` if available
 * as it's guaranteed to be Promise-based.
 */
export const browserAPI: typeof chrome =
  typeof browser !== 'undefined' ? browser : chrome;

/**
 * Check if running in Firefox
 */
export function isFirefox(): boolean {
  return typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
}

/**
 * Check if running in Chrome/Chromium
 */
export function isChrome(): boolean {
  return typeof chrome !== 'undefined' && !isFirefox();
}

/**
 * Get extension URL for a resource
 */
export function getURL(path: string): string {
  return browserAPI.runtime.getURL(path);
}

/**
 * Send a message to the background script
 */
export function sendMessage<T = unknown>(message: unknown): Promise<T> {
  return browserAPI.runtime.sendMessage(message);
}

/**
 * Listen for messages
 */
export function onMessage(
  callback: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => boolean | void | Promise<unknown>
): void {
  browserAPI.runtime.onMessage.addListener(callback);
}

/**
 * Storage API wrappers (local storage)
 */
export const storage = {
  async get<T = Record<string, unknown>>(keys: string | string[]): Promise<T> {
    return browserAPI.storage.local.get(keys) as Promise<T>;
  },

  async set(items: Record<string, unknown>): Promise<void> {
    return browserAPI.storage.local.set(items);
  },

  async remove(keys: string | string[]): Promise<void> {
    return browserAPI.storage.local.remove(keys);
  },

  async clear(): Promise<void> {
    return browserAPI.storage.local.clear();
  },
};

/**
 * Get the current platform (for debugging)
 */
export function getPlatform(): 'firefox' | 'chrome' | 'edge' | 'unknown' {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Chrome')) return 'chrome';
  return 'unknown';
}
