/**
 * Internationalization helper
 *
 * Thin wrapper around chrome.i18n.getMessage() with fallback for
 * environments where chrome.i18n is not available (tests, dev).
 */

/**
 * Get a localized message by key.
 * Falls back to the key itself if chrome.i18n is unavailable.
 */
export function t(key: string, ...substitutions: string[]): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      const msg = chrome.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
  } catch {
    // Fallback silently
  }

  // Fallback: return the key name in readable form
  return key;
}

/**
 * Get the UI language (e.g., 'en', 'fi', 'de').
 */
export function getUILanguage(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      return chrome.i18n.getUILanguage();
    }
  } catch {
    // Fallback
  }
  return 'en';
}
