/**
 * Shared Language Mapping Module
 * Centralizes language code mappings and helper functions
 * Used by all translation providers for consistent language handling
 */

/**
 * Human-readable language names indexed by ISO 639-1 codes
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic',
  bg: 'Bulgarian',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fi: 'Finnish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  lt: 'Lithuanian',
  lv: 'Latvian',
  nb: 'Norwegian Bokmal',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sv: 'Swedish',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

/**
 * DeepL-specific language codes (uppercase, some variations)
 * Maps ISO 639-1 codes to DeepL API format
 */
export const DEEPL_LANGUAGE_CODES: Record<string, string> = {
  bg: 'BG',
  cs: 'CS',
  da: 'DA',
  de: 'DE',
  el: 'EL',
  en: 'EN',
  es: 'ES',
  et: 'ET',
  fi: 'FI',
  fr: 'FR',
  hu: 'HU',
  id: 'ID',
  it: 'IT',
  ja: 'JA',
  ko: 'KO',
  lt: 'LT',
  lv: 'LV',
  nb: 'NB',
  nl: 'NL',
  pl: 'PL',
  pt: 'PT',
  ro: 'RO',
  ru: 'RU',
  sk: 'SK',
  sl: 'SL',
  sv: 'SV',
  tr: 'TR',
  uk: 'UK',
  zh: 'ZH',
};

/**
 * Get human-readable language name from ISO code
 * @param code - ISO 639-1 language code
 * @returns Human-readable language name, or the code itself if unknown
 */
export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] || code;
}

/**
 * Normalize a language code to lowercase ISO 639-1 format
 * Handles various input formats (uppercase, mixed case, etc.)
 * @param code - Language code in any format
 * @returns Normalized lowercase ISO 639-1 code
 */
export function normalizeLanguageCode(code: string): string {
  return code.toLowerCase().trim();
}

/**
 * Get DeepL-formatted language code
 * @param code - ISO 639-1 language code
 * @returns DeepL API format code (uppercase)
 */
export function toDeepLCode(code: string): string {
  const normalized = normalizeLanguageCode(code);
  return DEEPL_LANGUAGE_CODES[normalized] || code.toUpperCase();
}

/**
 * Get all supported DeepL language codes
 * @returns Array of ISO 639-1 codes supported by DeepL
 */
export function getDeepLSupportedLanguages(): string[] {
  return Object.keys(DEEPL_LANGUAGE_CODES);
}

/**
 * Get all known language codes
 * @returns Array of all ISO 639-1 codes with known names
 */
export function getAllLanguageCodes(): string[] {
  return Object.keys(LANGUAGE_NAMES);
}
