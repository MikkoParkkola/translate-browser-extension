/**
 * Shared utilities for translation providers
 * Contains common functions extracted from provider implementations
 */

import { getAllLanguageCodes } from '../core/language-map';
import { createLogger } from '../core/logger';
import { handleProviderHttpError } from '../core/http-errors';
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
 * Fetch JSON from a provider API endpoint, throwing on non-2xx responses.
 * Centralises the fetch → error-check → json-parse pattern across all providers.
 */
export async function fetchProviderJson<T>(
  providerName: string,
  url: string,
  options: RequestInit,
): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await readErrorBody(response);
    const httpError = handleProviderHttpError(
      response.status,
      providerName,
      errorText,
      response.headers.get('Retry-After'),
    );
    throw new Error(httpError.message);
  }
  return response.json() as Promise<T>;
}

/**
 * Estimate maximum tokens needed for translation
 * Used by OpenAI and Anthropic providers for token limits
 */
export function estimateMaxTokens(texts: string[]): number {
  return Math.min(4096, texts.join('').length * 2 + 500);
}

/**
 * Generate all possible language pairs from available language codes.
 * Used by OpenAI, Anthropic, and Google Cloud providers.
 * Result is memoized since language codes are static at runtime.
 */
let _cachedLanguagePairs: LanguagePair[] | null = null;

export function generateAllLanguagePairs(): LanguagePair[] {
  if (_cachedLanguagePairs) {
    return _cachedLanguagePairs;
  }
  const languages = getAllLanguageCodes();
  const pairs: LanguagePair[] = [];
  for (const src of languages) {
    for (const tgt of languages) {
      if (src !== tgt) {
        pairs.push({ src, tgt });
      }
    }
  }
  _cachedLanguagePairs = pairs;
  return pairs;
}
/**
 * Parse a batch translation response that uses numbered XML tags.
 *
 * Supports multiple response formats in priority order:
 *   1. `<t0>…</t0> <t1>…</t1>` — preferred format used by OpenAI & Anthropic
 *   2. `<text id="0">…</text>` — legacy Anthropic format
 *   3. `---TRANSLATE_SEPARATOR---` — legacy OpenAI separator fallback
 *   4. Newline splitting — last-resort fallback
 *
 * @param translated  Raw LLM response text
 * @param count       Number of source texts (used to size / pad result)
 * @param options     Enable/disable individual fallback strategies
 */
export function parseBatchResponse(
  translated: string,
  count: number,
  options: {
    separatorFallback?: boolean;  // enable ---TRANSLATE_SEPARATOR--- split (OpenAI)
    legacyXmlFallback?: boolean;  // enable <text id="N"> format (Anthropic)
    newlineFallback?: boolean;    // enable plain-newline split as last resort
    allowExtras?: boolean;        // include results beyond count (Anthropic)
  } = {},
): string[] {
  const results: string[] = new Array(count).fill('');

  // 1. Primary: <tN>…</tN>
  const xmlRegex = /<t(\d+)>([\s\S]*?)<\/t\1>/g;
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = xmlRegex.exec(translated)) !== null) {
    const idx = parseInt(match[1], 10);
    if (idx < count) {
      results[idx] = match[2].trim();
    } else if (options.allowExtras) {
      results[idx] = match[2].trim();
    }
    found = true;
  }
  if (found) return results;

  // 2. Legacy Anthropic: <text id="N">…</text>
  if (options.legacyXmlFallback) {
    const legacyRegex = /<text id="(\d+)">([\s\S]*?)<\/text>/g;
    while ((match = legacyRegex.exec(translated)) !== null) {
      const idx = parseInt(match[1], 10);
      if (idx < count) {
        results[idx] = match[2].trim();
      } else if (options.allowExtras) {
        results[idx] = match[2].trim();
      }
      found = true;
    }
    if (found) return results;
  }

  // 3. Legacy OpenAI: ---TRANSLATE_SEPARATOR--- (or single result with no separator)
  if (options.separatorFallback) {
    const parts = translated.split(/---TRANSLATE_SEPARATOR---/i).map(s => s.trim());
    for (let i = 0; i < Math.min(parts.length, count); i++) results[i] = parts[i];
    return results;
  }

  // 4. Newline split (last resort — only useful for short batches)
  if (options.newlineFallback) {
    const lines = translated.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (let i = 0; i < Math.min(lines.length, count); i++) results[i] = lines[i];
  }

  return results;
}
