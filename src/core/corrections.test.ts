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
  });
});
