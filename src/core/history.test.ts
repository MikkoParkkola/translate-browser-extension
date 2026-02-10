/**
 * Translation history unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock objects are available in vi.mock factory
const mockStorageData = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  return data;
});

const mockBrowserStorage = vi.hoisted(() => ({
  local: {
    get: vi.fn(async (key: string) => {
      return { [key]: mockStorageData[key] };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(mockStorageData, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete mockStorageData[key];
    }),
    clear: vi.fn(),
  },
}));

vi.mock('./browser-api', () => ({
  browserAPI: {
    runtime: {
      getURL: vi.fn(),
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
    storage: mockBrowserStorage,
  },
}));

import {
  getHistory,
  addToHistory,
  clearHistory,
  removeFromHistory,
  history,
  type HistoryEntry,
} from './history';

describe('Translation History', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-assign default implementations after clearAllMocks
    mockBrowserStorage.local.get.mockImplementation(async (key: string) => {
      return { [key]: mockStorageData[key] };
    });
    mockBrowserStorage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(mockStorageData, items);
    });
    mockBrowserStorage.local.remove.mockImplementation(async (key: string) => {
      delete mockStorageData[key];
    });
    // Reset storage state
    for (const key of Object.keys(mockStorageData)) {
      delete mockStorageData[key];
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('getHistory', () => {
    it('returns empty array when no history exists', async () => {
      const result = await getHistory();
      expect(result).toEqual([]);
    });

    it('returns stored history entries', async () => {
      const entries: HistoryEntry[] = [
        {
          id: 'test-1',
          sourceText: 'Hello',
          translatedText: 'Hei',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now(),
        },
      ];
      mockStorageData['translationHistory'] = entries;

      const result = await getHistory();
      expect(result).toEqual(entries);
    });

    it('returns empty array on storage error', async () => {
      mockBrowserStorage.local.get.mockRejectedValueOnce(new Error('Storage error'));

      const result = await getHistory();
      expect(result).toEqual([]);
    });
  });

  describe('addToHistory', () => {
    it('adds a new entry to history', async () => {
      await addToHistory('Hello', 'Hei', 'en', 'fi');

      expect(mockBrowserStorage.local.set).toHaveBeenCalled();
      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].sourceText).toBe('Hello');
      expect(entries[0].translatedText).toBe('Hei');
      expect(entries[0].sourceLang).toBe('en');
      expect(entries[0].targetLang).toBe('fi');
      expect(entries[0].id).toBeDefined();
      expect(entries[0].timestamp).toBeDefined();
    });

    it('skips empty source text', async () => {
      await addToHistory('', 'Hei', 'en', 'fi');
      expect(mockBrowserStorage.local.set).not.toHaveBeenCalled();
    });

    it('skips empty translated text', async () => {
      await addToHistory('Hello', '', 'en', 'fi');
      expect(mockBrowserStorage.local.set).not.toHaveBeenCalled();
    });

    it('skips very short source text (less than 2 chars after trim)', async () => {
      await addToHistory('a', 'x', 'en', 'fi');
      expect(mockBrowserStorage.local.set).not.toHaveBeenCalled();
    });

    it('skips whitespace-only source text', async () => {
      await addToHistory('  ', 'x', 'en', 'fi');
      expect(mockBrowserStorage.local.set).not.toHaveBeenCalled();
    });

    it('truncates long source text at 500 characters', async () => {
      const longText = 'a'.repeat(600);
      await addToHistory(longText, 'translation', 'en', 'fi');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries[0].sourceText.length).toBe(503); // 500 + '...'
      expect(entries[0].sourceText.endsWith('...')).toBe(true);
    });

    it('truncates long translated text at 500 characters', async () => {
      const longText = 'b'.repeat(600);
      await addToHistory('Hello world', longText, 'en', 'fi');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries[0].translatedText.length).toBe(503);
      expect(entries[0].translatedText.endsWith('...')).toBe(true);
    });

    it('does not truncate text within 500 characters', async () => {
      const text = 'a'.repeat(500);
      await addToHistory(text, 'translation', 'en', 'fi');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries[0].sourceText).toBe(text);
      expect(entries[0].sourceText.endsWith('...')).toBe(false);
    });

    it('adds new entries at the beginning (most recent first)', async () => {
      const existing: HistoryEntry[] = [
        {
          id: 'old-1',
          sourceText: 'Old text',
          translatedText: 'Vanha teksti',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now() - 1000,
        },
      ];
      mockStorageData['translationHistory'] = existing;

      await addToHistory('New text', 'Uusi teksti', 'en', 'fi');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries).toHaveLength(2);
      expect(entries[0].sourceText).toBe('New text');
      expect(entries[1].sourceText).toBe('Old text');
    });

    it('removes duplicate entries (same source text and language pair)', async () => {
      const existing: HistoryEntry[] = [
        {
          id: 'dup-1',
          sourceText: 'Hello',
          translatedText: 'Hei',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now() - 1000,
        },
      ];
      mockStorageData['translationHistory'] = existing;

      await addToHistory('Hello', 'Hei updated', 'en', 'fi');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].translatedText).toBe('Hei updated');
    });

    it('does not remove entries with different language pair', async () => {
      const existing: HistoryEntry[] = [
        {
          id: 'diff-1',
          sourceText: 'Hello',
          translatedText: 'Hei',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now() - 1000,
        },
      ];
      mockStorageData['translationHistory'] = existing;

      await addToHistory('Hello', 'Hallo', 'en', 'de');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries).toHaveLength(2);
    });

    it('limits history to 20 entries', async () => {
      const existing: HistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
        id: `entry-${i}`,
        sourceText: `Text ${i}`,
        translatedText: `Translation ${i}`,
        sourceLang: 'en',
        targetLang: 'fi',
        timestamp: Date.now() - (20 - i) * 1000,
      }));
      mockStorageData['translationHistory'] = existing;

      await addToHistory('New entry', 'Uusi merkinta', 'en', 'fi');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries).toHaveLength(20);
      expect(entries[0].sourceText).toBe('New entry');
    });

    it('handles storage error gracefully', async () => {
      mockBrowserStorage.local.get.mockResolvedValueOnce({ translationHistory: [] });
      mockBrowserStorage.local.set.mockRejectedValueOnce(new Error('Write failed'));

      // Should not throw
      await addToHistory('Hello', 'Hei', 'en', 'fi');
    });
  });

  describe('clearHistory', () => {
    it('removes history from storage', async () => {
      await clearHistory();
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith('translationHistory');
    });

    it('handles storage error gracefully', async () => {
      mockBrowserStorage.local.remove.mockRejectedValueOnce(new Error('Remove failed'));

      // Should not throw
      await clearHistory();
    });
  });

  describe('removeFromHistory', () => {
    it('removes a specific entry by ID', async () => {
      const existing: HistoryEntry[] = [
        {
          id: 'keep-1',
          sourceText: 'Keep',
          translatedText: 'Pideta',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now(),
        },
        {
          id: 'remove-1',
          sourceText: 'Remove',
          translatedText: 'Poista',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now(),
        },
      ];
      mockStorageData['translationHistory'] = existing;

      await removeFromHistory('remove-1');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('keep-1');
    });

    it('does nothing if ID not found', async () => {
      const existing: HistoryEntry[] = [
        {
          id: 'entry-1',
          sourceText: 'Hello',
          translatedText: 'Hei',
          sourceLang: 'en',
          targetLang: 'fi',
          timestamp: Date.now(),
        },
      ];
      mockStorageData['translationHistory'] = existing;

      await removeFromHistory('nonexistent-id');

      const setCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const entries = setCall['translationHistory'] as HistoryEntry[];
      expect(entries).toHaveLength(1);
    });

    it('handles storage error gracefully', async () => {
      mockBrowserStorage.local.get.mockResolvedValueOnce({ translationHistory: [] });
      mockBrowserStorage.local.set.mockRejectedValueOnce(new Error('Set failed'));

      // Should not throw
      await removeFromHistory('any-id');
    });
  });

  describe('history default export', () => {
    it('exports all functions', () => {
      expect(history.getHistory).toBe(getHistory);
      expect(history.addToHistory).toBe(addToHistory);
      expect(history.clearHistory).toBe(clearHistory);
      expect(history.removeFromHistory).toBe(removeFromHistory);
    });
  });
});
