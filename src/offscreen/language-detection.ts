/**
 * Language Detection
 *
 * Uses franc-min for language detection with ISO 639-3 to ISO 639-1 mapping.
 */

import { franc } from 'franc-min';
import { createLogger } from '../core/logger';

const log = createLogger('LanguageDetection');

// Map franc ISO 639-3 codes to our ISO 639-1 codes
// See: https://iso639-3.sil.org/code_tables/639/data
export const FRANC_TO_ISO: Record<string, string> = {
  // Major European languages
  'eng': 'en',
  'deu': 'de',
  'fra': 'fr',
  'spa': 'es',
  'ita': 'it',
  'nld': 'nl',  // Dutch
  'por': 'pt',  // Portuguese

  // Nordic languages
  'fin': 'fi',
  'swe': 'sv',
  'dan': 'da',  // Danish
  'nor': 'no',  // Norwegian (generic)
  'nob': 'no',  // Norwegian Bokmal
  'nno': 'no',  // Norwegian Nynorsk

  // Eastern European languages
  'rus': 'ru',
  'ukr': 'uk',  // Ukrainian
  'pol': 'pl',  // Polish
  'ces': 'cs',  // Czech
  'hun': 'hu',  // Hungarian
  'ron': 'ro',  // Romanian
  'bul': 'bg',  // Bulgarian
  'hrv': 'hr',  // Croatian
  'slk': 'sk',  // Slovak
  'slv': 'sl',  // Slovenian
  'est': 'et',  // Estonian
  'lav': 'lv',  // Latvian
  'lit': 'lt',  // Lithuanian

  // Asian languages
  'cmn': 'zh',  // Mandarin Chinese
  'zho': 'zh',  // Chinese (generic)
  'jpn': 'ja',
  'kor': 'ko',
  'vie': 'vi',  // Vietnamese
  'tha': 'th',  // Thai
  'hin': 'hi',  // Hindi
  'ind': 'id',  // Indonesian
  'msa': 'ms',  // Malay

  // Middle Eastern languages
  'ara': 'ar',  // Arabic
  'heb': 'he',  // Hebrew
  'fas': 'fa',  // Persian/Farsi
  'tur': 'tr',  // Turkish

  // Other languages
  'ell': 'el',  // Greek
  'afr': 'af',  // Afrikaans
  'xho': 'xh',  // Xhosa
  'swa': 'sw',  // Swahili
  'urd': 'ur',  // Urdu
  'ben': 'bn',  // Bengali
  'tam': 'ta',  // Tamil
  'tel': 'te',  // Telugu
  'mal': 'ml',  // Malayalam
  'kat': 'ka',  // Georgian
  'hye': 'hy',  // Armenian
  'sqi': 'sq',  // Albanian
  'mkd': 'mk',  // Macedonian
  'srp': 'sr',  // Serbian
  'bos': 'bs',  // Bosnian
  'isl': 'is',  // Icelandic
  'mlt': 'mt',  // Maltese
  'gle': 'ga',  // Irish
  'cym': 'cy',  // Welsh
  'eus': 'eu',  // Basque
  'cat': 'ca',  // Catalan
  'glg': 'gl',  // Galician
};

/**
 * Detect language from text using franc.
 * Falls back to character set detection and English as default.
 */
export function detectLanguage(text: string): string {
  // franc returns 'und' (undetermined) if it can't detect
  const detected = franc(text, { minLength: 3 });
  console.log(`[LanguageDetection] franc raw detection: "${detected}" for text: "${text.slice(0, 50)}..."`);

  if (detected === 'und' || !detected) {
    // Try to guess from character sets
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // Japanese
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh'; // Chinese
    if (/[\u0400-\u04ff]/.test(text)) return 'ru'; // Cyrillic -> Russian
    if (/[äöåÄÖÅ]/.test(text)) return 'fi'; // Finnish characters
    log.info(' Could not detect language, defaulting to English');
    return 'en';
  }

  const lang = FRANC_TO_ISO[detected];
  console.log(`[LanguageDetection] Detected language: ${detected} -> ${lang || 'en'}`);
  return lang || 'en'; // Default to English if unknown
}
