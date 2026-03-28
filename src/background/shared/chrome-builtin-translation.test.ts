import { describe, it, expect, vi } from 'vitest';
import {
  createChromeBuiltinTranslationRunner,
  type ChromeBuiltinTranslationDeps,
} from './chrome-builtin-translation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDeps(
  overrides: Partial<ChromeBuiltinTranslationDeps> = {}
): ChromeBuiltinTranslationDeps {
  return {
    getActiveTabId: vi.fn().mockResolvedValue(1),
    executeTranslationScript: vi.fn().mockResolvedValue(['translated']),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createChromeBuiltinTranslationRunner', () => {
  describe('active-tab guard', () => {
    it('throws when getActiveTabId returns undefined (no open tab)', async () => {
      const run = createChromeBuiltinTranslationRunner(
        createDeps({ getActiveTabId: vi.fn().mockResolvedValue(undefined) })
      );
      await expect(run('Hello', 'en', 'fi')).rejects.toThrow(
        'No active tab for Chrome Translator'
      );
    });

    it('throws when getActiveTabId returns 0 (falsy tab id)', async () => {
      const run = createChromeBuiltinTranslationRunner(
        createDeps({ getActiveTabId: vi.fn().mockResolvedValue(0) })
      );
      await expect(run('Hello', 'en', 'fi')).rejects.toThrow(
        'No active tab for Chrome Translator'
      );
    });
  });

  describe('script result guard', () => {
    it('throws when executeTranslationScript returns undefined', async () => {
      const run = createChromeBuiltinTranslationRunner(
        createDeps({ executeTranslationScript: vi.fn().mockResolvedValue(undefined) })
      );
      await expect(run('Hello', 'en', 'de')).rejects.toThrow(
        'Chrome Translator returned no result'
      );
    });
  });

  describe('string input', () => {
    it('returns a single string when text is a string', async () => {
      const run = createChromeBuiltinTranslationRunner(createDeps());
      const result = await run('Hello', 'en', 'fi');
      expect(result).toBe('translated');
    });

    it('forwards the single text wrapped in an array to executeTranslationScript', async () => {
      const executeTranslationScript = vi.fn().mockResolvedValue(['Hei']);
      const run = createChromeBuiltinTranslationRunner(
        createDeps({ executeTranslationScript })
      );
      await run('Hello', 'en', 'fi');
      expect(executeTranslationScript).toHaveBeenCalledWith(1, ['Hello'], 'en', 'fi');
    });
  });

  describe('array input', () => {
    it('returns an array when text is an array', async () => {
      const executeTranslationScript = vi.fn().mockResolvedValue(['Hei', 'Maailma']);
      const run = createChromeBuiltinTranslationRunner(
        createDeps({ executeTranslationScript })
      );
      const result = await run(['Hello', 'World'], 'en', 'fi');
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('forwards the array as-is to executeTranslationScript', async () => {
      const executeTranslationScript = vi.fn().mockResolvedValue(['a', 'b']);
      const run = createChromeBuiltinTranslationRunner(
        createDeps({ executeTranslationScript })
      );
      await run(['one', 'two'], 'en', 'de');
      expect(executeTranslationScript).toHaveBeenCalledWith(1, ['one', 'two'], 'en', 'de');
    });

    it('handles array containing empty strings without throwing', async () => {
      const executeTranslationScript = vi.fn().mockResolvedValue(['', 'Hei']);
      const run = createChromeBuiltinTranslationRunner(
        createDeps({ executeTranslationScript })
      );
      const result = await run(['', 'Hello'], 'en', 'fi');
      expect(Array.isArray(result)).toBe(true);
      expect((result as string[])[1]).toBe('Hei');
    });
  });

  describe('dependency wiring', () => {
    it('passes the tabId returned by getActiveTabId to executeTranslationScript', async () => {
      const executeTranslationScript = vi.fn().mockResolvedValue(['ok']);
      const run = createChromeBuiltinTranslationRunner(
        createDeps({
          getActiveTabId: vi.fn().mockResolvedValue(42),
          executeTranslationScript,
        })
      );
      await run('text', 'en', 'es');
      expect(executeTranslationScript).toHaveBeenCalledWith(42, expect.any(Array), 'en', 'es');
    });

    it('propagates errors thrown by executeTranslationScript', async () => {
      const run = createChromeBuiltinTranslationRunner(
        createDeps({
          executeTranslationScript: vi.fn().mockRejectedValue(new Error('Script failed')),
        })
      );
      await expect(run('Hi', 'en', 'de')).rejects.toThrow('Script failed');
    });

    it('propagates errors thrown by getActiveTabId', async () => {
      const run = createChromeBuiltinTranslationRunner(
        createDeps({
          getActiveTabId: vi.fn().mockRejectedValue(new Error('Tabs API unavailable')),
        })
      );
      await expect(run('Hi', 'en', 'de')).rejects.toThrow('Tabs API unavailable');
    });
  });
});
