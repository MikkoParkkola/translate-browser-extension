/**
 * Translation Corrections Storage
 * Stores user corrections to improve future translations
 *
 * Features:
 * - Persistent storage of user corrections
 * - LRU eviction when at capacity
 * - Usage tracking for correction effectiveness
 * - Import/export for backup and sharing
 */

import { createLogger } from './logger';

const log = createLogger('Corrections');

const CORRECTIONS_KEY = 'translationCorrections';
const MAX_CORRECTIONS = 500;

export interface Correction {
  original: string;
  machineTranslation: string;
  userCorrection: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  useCount: number;
}

export interface CorrectionStats {
  total: number;
  totalUses: number;
  topCorrections: Array<{
    original: string;
    correction: string;
    useCount: number;
  }>;
}

// In-memory cache for fast access
let correctionsCache: Map<string, Correction> | null = null;

/**
 * Generate a unique key for a correction
 * Uses lowercase and trimmed text for case-insensitive matching
 */
function getCorrectionKey(original: string, sourceLang: string, targetLang: string): string {
  return `${sourceLang}:${targetLang}:${original.toLowerCase().trim()}`;
}

/**
 * Load corrections from persistent storage
 * Returns cached map if already loaded
 */
export async function loadCorrections(): Promise<Map<string, Correction>> {
  if (correctionsCache) return correctionsCache;

  try {
    const result = await chrome.storage.local.get(CORRECTIONS_KEY);
    if (result[CORRECTIONS_KEY]) {
      // Handle both array and object formats for backwards compatibility
      const stored = result[CORRECTIONS_KEY];
      if (Array.isArray(stored)) {
        correctionsCache = new Map(stored);
      } else {
        // Legacy object format - convert to Map
        correctionsCache = new Map(Object.entries(stored));
      }
      log.info(`Loaded ${correctionsCache.size} corrections`);
    } else {
      correctionsCache = new Map();
    }
  } catch (error) {
    log.error('Failed to load corrections:', error);
    correctionsCache = new Map();
  }

  return correctionsCache;
}

/**
 * Save corrections to persistent storage (debounced in practice)
 */
async function saveCorrections(): Promise<void> {
  if (!correctionsCache) return;

  try {
    const entries = Array.from(correctionsCache.entries());
    await chrome.storage.local.set({ [CORRECTIONS_KEY]: entries });
    log.debug(`Saved ${entries.length} corrections`);
  } catch (error) {
    log.error('Failed to save corrections:', error);
  }
}

/**
 * Add or update a correction
 * If correction already exists, updates it and increments useCount
 * Evicts oldest entry if at capacity
 */
export async function addCorrection(
  original: string,
  machineTranslation: string,
  userCorrection: string,
  sourceLang: string,
  targetLang: string
): Promise<void> {
  // Validate inputs
  if (!original?.trim() || !userCorrection?.trim()) {
    log.warn('Invalid correction: empty original or correction');
    return;
  }

  // Skip if correction is same as machine translation
  if (userCorrection.trim() === machineTranslation.trim()) {
    log.debug('Skipping correction: same as machine translation');
    return;
  }

  const corrections = await loadCorrections();
  const key = getCorrectionKey(original, sourceLang, targetLang);

  const existing = corrections.get(key);
  if (existing) {
    // Update existing correction
    existing.userCorrection = userCorrection;
    existing.machineTranslation = machineTranslation;
    existing.timestamp = Date.now();
    existing.useCount++;
    log.debug(`Updated correction (used ${existing.useCount}x): "${original.substring(0, 30)}..."`);
  } else {
    // Evict oldest if at capacity
    if (corrections.size >= MAX_CORRECTIONS) {
      let oldestKey: string | null = null;
      let oldestTime = Date.now();

      for (const [k, v] of corrections) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        corrections.delete(oldestKey);
        log.debug(`Evicted oldest correction to make room`);
      }
    }

    corrections.set(key, {
      original,
      machineTranslation,
      userCorrection,
      sourceLang,
      targetLang,
      timestamp: Date.now(),
      useCount: 1,
    });
    log.info(`Correction saved: "${original.substring(0, 30)}..." -> "${userCorrection.substring(0, 30)}..."`);
  }

  await saveCorrections();
}

