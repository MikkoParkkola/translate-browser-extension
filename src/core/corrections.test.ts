/**
 * Tests for Translation Corrections Storage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.storage.local
const mockStorage = new Map<string, unknown>();
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const key of keyArray) {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          }
        }
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(data)) {
          mockStorage.set(key, value);
        }
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const key of keyArray) {
          mockStorage.delete(key);
        }
      }),
    },
  },
};

// Set up chrome mock before imports
vi.stubGlobal('chrome', mockChrome);

// We need to reset the module between tests to clear the cache
// Using dynamic import to reload the module

let correctionsModule: typeof import('./corrections');

describe('Corrections Module', () => {
  beforeEach(async () => {
    // Clear storage
    mockStorage.clear();
    vi.clearAllMocks();

    // Reset modules to clear internal cache
    vi.resetModules();

    // Re-apply the chrome mock after module reset
    vi.stubGlobal('chrome', mockChrome);

    // Dynamically reimport to get fresh module with cleared cache
    correctionsModule = await import('./corrections');
  });

  describe('correctionsModule.addCorrection', () => {
    it('should add a new correction', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].original).toBe('hello');
      expect(corrections[0].machineTranslation).toBe('hei');
      expect(corrections[0].userCorrection).toBe('moi');
      expect(corrections[0].sourceLang).toBe('en');
      expect(corrections[0].targetLang).toBe('fi');
      expect(corrections[0].useCount).toBe(1);
    });

    it('should update existing correction and increment useCount', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');
      await correctionsModule.addCorrection('hello', 'hei', 'terve', 'en', 'fi');

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].userCorrection).toBe('terve');
      expect(corrections[0].useCount).toBe(2);
    });

    it('should skip if correction is same as machine translation', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'hei', 'en', 'fi');

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(0);
    });

    it('should skip empty inputs', async () => {
      await correctionsModule.addCorrection('', 'hei', 'moi', 'en', 'fi');
      await correctionsModule.addCorrection('hello', 'hei', '', 'en', 'fi');

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(0);
    });

    it('should handle case-insensitive matching', async () => {
      await correctionsModule.addCorrection('Hello', 'hei', 'moi', 'en', 'fi');
      await correctionsModule.addCorrection('hello', 'hei', 'terve', 'en', 'fi');

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].userCorrection).toBe('terve');
    });
  });

  describe('correctionsModule.getCorrection', () => {
    it('should return correction if exists', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');

      const correction = await correctionsModule.getCorrection('hello', 'en', 'fi');
      expect(correction).toBe('moi');
    });

    it('should return null if no correction exists', async () => {
      const correction = await correctionsModule.getCorrection('hello', 'en', 'fi');
      expect(correction).toBeNull();
    });

    it('should increment useCount when correction is retrieved', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');

      await correctionsModule.getCorrection('hello', 'en', 'fi');
      await correctionsModule.getCorrection('hello', 'en', 'fi');

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections[0].useCount).toBe(3); // 1 from add + 2 from gets
    });

    it('should handle case-insensitive lookup', async () => {
      await correctionsModule.addCorrection('Hello World', 'hei maailma', 'moi maailma', 'en', 'fi');

      const correction = await correctionsModule.getCorrection('hello world', 'en', 'fi');
      expect(correction).toBe('moi maailma');
    });
  });

  describe('correctionsModule.deleteCorrection', () => {
    it('should delete existing correction', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');

      const deleted = await correctionsModule.deleteCorrection('hello', 'en', 'fi');
      expect(deleted).toBe(true);

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(0);
    });

    it('should return false for non-existent correction', async () => {
      const deleted = await correctionsModule.deleteCorrection('hello', 'en', 'fi');
      expect(deleted).toBe(false);
    });
  });

  describe('correctionsModule.clearCorrections', () => {
    it('should clear all corrections', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');
      await correctionsModule.addCorrection('goodbye', 'hei hei', 'moi moi', 'en', 'fi');

      await correctionsModule.clearCorrections();

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(0);
    });
  });

  describe('correctionsModule.getCorrectionStats', () => {
    it('should return correct statistics', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');
      await correctionsModule.addCorrection('goodbye', 'hei hei', 'moi moi', 'en', 'fi');

      // Use the first correction twice more
      await correctionsModule.getCorrection('hello', 'en', 'fi');
      await correctionsModule.getCorrection('hello', 'en', 'fi');

      const stats = await correctionsModule.getCorrectionStats();
      expect(stats.total).toBe(2);
      expect(stats.totalUses).toBe(4); // hello: 3, goodbye: 1
      expect(stats.topCorrections).toHaveLength(2);
      expect(stats.topCorrections[0].original).toBe('hello');
      expect(stats.topCorrections[0].useCount).toBe(3);
    });
  });

  describe('correctionsModule.exportCorrections', () => {
    it('should export corrections as JSON', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');

      const json = await correctionsModule.exportCorrections();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].original).toBe('hello');
    });
  });

  describe('correctionsModule.importCorrections', () => {
    it('should import corrections from JSON', async () => {
      const json = JSON.stringify([
        {
          original: 'hello',
          machineTranslation: 'hei',
          userCorrection: 'moi',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now(),
          useCount: 5,
        },
      ]);

      const count = await correctionsModule.importCorrections(json);
      expect(count).toBe(1);

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].useCount).toBe(5);
    });

    it('should merge with existing corrections', async () => {
      await correctionsModule.addCorrection('hello', 'hei', 'moi', 'en', 'fi');

      const json = JSON.stringify([
        {
          original: 'goodbye',
          machineTranslation: 'hei hei',
          userCorrection: 'moi moi',
          sourceLang: 'en',
          targetLang: 'fi',
        },
      ]);

      await correctionsModule.importCorrections(json);

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections).toHaveLength(2);
    });

    it('should reject invalid JSON', async () => {
      await expect(correctionsModule.importCorrections('not json')).rejects.toThrow();
    });

    it('should reject non-array JSON', async () => {
      await expect(correctionsModule.importCorrections('{}')).rejects.toThrow('expected array');
    });

    it('should reject entries missing required fields', async () => {
      const json = JSON.stringify([{ original: 'hello' }]); // missing userCorrection, sourceLang, targetLang
      await expect(correctionsModule.importCorrections(json)).rejects.toThrow('missing required fields');
    });

    it('should use defaults for missing machineTranslation, timestamp, useCount', async () => {
      const json = JSON.stringify([
        {
          original: 'test',
          userCorrection: 'testi',
          sourceLang: 'en',
          targetLang: 'fi',
          // no machineTranslation, timestamp, useCount
        },
      ]);
      const count = await correctionsModule.importCorrections(json);
      expect(count).toBe(1);

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections[0].machineTranslation).toBe('');
      expect(corrections[0].useCount).toBe(1);
      expect(corrections[0].timestamp).toBeGreaterThan(0);
    });
  });

  describe('loadCorrections legacy format', () => {
    it('handles legacy object format stored in chrome.storage', async () => {
      // Simulate legacy object format (not array of entries)
      const legacyData = {
        'en:fi:hello': {
          original: 'hello',
          machineTranslation: 'hei',
          userCorrection: 'moi',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now(),
          useCount: 1,
        },
      };
      mockStorage.set('translationCorrections', legacyData);

      const corrections = await correctionsModule.loadCorrections();
      expect(corrections.size).toBe(1);
      expect(corrections.get('en:fi:hello')).toBeDefined();
    });
  });

  describe('addCorrection LRU eviction', () => {
    it('evicts oldest entry when at max capacity (500)', async () => {
      // Mock MAX_CORRECTIONS by filling 500 entries
      // We do this by directly seeding the storage
      const entries: [string, object][] = [];
      const base = Date.now();
      for (let i = 0; i < 500; i++) {
        entries.push([
          `en:fi:word${i}`,
          {
            original: `word${i}`,
            machineTranslation: `trans${i}`,
            userCorrection: `corr${i}`,
            sourceLang: 'en',
            targetLang: 'fi',
            timestamp: base - (500 - i) * 1000, // oldest = word0
            useCount: 1,
          },
        ]);
      }
      mockStorage.set('translationCorrections', entries);

      // Add one more — should evict oldest
      await correctionsModule.addCorrection('newword', 'newtrans', 'newcorr', 'en', 'fi');

      const corrections = await correctionsModule.getAllCorrections();
      expect(corrections.length).toBe(500); // still at 500 (evicted 1, added 1)
      // 'word0' (oldest) should be evicted
      const result = await correctionsModule.getCorrection('word0', 'en', 'fi');
      expect(result).toBeNull();
      // new entry should exist
      const newResult = await correctionsModule.getCorrection('newword', 'en', 'fi');
      expect(newResult).toBe('newcorr');
    });
  });
});
