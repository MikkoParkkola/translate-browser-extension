/**
 * Shared utilities for translation providers
 * Contains common functions extracted from provider implementations
 */

import { getAllLanguageCodes, getLanguageName } from '../core/language-map';
import { createLogger } from '../core/logger';
import { handleProviderHttpError } from '../core/http-errors';
import { CONFIG } from '../config';
import type { LanguagePair } from '../types';

const log = createLogger('ProviderUtils');
const languagePairCache = new Map<string, LanguagePair[]>();

export type TranslationPromptFormality = 'formal' | 'informal' | 'neutral';

export interface TranslationPromptTemplate {
  roleDescription: string;
  translationInstruction: string;
  formalInstruction: string;
  informalInstruction: string;
  trailingInstruction?: string;
  rules?: readonly string[];
}

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
 * Automatically applies CONFIG.timeouts.cloudApiMs unless the caller overrides signal.
 */
export async function fetchProviderJson<T>(
  providerName: string,
  url: string,
  options: RequestInit,
): Promise<T> {
  const signal = options.signal ?? AbortSignal.timeout(CONFIG.timeouts.cloudApiMs);
  const response = await fetch(url, { ...options, signal });
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

function normalizeDetectedLanguageCode(detected: string | null | undefined): string {
  const normalized = detected?.trim().toLowerCase();
  return normalized && normalized.length === 2 ? normalized : 'auto';
}

/**
 * Run provider-backed language detection through the shared fetch/error path.
 * Detect-language callers intentionally fall back to "auto" on errors, but we
 * still want those failures to flow through the same HTTP handling as translate().
 */
export async function detectProviderLanguageCode<T>(
  providerName: string,
  url: string,
  options: RequestInit,
  extractLanguageCode: (data: T) => string | null | undefined,
  logError: (message: string, error: unknown) => void,
): Promise<string> {
  try {
    const data = await fetchProviderJson<T>(providerName, url, options);
    return normalizeDetectedLanguageCode(extractLanguageCode(data));
  } catch (error) {
    logError('Language detection error:', error);
    return 'auto';
  }
}

/**
 * Estimate maximum tokens needed for translation
 * Used by OpenAI and Anthropic providers for token limits
 */
export function estimateMaxTokens(texts: string[]): number {
  return Math.min(4096, texts.join('').length * 2 + 500);
}

function getTranslationFormalityInstruction(
  formality: TranslationPromptFormality,
  template: TranslationPromptTemplate,
): string {
  switch (formality) {
    case 'formal':
      return template.formalInstruction;
    case 'informal':
      return template.informalInstruction;
    default:
      return '';
  }
}

export function buildTranslationPrompt(
  targetLang: string,
  formality: TranslationPromptFormality,
  template: TranslationPromptTemplate,
): string {
  const langName = getLanguageName(targetLang);
  const basePrompt =
    `${template.roleDescription} ${template.translationInstruction} ${langName}.`;
  const formalityInstruction = getTranslationFormalityInstruction(formality, template);
  const prompt =
    formalityInstruction.length > 0 ? `${basePrompt} ${formalityInstruction}` : basePrompt;

  if (template.rules && template.rules.length > 0) {
    return `${prompt}\n\n${template.rules.join('\n')}`;
  }

  return template.trailingInstruction ? `${prompt} ${template.trailingInstruction}` : prompt;
}

/**
 * Generate all possible non-identity pairs from a provider language list.
 * Results are memoized by language set because these lists are static at runtime.
 */
export function generateLanguagePairs(languageCodes: readonly string[]): LanguagePair[] {
  const uniqueCodes = [...new Set(languageCodes)];
  const cacheKey = uniqueCodes.join('\0');
  const cachedPairs = languagePairCache.get(cacheKey);
  if (cachedPairs) {
    return cachedPairs;
  }

  const pairs: LanguagePair[] = [];
  for (const src of uniqueCodes) {
    for (const tgt of uniqueCodes) {
      if (src !== tgt) {
        pairs.push({ src, tgt });
      }
    }
  }

  languagePairCache.set(cacheKey, pairs);
  return pairs;
}

/**
 * Generate all possible language pairs from known ISO language codes.
 * Used by OpenAI, Anthropic, and Google Cloud providers.
 */
export function generateAllLanguagePairs(): LanguagePair[] {
  return generateLanguagePairs(getAllLanguageCodes());
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
  const assignResult = (idx: number, value: string): void => {
    if (idx < count) {
      results[idx] = value;
      return;
    }

    if (!options.allowExtras) {
      return;
    }

    while (results.length <= idx) {
      results.push('');
    }

    results[idx] = value;
  };

  // 1. Primary: <tN>…</tN>
  const xmlRegex = /<t(\d+)>([\s\S]*?)<\/t\1>/g;
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = xmlRegex.exec(translated)) !== null) {
    const idx = parseInt(match[1], 10);
    assignResult(idx, match[2].trim());
    found = true;
  }
  if (found) return results;

  // 2. Legacy Anthropic: <text id="N">…</text>
  if (options.legacyXmlFallback) {
    const legacyRegex = /<text id="(\d+)">([\s\S]*?)<\/text>/g;
    while ((match = legacyRegex.exec(translated)) !== null) {
      const idx = parseInt(match[1], 10);
      assignResult(idx, match[2].trim());
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
