/**
 * i18n helper unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { t, getUILanguage } from './i18n';

describe('i18n helper', () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    // Restore chrome
    if (originalChrome) {
      globalThis.chrome = originalChrome;
    }
  });

  describe('t()', () => {
    it('returns message from chrome.i18n when available', () => {
      vi.stubGlobal('chrome', {
        ...originalChrome,
        i18n: {
          getMessage: vi.fn((key: string) => {
            const messages: Record<string, string> = {
              appTitle: 'TRANSLATE!',
              btnSave: 'Save',
            };
            return messages[key] || '';
          }),
        },
      });

      expect(t('appTitle')).toBe('TRANSLATE!');
      expect(t('btnSave')).toBe('Save');
    });

    it('passes substitutions to chrome.i18n.getMessage', () => {
      const getMessage = vi.fn(() => 'Remove DeepL API key?');
      vi.stubGlobal('chrome', {
        ...originalChrome,
        i18n: { getMessage },
      });

      t('confirmRemoveMessage', 'DeepL');
      expect(getMessage).toHaveBeenCalledWith('confirmRemoveMessage', ['DeepL']);
    });

    it('returns key as fallback when chrome.i18n returns empty', () => {
      vi.stubGlobal('chrome', {
        ...originalChrome,
        i18n: {
          getMessage: vi.fn(() => ''),
        },
      });

      expect(t('unknownKey')).toBe('unknownKey');
    });

    it('returns key as fallback when chrome.i18n is unavailable', () => {
      vi.stubGlobal('chrome', {
        ...originalChrome,
        i18n: undefined,
      });

      expect(t('appTitle')).toBe('appTitle');
    });

    it('returns key as fallback when chrome is undefined', () => {
      const saved = globalThis.chrome;
      // @ts-expect-error -- testing fallback
      delete globalThis.chrome;

      expect(t('appTitle')).toBe('appTitle');

      // Restore
      globalThis.chrome = saved;
    });
  });

  describe('getUILanguage()', () => {
    it('returns language from chrome.i18n when available', () => {
      vi.stubGlobal('chrome', {
        ...originalChrome,
        i18n: {
          getUILanguage: vi.fn(() => 'fi'),
        },
      });

      expect(getUILanguage()).toBe('fi');
    });

    it('returns en as fallback', () => {
      vi.stubGlobal('chrome', {
        ...originalChrome,
        i18n: undefined,
      });

      expect(getUILanguage()).toBe('en');
    });
  });
});
