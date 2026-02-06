/**
 * Glossary unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getGlossary,
  addTerm,
  removeTerm,
  clearGlossary,
  applyGlossaryPreProcess,
  applyGlossaryWithPlaceholders,
  restorePlaceholders,
  applyGlossary,
  applyGlossaryBatch,
  exportGlossary,
  importGlossary,
  type GlossaryStore,
} from './glossary';

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

describe('glossary', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    vi.clearAllMocks();
  });

  describe('getGlossary', () => {
    it('returns empty glossary when none exists', async () => {
      const result = await getGlossary();
      expect(result).toEqual({});
    });

    it('returns stored glossary', async () => {
      mockStorage['glossary'] = {
        API: { replacement: 'rajapinta', caseSensitive: true },
      };

      const result = await getGlossary();
      expect(result).toEqual({
        API: { replacement: 'rajapinta', caseSensitive: true },
      });
    });
  });

  describe('addTerm', () => {
    it('adds new term', async () => {
      await addTerm('API', 'rajapinta', true, 'Technical term');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        glossary: {
          API: { replacement: 'rajapinta', caseSensitive: true, description: 'Technical term' },
        },
      });
    });

    it('updates existing term', async () => {
      mockStorage['glossary'] = {
        API: { replacement: 'old', caseSensitive: false },
      };

      await addTerm('API', 'rajapinta', true);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        glossary: {
          API: { replacement: 'rajapinta', caseSensitive: true, description: undefined },
        },
      });
    });

    it('throws on empty term', async () => {
      await expect(addTerm('', 'replacement')).rejects.toThrow('Term and replacement are required');
    });

    it('throws on empty replacement', async () => {
      await expect(addTerm('term', '')).rejects.toThrow('Term and replacement are required');
    });

    it('defaults caseSensitive to false', async () => {
      await addTerm('API', 'rajapinta');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        glossary: {
          API: { replacement: 'rajapinta', caseSensitive: false, description: undefined },
        },
      });
    });
  });

  describe('removeTerm', () => {
    it('removes existing term', async () => {
      mockStorage['glossary'] = {
        API: { replacement: 'rajapinta', caseSensitive: true },
        URL: { replacement: 'osoite', caseSensitive: false },
      };

      await removeTerm('API');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        glossary: {
          URL: { replacement: 'osoite', caseSensitive: false },
        },
      });
    });

    it('handles non-existent term', async () => {
      mockStorage['glossary'] = {};

      await removeTerm('nonexistent');

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('clearGlossary', () => {
    it('removes all terms', async () => {
      mockStorage['glossary'] = {
        API: { replacement: 'rajapinta', caseSensitive: true },
      };

      await clearGlossary();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith('glossary');
    });
  });

  describe('applyGlossaryPreProcess', () => {
    it('replaces terms with replacements', () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const result = applyGlossaryPreProcess('The API is great', glossary);
      expect(result).toBe('The rajapinta is great');
    });

    it('handles case-insensitive replacement', () => {
      const glossary: GlossaryStore = {
        api: { replacement: 'rajapinta', caseSensitive: false },
      };

      const result = applyGlossaryPreProcess('The API is API based', glossary);
      expect(result).toBe('The rajapinta is rajapinta based');
    });

    it('handles case-sensitive replacement', () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: true },
      };

      const result = applyGlossaryPreProcess('The API and api differ', glossary);
      expect(result).toBe('The rajapinta and api differ');
    });

    it('handles multiple terms', () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
        URL: { replacement: 'osoite', caseSensitive: false },
      };

      const result = applyGlossaryPreProcess('The API uses a URL', glossary);
      expect(result).toBe('The rajapinta uses a osoite');
    });

    it('handles longer terms first to avoid partial matches', () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
        'REST API': { replacement: 'REST-rajapinta', caseSensitive: false },
      };

      const result = applyGlossaryPreProcess('The REST API is used', glossary);
      expect(result).toBe('The REST-rajapinta is used');
    });

    it('only matches word boundaries', () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const result = applyGlossaryPreProcess('The APIs and API', glossary);
      // 'APIs' should not match because of the 's'
      expect(result).toBe('The APIs and rajapinta');
    });

    it('returns original text when glossary is empty', () => {
      const result = applyGlossaryPreProcess('The API is great', {});
      expect(result).toBe('The API is great');
    });
  });

  describe('applyGlossaryWithPlaceholders', () => {
    it('replaces terms with placeholders', () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const { text, placeholderMap } = applyGlossaryWithPlaceholders('The API is great', glossary);

      expect(placeholderMap.size).toBe(1);
      expect(text).not.toContain('API');
      expect(text).toContain('\u200B\u2063TERM_');
    });

    it('creates unique placeholders for each occurrence', () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const { placeholderMap } = applyGlossaryWithPlaceholders('API and API', glossary);

      // Two occurrences should create two placeholders
      expect(placeholderMap.size).toBe(2);
    });
  });

  describe('restorePlaceholders', () => {
    it('restores placeholders with replacements', () => {
      const placeholderMap = new Map([
        ['\u200B\u2063TERM_0\u2063\u200B', 'rajapinta'],
      ]);

      const result = restorePlaceholders('The \u200B\u2063TERM_0\u2063\u200B is great', placeholderMap);
      expect(result).toBe('The rajapinta is great');
    });

    it('handles multiple placeholders', () => {
      const placeholderMap = new Map([
        ['\u200B\u2063TERM_0\u2063\u200B', 'rajapinta'],
        ['\u200B\u2063TERM_1\u2063\u200B', 'osoite'],
      ]);

      const result = restorePlaceholders(
        '\u200B\u2063TERM_0\u2063\u200B and \u200B\u2063TERM_1\u2063\u200B',
        placeholderMap
      );
      expect(result).toBe('rajapinta and osoite');
    });

    it('returns original text when no placeholders', () => {
      const result = restorePlaceholders('No placeholders here', new Map());
      expect(result).toBe('No placeholders here');
    });
  });

  describe('applyGlossary', () => {
    it('returns identity function when glossary is empty', async () => {
      const { processedText, restore } = await applyGlossary('The API is great');

      expect(processedText).toBe('The API is great');
      expect(restore('translated')).toBe('translated');
    });

    it('processes and restores correctly', async () => {
      mockStorage['glossary'] = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const { processedText, restore } = await applyGlossary('The API is great');

      // processedText should have placeholder instead of API
      expect(processedText).not.toContain('API');

      // Simulating translation that preserves placeholder
      const simulatedTranslation = processedText.replace('The', 'El').replace('is great', 'es genial');
      const restored = restore(simulatedTranslation);

      expect(restored).toContain('rajapinta');
    });

    it('accepts pre-loaded glossary', async () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const { processedText } = await applyGlossary('The API', glossary);

      expect(processedText).not.toContain('API');
      // Should not have called storage
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });
  });

  describe('applyGlossaryBatch', () => {
    it('processes multiple texts', async () => {
      mockStorage['glossary'] = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const { processedTexts, restoreFns } = await applyGlossaryBatch(['API one', 'API two']);

      expect(processedTexts.length).toBe(2);
      expect(restoreFns.length).toBe(2);

      // Both should have placeholders
      expect(processedTexts[0]).not.toContain('API');
      expect(processedTexts[1]).not.toContain('API');
    });

    it('returns identity functions when glossary is empty', async () => {
      const { processedTexts, restoreFns } = await applyGlossaryBatch(['text one', 'text two']);

      expect(processedTexts).toEqual(['text one', 'text two']);
      expect(restoreFns[0]('test')).toBe('test');
      expect(restoreFns[1]('test')).toBe('test');
    });
  });

  describe('exportGlossary', () => {
    it('exports glossary as JSON', async () => {
      mockStorage['glossary'] = {
        API: { replacement: 'rajapinta', caseSensitive: true },
      };

      const result = await exportGlossary();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        API: { replacement: 'rajapinta', caseSensitive: true },
      });
    });

    it('exports empty object when no glossary', async () => {
      const result = await exportGlossary();
      expect(JSON.parse(result)).toEqual({});
    });
  });

  describe('importGlossary', () => {
    it('imports valid JSON', async () => {
      const json = JSON.stringify({
        API: { replacement: 'rajapinta', caseSensitive: true },
        URL: { replacement: 'osoite', caseSensitive: false },
      });

      const count = await importGlossary(json);

      expect(count).toBe(2);
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });

    it('merges with existing glossary', async () => {
      mockStorage['glossary'] = {
        existing: { replacement: 'olemassa', caseSensitive: false },
      };

      const json = JSON.stringify({
        API: { replacement: 'rajapinta', caseSensitive: true },
      });

      await importGlossary(json);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        glossary: {
          existing: { replacement: 'olemassa', caseSensitive: false },
          API: { replacement: 'rajapinta', caseSensitive: true },
        },
      });
    });

    it('throws on invalid JSON', async () => {
      await expect(importGlossary('not valid json')).rejects.toThrow();
    });

    it('throws on missing replacement', async () => {
      const json = JSON.stringify({
        API: { caseSensitive: true },
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid replacement');
    });

    it('throws on missing caseSensitive', async () => {
      const json = JSON.stringify({
        API: { replacement: 'rajapinta' },
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid caseSensitive');
    });

    it('throws on invalid entry', async () => {
      const json = JSON.stringify({
        API: null,
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid entry');
    });
  });
});
