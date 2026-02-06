/**
 * Glossary - Custom term replacements for translations
 *
 * Features:
 * - Pre-processing: Replace terms before sending to translator
 * - Post-processing: Restore placeholder-protected terms after translation
 * - Case sensitivity options
 * - Import/export as JSON
 */

import { createLogger } from './logger';

const log = createLogger('Glossary');

export interface GlossaryTerm {
  replacement: string;
  caseSensitive: boolean;
  description?: string;
}

export interface GlossaryStore {
  [term: string]: GlossaryTerm;
}

// Placeholder format for protecting terms during translation
const PLACEHOLDER_PREFIX = '\u200B\u2063TERM_';
const PLACEHOLDER_SUFFIX = '\u2063\u200B';

const STORAGE_KEY = 'glossary';

/**
 * Get the entire glossary
 */
export async function getGlossary(): Promise<GlossaryStore> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || {};
  } catch (e) {
    log.error(' Failed to get glossary:', e);
    return {};
  }
}

/**
 * Add or update a glossary term
 */
export async function addTerm(
  term: string,
  replacement: string,
  caseSensitive = false,
  description?: string
): Promise<void> {
  if (!term || !replacement) {
    throw new Error('Term and replacement are required');
  }

  try {
    const glossary = await getGlossary();
    glossary[term] = { replacement, caseSensitive, description };
    await chrome.storage.local.set({ [STORAGE_KEY]: glossary });
    log.info(' Added term:', term, '->', replacement);
  } catch (e) {
    log.error(' Failed to add term:', e);
    throw e;
  }
}

/**
 * Remove a glossary term
 */
export async function removeTerm(term: string): Promise<void> {
  try {
    const glossary = await getGlossary();
    delete glossary[term];
    await chrome.storage.local.set({ [STORAGE_KEY]: glossary });
    log.info(' Removed term:', term);
  } catch (e) {
    log.error(' Failed to remove term:', e);
    throw e;
  }
}

/**
 * Clear all glossary terms
 */
export async function clearGlossary(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
    log.info(' Cleared glossary');
  } catch (e) {
    log.error(' Failed to clear glossary:', e);
    throw e;
  }
}

/**
 * Create a regex for matching a term (with case sensitivity)
 */
function createTermRegex(term: string, caseSensitive: boolean): RegExp {
  // Escape special regex characters
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word boundary matching
  return new RegExp(`\\b${escaped}\\b`, caseSensitive ? 'g' : 'gi');
}

/**
 * Apply glossary pre-processing to text before translation
 * Replaces terms with their target replacements
 *
 * @param text - Text to process
 * @param glossary - Glossary terms to apply
 * @returns Processed text with replacements
 */
export function applyGlossaryPreProcess(text: string, glossary: GlossaryStore): string {
  let result = text;

  // Sort terms by length (longest first) to avoid partial matches
  const sortedTerms = Object.keys(glossary).sort((a, b) => b.length - a.length);

  for (const term of sortedTerms) {
    const entry = glossary[term];
    const regex = createTermRegex(term, entry.caseSensitive);
    result = result.replace(regex, entry.replacement);
  }

  return result;
}

/**
 * Apply glossary with placeholder protection
 * Replaces terms with placeholders that survive translation
 *
 * @param text - Text to process
 * @param glossary - Glossary terms to apply
 * @returns Object with processed text and placeholder map for restoration
 */
export function applyGlossaryWithPlaceholders(
  text: string,
  glossary: GlossaryStore
): { text: string; placeholderMap: Map<string, string> } {
  let result = text;
  const placeholderMap = new Map<string, string>();
  let placeholderIndex = 0;

  // Sort terms by length (longest first) to avoid partial matches
  const sortedTerms = Object.keys(glossary).sort((a, b) => b.length - a.length);

  for (const term of sortedTerms) {
    const entry = glossary[term];
    const regex = createTermRegex(term, entry.caseSensitive);

    result = result.replace(regex, () => {
      const placeholder = `${PLACEHOLDER_PREFIX}${placeholderIndex}${PLACEHOLDER_SUFFIX}`;
      placeholderMap.set(placeholder, entry.replacement);
      placeholderIndex++;
      return placeholder;
    });
  }

  return { text: result, placeholderMap };
}

