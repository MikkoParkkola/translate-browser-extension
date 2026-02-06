/**
 * Site rules unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  matchesPattern,
  findMatchingRule,
  getRules,
  setRules,
  clearRules,
  getAllRules,
  clearAllRules,
  exportRules,
  importRules,
  type SiteRulesStore,
} from './site-rules';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((keys: string | string[]) => {
        const key = Array.isArray(keys) ? keys[0] : keys;
        return Promise.resolve({ [key]: mockStorage[key] });
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
      remove: vi.fn((key: string) => {
        delete mockStorage[key];
        return Promise.resolve();
      }),
    },
  },
});

describe('site-rules', () => {
  beforeEach(() => {
    // Clear mock storage before each test
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    vi.clearAllMocks();
  });

  describe('matchesPattern', () => {
    it('matches exact hostname', () => {
      expect(matchesPattern('example.com', 'example.com')).toBe(true);
      expect(matchesPattern('example.com', 'other.com')).toBe(false);
    });

    it('matches wildcard pattern for subdomains', () => {
      expect(matchesPattern('www.example.com', '*.example.com')).toBe(true);
      expect(matchesPattern('sub.example.com', '*.example.com')).toBe(true);
      expect(matchesPattern('deep.sub.example.com', '*.example.com')).toBe(true);
    });

    it('matches wildcard pattern for base domain', () => {
      expect(matchesPattern('example.com', '*.example.com')).toBe(true);
    });

    it('does not match unrelated domains with wildcard', () => {
      expect(matchesPattern('other.com', '*.example.com')).toBe(false);
      expect(matchesPattern('example.com.evil.com', '*.example.com')).toBe(false);
    });

    it('handles edge cases', () => {
      expect(matchesPattern('', '')).toBe(true);
      expect(matchesPattern('a.b.c', '*.b.c')).toBe(true);
      expect(matchesPattern('b.c', '*.b.c')).toBe(true);
    });
  });

  describe('findMatchingRule', () => {
    it('prefers exact match over wildcard', () => {
      const rules: SiteRulesStore = {
        '*.example.com': { autoTranslate: true },
        'www.example.com': { autoTranslate: false },
      };

      const result = findMatchingRule('www.example.com', rules);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('www.example.com');
      expect(result!.rules.autoTranslate).toBe(false);
    });

    it('falls back to wildcard when no exact match', () => {
      const rules: SiteRulesStore = {
        '*.example.com': { autoTranslate: true },
      };

      const result = findMatchingRule('api.example.com', rules);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('*.example.com');
      expect(result!.rules.autoTranslate).toBe(true);
    });

    it('returns null when no match found', () => {
      const rules: SiteRulesStore = {
        'example.com': { autoTranslate: true },
      };

      const result = findMatchingRule('other.com', rules);
      expect(result).toBeNull();
    });

    it('handles empty rules', () => {
      const result = findMatchingRule('example.com', {});
      expect(result).toBeNull();
    });

    it('selects more specific wildcard pattern', () => {
      const rules: SiteRulesStore = {
        '*.com': { autoTranslate: false },
        '*.example.com': { autoTranslate: true },
      };

      const result = findMatchingRule('www.example.com', rules);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('*.example.com');
      expect(result!.rules.autoTranslate).toBe(true);
    });
  });

  describe('getRules', () => {
    it('returns rules for matching hostname', async () => {
      mockStorage['siteRules'] = {
        'example.com': { autoTranslate: true, sourceLang: 'en', targetLang: 'fi' },
      };

      const result = await getRules('example.com');
      expect(result).not.toBeNull();
      expect(result!.autoTranslate).toBe(true);
      expect(result!.sourceLang).toBe('en');
      expect(result!.targetLang).toBe('fi');
    });

    it('returns null for non-matching hostname', async () => {
      mockStorage['siteRules'] = {
        'example.com': { autoTranslate: true },
      };

      const result = await getRules('other.com');
      expect(result).toBeNull();
    });

    it('returns null when no rules exist', async () => {
      const result = await getRules('example.com');
      expect(result).toBeNull();
    });

    it('matches wildcard rules', async () => {
      mockStorage['siteRules'] = {
        '*.example.com': { autoTranslate: true },
      };

      const result = await getRules('www.example.com');
      expect(result).not.toBeNull();
      expect(result!.autoTranslate).toBe(true);
    });
  });

  describe('setRules', () => {
    it('creates new rules', async () => {
      await setRules('example.com', { autoTranslate: true });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        siteRules: {
          'example.com': { autoTranslate: true },
        },
      });
    });

    it('updates existing rules', async () => {
      mockStorage['siteRules'] = {
        'example.com': { autoTranslate: false },
        'other.com': { autoTranslate: true },
      };

      await setRules('example.com', { autoTranslate: true, sourceLang: 'en' });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        siteRules: {
          'example.com': { autoTranslate: true, sourceLang: 'en' },
          'other.com': { autoTranslate: true },
        },
      });
    });

    it('supports wildcard patterns', async () => {
      await setRules('*.example.com', { autoTranslate: true });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        siteRules: {
          '*.example.com': { autoTranslate: true },
        },
      });
    });
  });

  describe('clearRules', () => {
    it('removes rules for specific hostname', async () => {
      mockStorage['siteRules'] = {
        'example.com': { autoTranslate: true },
        'other.com': { autoTranslate: false },
      };

      await clearRules('example.com');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        siteRules: {
          'other.com': { autoTranslate: false },
        },
      });
    });

    it('handles non-existent hostname', async () => {
      mockStorage['siteRules'] = {
        'example.com': { autoTranslate: true },
      };

      await clearRules('nonexistent.com');

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('getAllRules', () => {
    it('returns all rules', async () => {
      const rules = {
        'example.com': { autoTranslate: true },
        '*.other.com': { autoTranslate: false },
      };
      mockStorage['siteRules'] = rules;

      const result = await getAllRules();
      expect(result).toEqual(rules);
    });

    it('returns empty object when no rules exist', async () => {
      const result = await getAllRules();
      expect(result).toEqual({});
    });
  });

  describe('clearAllRules', () => {
    it('removes all rules', async () => {
      mockStorage['siteRules'] = {
        'example.com': { autoTranslate: true },
        'other.com': { autoTranslate: false },
      };

      await clearAllRules();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith('siteRules');
    });
  });

  describe('exportRules', () => {
    it('exports rules as JSON string', async () => {
      mockStorage['siteRules'] = {
        'example.com': { autoTranslate: true, sourceLang: 'en' },
      };

      const result = await exportRules();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        'example.com': { autoTranslate: true, sourceLang: 'en' },
      });
    });

    it('exports empty object when no rules', async () => {
      const result = await exportRules();
      expect(JSON.parse(result)).toEqual({});
    });
  });

  describe('importRules', () => {
    it('imports valid JSON', async () => {
      const json = JSON.stringify({
        'example.com': { autoTranslate: true },
        '*.other.com': { autoTranslate: false },
      });

      const count = await importRules(json);

      expect(count).toBe(2);
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });

    it('merges with existing rules', async () => {
      mockStorage['siteRules'] = {
        'existing.com': { autoTranslate: true },
      };

      const json = JSON.stringify({
        'new.com': { autoTranslate: false },
      });

      await importRules(json);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        siteRules: {
          'existing.com': { autoTranslate: true },
          'new.com': { autoTranslate: false },
        },
      });
    });

    it('throws on invalid JSON', async () => {
      await expect(importRules('not valid json')).rejects.toThrow();
    });

    it('throws on invalid structure', async () => {
      const json = JSON.stringify({
        'example.com': { notAutoTranslate: true },
      });

      await expect(importRules(json)).rejects.toThrow('Invalid autoTranslate');
    });

    it('throws on invalid rules object', async () => {
      const json = JSON.stringify({
        'example.com': null,
      });

      await expect(importRules(json)).rejects.toThrow('Invalid rules');
    });
  });
});
