/**
 * Shared utilities for translation providers
 * Contains common functions extracted from provider implementations
 */

import { getAllLanguageCodes } from '../core/language-map';
import { createLogger } from '../core/logger';
import type { LanguagePair } from '../types';

const log = createLogger('ProviderUtils');

/**
 * Extract error body from response, with fallback handling
 * Used consistently across all cloud providers
 */
export async function readErrorBody(response: Response): Promise<string> {
  return response.text().catch((e) => {
    log.warn('Failed to read error body:', e);
    return '';
  });
}

/**
 * Estimate maximum tokens needed for translation
 * Used by OpenAI and Anthropic providers for token limits
 */
export function estimateMaxTokens(texts: string[]): number {
  return Math.min(4096, texts.join('').length * 2 + 500);
}

/**
 * Generate all possible language pairs from available language codes
 * Used by OpenAI, Anthropic, and Google Cloud providers
 */
export function generateAllLanguagePairs(): LanguagePair[] {
  const languages = getAllLanguageCodes();
  const pairs: LanguagePair[] = [];
  for (const src of languages) {
    for (const tgt of languages) {
      if (src !== tgt) {
        pairs.push({ src, tgt });
      }
    }
  }
  return pairs;
}