/**
 * Restore placeholders with their actual replacements
 *
 * @param text - Translated text with placeholders
 * @param placeholderMap - Map of placeholders to replacements
 * @returns Text with placeholders replaced by actual terms
 */
export function restorePlaceholders(text: string, placeholderMap: Map<string, string>): string {
  let result = text;

  for (const [placeholder, replacement] of placeholderMap) {
    result = result.split(placeholder).join(replacement);
  }

  return result;
}

/**
 * Convenience function: Apply glossary to text for translation
 * Uses placeholder method for protection during translation
 *
 * @param text - Original text
 * @param glossary - Glossary to apply (optional, will load from storage if not provided)
 * @returns Object with processed text and restore function
 */
export async function applyGlossary(
  text: string,
  glossary?: GlossaryStore
): Promise<{ processedText: string; restore: (translated: string) => string }> {
  const g = glossary ?? (await getGlossary());

  if (Object.keys(g).length === 0) {
    return { processedText: text, restore: (t) => t };
  }

  const { text: processedText, placeholderMap } = applyGlossaryWithPlaceholders(text, g);

  return {
    processedText,
    restore: (translated: string) => restorePlaceholders(translated, placeholderMap),
  };
}

/**
 * Apply glossary to an array of texts
 */
export async function applyGlossaryBatch(
  texts: string[],
  glossary?: GlossaryStore
): Promise<{ processedTexts: string[]; restoreFns: Array<(text: string) => string> }> {
  const g = glossary ?? (await getGlossary());

  if (Object.keys(g).length === 0) {
    return { processedTexts: texts, restoreFns: texts.map(() => (t: string) => t) };
  }

  const results = texts.map((text) => {
    const { text: processedText, placeholderMap } = applyGlossaryWithPlaceholders(text, g);
    return {
      processedText,
      restore: (translated: string) => restorePlaceholders(translated, placeholderMap),
    };
  });

  return {
    processedTexts: results.map((r) => r.processedText),
    restoreFns: results.map((r) => r.restore),
  };
}

/**
 * Export glossary as JSON string
 */
export async function exportGlossary(): Promise<string> {
  const glossary = await getGlossary();
  return JSON.stringify(glossary, null, 2);
}

/**
 * Import glossary from JSON string
 * Merges with existing glossary (imported terms take precedence)
 */
export async function importGlossary(json: string): Promise<number> {
  try {
    const imported: GlossaryStore = JSON.parse(json);

    // Validate structure
    for (const [term, entry] of Object.entries(imported)) {
      if (typeof term !== 'string') {
        throw new Error(`Invalid term: ${term}`);
      }
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`Invalid entry for term: ${term}`);
      }
      if (typeof entry.replacement !== 'string') {
        throw new Error(`Invalid replacement for term: ${term}`);
      }
      if (typeof entry.caseSensitive !== 'boolean') {
        throw new Error(`Invalid caseSensitive for term: ${term}`);
      }
    }

    const existing = await getGlossary();
    const merged = { ...existing, ...imported };

    await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    log.info(' Imported', Object.keys(imported).length, 'terms');

    return Object.keys(imported).length;
  } catch (e) {
    log.error(' Failed to import glossary:', e);
    throw e;
  }
}

export const glossary = {
  getGlossary,
  addTerm,
  removeTerm,
  clearGlossary,
  applyGlossary,
  applyGlossaryBatch,
  applyGlossaryPreProcess,
  applyGlossaryWithPlaceholders,
  restorePlaceholders,
  exportGlossary,
  importGlossary,
};

export default glossary;
