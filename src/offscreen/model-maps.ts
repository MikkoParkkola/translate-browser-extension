/**
 * OPUS-MT Model Mappings
 *
 * Direct language pairs with available Xenova OPUS-MT models.
 * Source: https://huggingface.co/models?search=xenova/opus-mt (76 models)
 *
 * Added language support:
 * - Polish (pl): pl-en direct, en-pl via multilingual
 * - Portuguese (pt): via ROMANCE multilingual models
 * - Norwegian (no): no-de direct, pivots via German
 * - Greek (el): NOT AVAILABLE in Xenova collection
 * - Baltic (lt, lv): via bat-en multilingual
 * - Germanic family: gem-gem, gmw-gmw multilingual
 */

// Model mapping (direct language pairs with available Xenova OPUS-MT models)
export const MODEL_MAP: Record<string, string> = {
  // === English <-> Major European Languages ===
  'en-de': 'Xenova/opus-mt-en-de',
  'de-en': 'Xenova/opus-mt-de-en',
  'en-fr': 'Xenova/opus-mt-en-fr',
  'fr-en': 'Xenova/opus-mt-fr-en',
  'en-es': 'Xenova/opus-mt-en-es',
  'es-en': 'Xenova/opus-mt-es-en',
  'en-it': 'Xenova/opus-mt-en-it',
  'it-en': 'Xenova/opus-mt-it-en',
  'en-nl': 'Xenova/opus-mt-en-nl',
  'nl-en': 'Xenova/opus-mt-nl-en',

  // === English <-> Nordic Languages ===
  'en-fi': 'Xenova/opus-mt-en-fi',
  'fi-en': 'Xenova/opus-mt-fi-en',
  'en-sv': 'Xenova/opus-mt-en-sv',
  'sv-en': 'Xenova/opus-mt-sv-en',
  'en-da': 'Xenova/opus-mt-en-da',
  'da-en': 'Xenova/opus-mt-da-en',

  // === English <-> Eastern European Languages ===
  'en-ru': 'Xenova/opus-mt-en-ru',
  'ru-en': 'Xenova/opus-mt-ru-en',
  'en-uk': 'Xenova/opus-mt-en-uk',
  'uk-en': 'Xenova/opus-mt-uk-en',
  'en-cs': 'Xenova/opus-mt-en-cs',
  'cs-en': 'Xenova/opus-mt-cs-en',
  'en-hu': 'Xenova/opus-mt-en-hu',
  'hu-en': 'Xenova/opus-mt-hu-en',
  'en-ro': 'Xenova/opus-mt-en-ro',
  // Note: ro-en not directly available, use pivot

  // === English <-> Asian Languages ===
  'en-zh': 'Xenova/opus-mt-en-zh',
  'zh-en': 'Xenova/opus-mt-zh-en',
  'en-ja': 'Xenova/opus-mt-en-jap',
  'ja-en': 'Xenova/opus-mt-jap-en',
  'en-ko': 'Xenova/opus-mt-en-mul', // Korean via multilingual (no direct ko model)
  'ko-en': 'Xenova/opus-mt-ko-en',
  'en-vi': 'Xenova/opus-mt-en-vi',
  'vi-en': 'Xenova/opus-mt-vi-en',
  'en-th': 'Xenova/opus-mt-en-mul', // Thai via multilingual (no direct th model)
  'th-en': 'Xenova/opus-mt-th-en',
  'en-hi': 'Xenova/opus-mt-en-hi',
  'hi-en': 'Xenova/opus-mt-hi-en',
  'en-id': 'Xenova/opus-mt-en-id',
  'id-en': 'Xenova/opus-mt-id-en',

  // === English <-> Middle Eastern Languages ===
  'en-ar': 'Xenova/opus-mt-en-ar',
  'ar-en': 'Xenova/opus-mt-ar-en',
  // Note: Hebrew (he) not available in Xenova collection

  // === English <-> Other Languages ===
  'en-af': 'Xenova/opus-mt-en-af',
  'af-en': 'Xenova/opus-mt-af-en',
  'en-xh': 'Xenova/opus-mt-en-xh', // Xhosa
  'xh-en': 'Xenova/opus-mt-xh-en',
  'et-en': 'Xenova/opus-mt-et-en', // Estonian (en-et not available)

  // === English <-> Polish ===
  'pl-en': 'Xenova/opus-mt-pl-en',
  // Note: en-pl not directly available, use mul or pivot

  // === Turkish (tc-big model for better quality) ===
  'tr-en': 'Xenova/opus-mt-tc-big-tr-en',
  // Note: en-tr not directly available, use ROMANCE or pivot

  // === Multilingual Models ===
  // mul-en: Multilingual to English (supports many source languages)
  'mul-en': 'Xenova/opus-mt-mul-en',
  // en-mul: English to Multilingual (supports many target languages)
  'en-mul': 'Xenova/opus-mt-en-mul',
  // ROMANCE-en: Romance languages (es, fr, it, pt, ro) to English
  'ROMANCE-en': 'Xenova/opus-mt-ROMANCE-en',
  // en-ROMANCE: English to Romance languages (es, fr, it, pt, ro)
  'en-ROMANCE': 'Xenova/opus-mt-en-ROMANCE',
  // bat-en: Baltic languages (lt, lv) to English
  'bat-en': 'Xenova/opus-mt-bat-en',
  // gem-gem: Germanic language family (bidirectional)
  'gem-gem': 'Xenova/opus-mt-gem-gem',
  // gmw-gmw: West Germanic languages (bidirectional)
  'gmw-gmw': 'Xenova/opus-mt-gmw-gmw',

  // === Direct Non-English Pairs (Romance languages) ===
  'fr-de': 'Xenova/opus-mt-fr-de',
  'de-fr': 'Xenova/opus-mt-de-fr',
  'fr-es': 'Xenova/opus-mt-fr-es',
  'es-fr': 'Xenova/opus-mt-es-fr',
  'it-fr': 'Xenova/opus-mt-it-fr',
  'it-es': 'Xenova/opus-mt-it-es',
  'es-it': 'Xenova/opus-mt-es-it',
  'de-es': 'Xenova/opus-mt-de-es',
  'es-de': 'Xenova/opus-mt-es-de',
  'nl-fr': 'Xenova/opus-mt-nl-fr',
  'ro-fr': 'Xenova/opus-mt-ro-fr',
  'fr-ro': 'Xenova/opus-mt-fr-ro',

  // === Direct Non-English Pairs (Slavic and others) ===
  'ru-uk': 'Xenova/opus-mt-ru-uk',
  'uk-ru': 'Xenova/opus-mt-uk-ru',
  'ru-fr': 'Xenova/opus-mt-ru-fr',
  'fr-ru': 'Xenova/opus-mt-fr-ru',
  'ru-es': 'Xenova/opus-mt-ru-es',
  'es-ru': 'Xenova/opus-mt-es-ru',

  // === Nordic <-> German pairs ===
  'da-de': 'Xenova/opus-mt-da-de',
  'no-de': 'Xenova/opus-mt-no-de', // Note: no = Norwegian
  'fi-de': 'Xenova/opus-mt-fi-de',
  'sv-de': 'Xenova/opus-mt-gem-gem', // Swedish-German via Germanic multilingual
};

