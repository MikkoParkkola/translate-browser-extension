/**
 * Translation History
 * Stores recent translations for user reference
 */

import { createLogger } from './logger';
import { browserAPI } from './browser-api';

const log = createLogger('History');

const STORAGE_KEY = 'translationHistory';
const MAX_HISTORY_SIZE = 20;

export interface HistoryEntry {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

/**
 * Generate a unique ID for history entries
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get translation history from storage
 */
export async function getHistory(): Promise<HistoryEntry[]> {
  try {
    const data = await browserAPI.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || [];
  } catch (e) {
    log.error('Failed to get history:', e);
    return [];
  }
}

/**
 * Add a translation to history
 * Maintains max 20 entries, removing oldest when limit reached
 */
export async function addToHistory(
  sourceText: string,
  translatedText: string,
  sourceLang: string,
  targetLang: string
): Promise<void> {
  // Skip empty or very short texts
  if (!sourceText || !translatedText || sourceText.trim().length < 2) {
    return;
  }

  // Truncate long texts for storage efficiency
  const maxTextLength = 500;
  const truncatedSource = sourceText.length > maxTextLength
    ? sourceText.substring(0, maxTextLength) + '...'
    : sourceText;
  const truncatedTranslated = translatedText.length > maxTextLength
    ? translatedText.substring(0, maxTextLength) + '...'
    : translatedText;

  try {
    const history = await getHistory();

    // Check for duplicates (same source text and language pair)
    const existingIndex = history.findIndex(
      (entry) =>
        entry.sourceText === truncatedSource &&
        entry.sourceLang === sourceLang &&
        entry.targetLang === targetLang
    );

    // Remove existing duplicate if found
    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }

    // Add new entry at the beginning
    const entry: HistoryEntry = {
      id: generateId(),
      sourceText: truncatedSource,
      translatedText: truncatedTranslated,
      sourceLang,
      targetLang,
      timestamp: Date.now(),
    };

    history.unshift(entry);

    // Trim to max size
    while (history.length > MAX_HISTORY_SIZE) {
      history.pop();
    }

    await browserAPI.storage.local.set({ [STORAGE_KEY]: history });
    log.info('Added to history:', truncatedSource.substring(0, 30) + '...');
  } catch (e) {
    log.error('Failed to add to history:', e);
  }
}

/**
 * Clear all translation history
 */
export async function clearHistory(): Promise<void> {
  try {
    await browserAPI.storage.local.remove(STORAGE_KEY);
    log.info('History cleared');
  } catch (e) {
    log.error('Failed to clear history:', e);
  }
}

/**
 * Remove a specific entry from history by ID
 */
export async function removeFromHistory(id: string): Promise<void> {
  try {
    const history = await getHistory();
    const filtered = history.filter((entry) => entry.id !== id);
    await browserAPI.storage.local.set({ [STORAGE_KEY]: filtered });
    log.info('Removed from history:', id);
  } catch (e) {
    log.error('Failed to remove from history:', e);
  }
}

export const history = {
  getHistory,
  addToHistory,
  clearHistory,
  removeFromHistory,
};

export default history;
