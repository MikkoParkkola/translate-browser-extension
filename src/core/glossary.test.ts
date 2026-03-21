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

  describe('storage error paths', () => {
    it('getGlossary returns empty object when storage.get throws', async () => {
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('get error'));
      const result = await getGlossary();
      expect(result).toEqual({});
    });

    it('addTerm rethrows when storage.set throws', async () => {
      (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('set error'));
      await expect(addTerm('API', 'rajapinta')).rejects.toThrow('set error');
    });

    it('removeTerm rethrows when storage.set throws', async () => {
      (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('set error'));
      await expect(removeTerm('API')).rejects.toThrow('set error');
    });

    it('clearGlossary rethrows when storage.remove throws', async () => {
      (chrome.storage.local.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('remove error'));
      await expect(clearGlossary()).rejects.toThrow('remove error');
    });
  });

  describe('applyGlossaryBatch with pre-loaded glossary', () => {
    it('uses provided glossary instead of loading from storage', async () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const { processedTexts, restoreFns } = await applyGlossaryBatch(
        ['The API works', 'API test'],
        glossary
      );

      expect(processedTexts[0]).not.toContain('API');
      expect(processedTexts[1]).not.toContain('API');
      expect(restoreFns.length).toBe(2);
      // Should not have called storage
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('restoreFns correctly restore placeholders in translated text', async () => {
      const glossary: GlossaryStore = {
        API: { replacement: 'rajapinta', caseSensitive: false },
      };

      const { processedTexts, restoreFns } = await applyGlossaryBatch(
        ['The API is ready', 'Check the API docs'],
        glossary
      );

      // processedTexts should have placeholders instead of 'API'
      expect(processedTexts[0]).not.toContain('API');
      expect(processedTexts[1]).not.toContain('API');

      // Simulate translated text where placeholder survived translation
      // restoreFns should replace the placeholder with 'rajapinta'
      const restored0 = restoreFns[0](processedTexts[0].replace('The', 'Das').replace('is ready', 'ist bereit'));
      expect(restored0).toContain('rajapinta');

      const restored1 = restoreFns[1](processedTexts[1].replace('Check the', 'Überprüfen Sie die').replace('docs', 'Dokumentation'));
      expect(restored1).toContain('rajapinta');
    });
  });

  describe('Additional glossary functionality coverage', () => {
    it('applyGlossaryPreProcess handles word boundary matching', () => {
      const glossary: GlossaryStore = {
        'API': { replacement: 'rajapinta', caseSensitive: false },
        'REST': { replacement: 'REST-arkkitehtuuri', caseSensitive: false },
      };

      const result = applyGlossaryPreProcess('Learn REST API basics today', glossary);
      expect(result).toContain('REST-arkkitehtuuri');
      expect(result).toContain('rajapinta');
    });

    it('applyGlossaryPreProcess preserves text outside word boundaries', () => {
      const glossary: GlossaryStore = {
        test: { replacement: 'exam', caseSensitive: false },
      };

      // "testing" contains "test" but should not match due to word boundary
      const result = applyGlossaryPreProcess('testing the test method', glossary);
      expect(result).toContain('testing');
      expect(result).toContain('exam');
    });

    it('importGlossary accepts numeric keys from JSON parsing', async () => {
      // JavaScript object keys are always strings after JSON parsing
      // Even if the JSON contains numeric-like keys, they become strings
      const json = JSON.stringify({
        API: { replacement: 'rajapinta', caseSensitive: true },
        URL: { replacement: 'osoite', caseSensitive: false },
      });

      const count = await importGlossary(json);
      expect(count).toBe(2);
    });

    it('getGlossary handles undefined storage key', async () => {
      // Ensure storage returns result without the key
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      
      const result = await getGlossary();
      expect(result).toEqual({});
    });

    it('addTerm handles storage set with existing data', async () => {
      mockStorage['glossary'] = {
        URL: { replacement: 'osoite', caseSensitive: false },
      };

      await addTerm('API', 'rajapinta', true);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        glossary: expect.objectContaining({
          API: { replacement: 'rajapinta', caseSensitive: true, description: undefined },
          URL: { replacement: 'osoite', caseSensitive: false },
        }),
      });
    });

    it('importGlossary validates replacement is string type', async () => {
      const json = JSON.stringify({
        API: { replacement: 123, caseSensitive: true },
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid replacement');
    });

    it('applyGlossaryWithPlaceholders maintains order of terms', () => {
      const glossary: GlossaryStore = {
        foo: { replacement: 'FOO', caseSensitive: false },
        foobar: { replacement: 'FOOBAR', caseSensitive: false },
      };

      // Longer term (foobar) should be matched first due to sort order
      const { text, placeholderMap } = applyGlossaryWithPlaceholders('This is foobar and foo', glossary);
      
      // Should have two separate placeholders
      expect(placeholderMap.size).toBe(2);
      expect(text).not.toContain('foobar');
      expect(text).not.toContain('foo');
    });

    it('restorePlaceholders handles empty map gracefully', () => {
      const result = restorePlaceholders('Text with placeholder \u200B\u2063TERM_0\u2063\u200B here', new Map());
      // Should return text unchanged since placeholder is not in map
      expect(result).toContain('\u200B\u2063TERM_0\u2063\u200B');
    });

    it('exportGlossary handles complex glossary entries', async () => {
      mockStorage['glossary'] = {
        'REST API': { replacement: 'REST-rajapinta', caseSensitive: true, description: 'REST APIs' },
        'JSON': { replacement: 'JSON-muoto', caseSensitive: true, description: 'Data format' },
      };

      const result = await exportGlossary();
      const parsed = JSON.parse(result);

      expect(Object.keys(parsed)).toHaveLength(2);
      expect(parsed['REST API'].description).toBe('REST APIs');
      expect(parsed['JSON'].description).toBe('Data format');
    });

    it('applyGlossaryBatch returns correct number of restore functions', async () => {
      const glossary: GlossaryStore = {
        test: { replacement: 'exam', caseSensitive: false },
      };

      const { processedTexts, restoreFns } = await applyGlossaryBatch(
        ['test one', 'test two', 'test three'],
        glossary
      );

      expect(processedTexts.length).toBe(3);
      expect(restoreFns.length).toBe(3);
    });

    it('importGlossary handles case-sensitive flag correctly', async () => {
      const json = JSON.stringify({
        API: { replacement: 'rajapinta', caseSensitive: true },
        url: { replacement: 'osoite', caseSensitive: false },
      });

      const count = await importGlossary(json);
      expect(count).toBe(2);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const callArgs = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.glossary['API'].caseSensitive).toBe(true);
      expect(callArgs.glossary['url'].caseSensitive).toBe(false);
    });

    it('importGlossary validates entry is object', async () => {
      const json = JSON.stringify({
        term: null,
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid entry');
    });

    it('importGlossary validates replacement string', async () => {
      const json = JSON.stringify({
        term: { replacement: 123, caseSensitive: false },
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid replacement');
    });

    it('importGlossary validates caseSensitive boolean', async () => {
      const json = JSON.stringify({
        term: { replacement: 'test', caseSensitive: 'true' },
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid caseSensitive');
    });

    it('throws on non-object entry value (number)', async () => {
      const json = JSON.stringify({
        API: 42,
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid entry for term: API');
    });

    it('throws on non-object entry value (string)', async () => {
      const json = JSON.stringify({
        API: 'not an object',
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid entry for term: API');
    });

    it('throws on non-object entry value (array)', async () => {
      const json = JSON.stringify({
        API: ['not', 'an', 'object'],
      });

      // Arrays have typeof 'object' and are not null, so they pass the entry check
      // but fail on replacement check since entry.replacement is undefined
      await expect(importGlossary(json)).rejects.toThrow('Invalid replacement for term: API');
    });

    it('throws on non-string replacement value', async () => {
      const json = JSON.stringify({
        API: { replacement: 123, caseSensitive: true },
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid replacement for term: API');
    });

    it('throws on non-boolean caseSensitive value (string)', async () => {
      const json = JSON.stringify({
        API: { replacement: 'rajapinta', caseSensitive: 'yes' },
      });

      await expect(importGlossary(json)).rejects.toThrow('Invalid caseSensitive for term: API');
    });
  });
});