/**
 * Get correction for text if available
 * Increments useCount when correction is used
 */
export async function getCorrection(
  original: string,
  sourceLang: string,
  targetLang: string
): Promise<string | null> {
  const corrections = await loadCorrections();
  const key = getCorrectionKey(original, sourceLang, targetLang);
  const correction = corrections.get(key);

  if (correction) {
    // Increment use count and update timestamp
    correction.useCount++;
    correction.timestamp = Date.now();
    // Save async - don't block on this
    saveCorrections().catch((e) => { log.warn('Failed to persist correction update:', e); });
    log.debug(`Using saved correction (${correction.useCount}x): "${original.substring(0, 30)}..."`);
    return correction.userCorrection;
  }

  return null;
}

/**
 * Get all corrections sorted by most recent
 */
export async function getAllCorrections(): Promise<Correction[]> {
  const corrections = await loadCorrections();
  return Array.from(corrections.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Clear all corrections
 */
export async function clearCorrections(): Promise<void> {
  correctionsCache = new Map();
  await chrome.storage.local.remove(CORRECTIONS_KEY);
  log.info('Corrections cleared');
}

/**
 * Delete a specific correction
 */
export async function deleteCorrection(
  original: string,
  sourceLang: string,
  targetLang: string
): Promise<boolean> {
  const corrections = await loadCorrections();
  const key = getCorrectionKey(original, sourceLang, targetLang);

  if (corrections.has(key)) {
    corrections.delete(key);
    await saveCorrections();
    log.info(`Deleted correction for: "${original.substring(0, 30)}..."`);
    return true;
  }

  return false;
}

/**
 * Get correction statistics
 */
export async function getCorrectionStats(): Promise<CorrectionStats> {
  const corrections = await loadCorrections();
  const correctionsList = Array.from(corrections.values());

  return {
    total: correctionsList.length,
    totalUses: correctionsList.reduce((sum, c) => sum + c.useCount, 0),
    topCorrections: correctionsList
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, 10)
      .map((c) => ({
        original: c.original,
        correction: c.userCorrection,
        useCount: c.useCount,
      })),
  };
}

/**
 * Export corrections as JSON string
 */
export async function exportCorrections(): Promise<string> {
  const corrections = await getAllCorrections();
  return JSON.stringify(corrections, null, 2);
}

/**
 * Import corrections from JSON string
 * Merges with existing corrections (imported take precedence)
 */
export async function importCorrections(json: string): Promise<number> {
  try {
    const imported: Correction[] = JSON.parse(json);

    // Validate structure
    if (!Array.isArray(imported)) {
      throw new Error('Invalid format: expected array of corrections');
    }

    for (const correction of imported) {
      if (
        typeof correction.original !== 'string' ||
        typeof correction.userCorrection !== 'string' ||
        typeof correction.sourceLang !== 'string' ||
        typeof correction.targetLang !== 'string'
      ) {
        throw new Error('Invalid correction entry: missing required fields');
      }
    }

    const corrections = await loadCorrections();
    let importCount = 0;

    for (const correction of imported) {
      const key = getCorrectionKey(
        correction.original,
        correction.sourceLang,
        correction.targetLang
      );

      // Import with preserved metadata or defaults
      corrections.set(key, {
        original: correction.original,
        machineTranslation: correction.machineTranslation || '',
        userCorrection: correction.userCorrection,
        sourceLang: correction.sourceLang,
        targetLang: correction.targetLang,
        timestamp: correction.timestamp || Date.now(),
        useCount: correction.useCount || 1,
      });
      importCount++;
    }

    await saveCorrections();
    log.info(`Imported ${importCount} corrections`);

    return importCount;
  } catch (error) {
    log.error('Failed to import corrections:', error);
    throw error;
  }
}

// Export default object for convenience
export const corrections = {
  loadCorrections,
  addCorrection,
  getCorrection,
  getAllCorrections,
  clearCorrections,
  deleteCorrection,
  getCorrectionStats,
  exportCorrections,
  importCorrections,
};

export default corrections;