// Pivot routes for language pairs without direct models (translate via English)
// Format: 'source-target': ['source-en', 'en-target']
export const PIVOT_ROUTES: Record<string, [string, string]> = {
  // === Nordic <-> Other European ===
  'nl-fi': ['nl-en', 'en-fi'],  // Dutch -> English -> Finnish
  'fi-nl': ['fi-en', 'en-nl'],  // Finnish -> English -> Dutch
  'cs-fi': ['cs-en', 'en-fi'],  // Czech -> English -> Finnish
  'fi-cs': ['fi-en', 'en-cs'],  // Finnish -> English -> Czech
  'sv-fi': ['sv-en', 'en-fi'],  // Swedish -> English -> Finnish
  'fi-sv': ['fi-en', 'en-sv'],  // Finnish -> English -> Swedish
  'da-fi': ['da-en', 'en-fi'],  // Danish -> English -> Finnish
  'fi-da': ['fi-en', 'en-da'],  // Finnish -> English -> Danish

  // === Major European <-> Finnish (via English pivot) ===
  'it-fi': ['it-en', 'en-fi'],  // Italian -> English -> Finnish
  'fi-it': ['fi-en', 'en-it'],  // Finnish -> English -> Italian
  'fr-fi': ['fr-en', 'en-fi'],  // French -> English -> Finnish
  'fi-fr': ['fi-en', 'en-fr'],  // Finnish -> English -> French
  'es-fi': ['es-en', 'en-fi'],  // Spanish -> English -> Finnish
  'fi-es': ['fi-en', 'en-es'],  // Finnish -> English -> Spanish
  'ru-fi': ['ru-en', 'en-fi'],  // Russian -> English -> Finnish
  'fi-ru': ['fi-en', 'en-ru'],  // Finnish -> English -> Russian
  'hu-fi': ['hu-en', 'en-fi'],  // Hungarian -> English -> Finnish
  'fi-hu': ['fi-en', 'en-hu'],  // Finnish -> English -> Hungarian
  'uk-fi': ['uk-en', 'en-fi'],  // Ukrainian -> English -> Finnish
  'fi-uk': ['fi-en', 'en-uk'],  // Finnish -> English -> Ukrainian
  'ar-fi': ['ar-en', 'en-fi'],  // Arabic -> English -> Finnish
  'zh-fi': ['zh-en', 'en-fi'],  // Chinese -> English -> Finnish
  'fi-zh': ['fi-en', 'en-zh'],  // Finnish -> English -> Chinese
  'ja-fi': ['ja-en', 'en-fi'],  // Japanese -> English -> Finnish
  'fi-ja': ['fi-en', 'en-ja'],  // Finnish -> English -> Japanese
  'ko-fi': ['ko-en', 'en-fi'],  // Korean -> English -> Finnish
  'vi-fi': ['vi-en', 'en-fi'],  // Vietnamese -> English -> Finnish
  'hi-fi': ['hi-en', 'en-fi'],  // Hindi -> English -> Finnish
  'tr-fi': ['tr-en', 'en-fi'],  // Turkish -> English -> Finnish

  // === German <-> Various ===
  'de-fi': ['de-en', 'en-fi'],  // German -> English -> Finnish (fi-de exists but not de-fi)
  'de-nl': ['de-en', 'en-nl'],  // German -> English -> Dutch
  'nl-de': ['nl-en', 'en-de'],  // Dutch -> English -> German
  'de-it': ['de-en', 'en-it'],  // German -> English -> Italian
  'it-de': ['it-en', 'en-de'],  // Italian -> English -> German
  'de-ru': ['de-en', 'en-ru'],  // German -> English -> Russian
  'ru-de': ['ru-en', 'en-de'],  // Russian -> English -> German

  // === Romanian pivots ===
  'ro-en': ['ro-fr', 'fr-en'],  // Romanian -> French -> English (no direct ro-en)
  'ro-de': ['ro-fr', 'fr-de'],  // Romanian -> French -> German
  'ro-es': ['ro-fr', 'fr-es'],  // Romanian -> French -> Spanish
  'de-ro': ['de-fr', 'fr-ro'],  // German -> French -> Romanian
  'es-ro': ['es-fr', 'fr-ro'],  // Spanish -> French -> Romanian

  // === Asian language pivots (where direct not available) ===
  'ja-de': ['ja-en', 'en-de'],  // Japanese -> English -> German
  'de-ja': ['de-en', 'en-ja'],  // German -> English -> Japanese
  'ja-fr': ['ja-en', 'en-fr'],  // Japanese -> English -> French
  'fr-ja': ['fr-en', 'en-ja'],  // French -> English -> Japanese
  'zh-de': ['zh-en', 'en-de'],  // Chinese -> English -> German
  'de-zh': ['de-en', 'en-zh'],  // German -> English -> Chinese
  'zh-fr': ['zh-en', 'en-fr'],  // Chinese -> English -> French
  'fr-zh': ['fr-en', 'en-zh'],  // French -> English -> Chinese
  'ko-de': ['ko-en', 'en-de'],  // Korean -> English -> German
  'ko-fr': ['ko-en', 'en-fr'],  // Korean -> English -> French

  // === Slavic language pivots ===
  'cs-de': ['cs-en', 'en-de'],  // Czech -> English -> German
  'de-cs': ['de-en', 'en-cs'],  // German -> English -> Czech
  'uk-de': ['uk-en', 'en-de'],  // Ukrainian -> English -> German
  'de-uk': ['de-en', 'en-uk'],  // German -> English -> Ukrainian
  'uk-fr': ['uk-en', 'en-fr'],  // Ukrainian -> English -> French
  'fr-uk': ['fr-en', 'en-uk'],  // French -> English -> Ukrainian

  // === Hungarian pivots ===
  'hu-de': ['hu-en', 'en-de'],  // Hungarian -> English -> German
  'de-hu': ['de-en', 'en-hu'],  // German -> English -> Hungarian
  'hu-fr': ['hu-en', 'en-fr'],  // Hungarian -> English -> French
  'fr-hu': ['fr-en', 'en-hu'],  // French -> English -> Hungarian

  // === Arabic pivots ===
  'ar-de': ['ar-en', 'en-de'],  // Arabic -> English -> German
  'de-ar': ['de-en', 'en-ar'],  // German -> English -> Arabic
  'ar-fr': ['ar-en', 'en-fr'],  // Arabic -> English -> French
  'fr-ar': ['fr-en', 'en-ar'],  // French -> English -> Arabic

  // === Vietnamese pivots ===
  'vi-de': ['vi-en', 'en-de'],  // Vietnamese -> English -> German
  'de-vi': ['de-en', 'en-vi'],  // German -> English -> Vietnamese
  'vi-fr': ['vi-en', 'en-fr'],  // Vietnamese -> English -> French
  'fr-vi': ['fr-en', 'en-vi'],  // French -> English -> Vietnamese

  // === Hindi pivots ===
  'hi-de': ['hi-en', 'en-de'],  // Hindi -> English -> German
  'de-hi': ['de-en', 'en-hi'],  // German -> English -> Hindi

  // === Polish pivots (pl-en available, en-pl not) ===
  'en-pl': ['en-mul', 'mul-en'], // English -> Multilingual (limited quality)
  'pl-de': ['pl-en', 'en-de'],  // Polish -> English -> German
  'de-pl': ['de-en', 'en-mul'], // German -> English -> Polish (via mul)
  'pl-fr': ['pl-en', 'en-fr'],  // Polish -> English -> French
  'fr-pl': ['fr-en', 'en-mul'], // French -> English -> Polish (via mul)
  'pl-fi': ['pl-en', 'en-fi'],  // Polish -> English -> Finnish
  'fi-pl': ['fi-en', 'en-mul'], // Finnish -> English -> Polish (via mul)

  // === Norwegian pivots (no direct en-no or no-en, but no-de exists) ===
  'no-en': ['no-de', 'de-en'],  // Norwegian -> German -> English
  'en-no': ['en-de', 'de-en'],  // English -> German -> Norwegian (limited, no de-no)
  'no-fi': ['no-de', 'de-en'],  // Norwegian -> German -> English (then pivot to fi)
  'fi-no': ['fi-de', 'de-en'],  // Finnish -> German -> Norwegian (limited)
  'no-sv': ['no-de', 'de-en'],  // Norwegian -> Swedish (via German-English pivot, limited)

  // === Portuguese pivots (use ROMANCE-en for pt-en direction) ===
  // Note: Portuguese is supported via ROMANCE-en multilingual model
  'pt-en': ['ROMANCE-en', 'ROMANCE-en'], // Portuguese -> English via ROMANCE (single model, special case)
  'en-pt': ['en-ROMANCE', 'en-ROMANCE'], // English -> Portuguese via en-ROMANCE (single model)
  'pt-de': ['ROMANCE-en', 'en-de'],      // Portuguese -> English -> German
  'de-pt': ['de-en', 'en-ROMANCE'],      // German -> English -> Portuguese
  'pt-fr': ['ROMANCE-en', 'en-fr'],      // Portuguese -> English -> French
  'fr-pt': ['fr-en', 'en-ROMANCE'],      // French -> English -> Portuguese
  'pt-fi': ['ROMANCE-en', 'en-fi'],      // Portuguese -> English -> Finnish
  'fi-pt': ['fi-en', 'en-ROMANCE'],      // Finnish -> English -> Portuguese
};

/**
 * Check if a language pair has a direct model.
 */
export function hasDirectModel(sourceLang: string, targetLang: string): boolean {
  return `${sourceLang}-${targetLang}` in MODEL_MAP;
}

/**
 * Check if a language pair has a pivot route.
 */
export function hasPivotRoute(sourceLang: string, targetLang: string): boolean {
  return `${sourceLang}-${targetLang}` in PIVOT_ROUTES;
}

/**
 * Get the model ID for a language pair.
 */
export function getModelId(sourceLang: string, targetLang: string): string | null {
  return MODEL_MAP[`${sourceLang}-${targetLang}`] || null;
}

/**
 * Get the pivot route for a language pair.
 */
export function getPivotRoute(sourceLang: string, targetLang: string): [string, string] | null {
  return PIVOT_ROUTES[`${sourceLang}-${targetLang}`] || null;
}
