/**
 * Language Detection
 *
 * Detection priority:
 *   1. Chrome's built-in LanguageDetector API (Chrome 138+) — ML-based, no bundle cost
 *   2. Firefox browser.i18n.detectLanguage — built-in, works on short text
 *   3. franc-min trigram model — offline fallback, needs ≥20 chars
 */

import { createLogger } from '../core/logger';
import { browserAPI } from '../core/browser-api';

const log = createLogger('LanguageDetection');

// Chrome 138+ LanguageDetector global (not yet in TS lib defs)
declare const LanguageDetector: {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(): Promise<{ detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>> }>;
} | undefined;

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
 * Detect language from text.
 *
 * Tries the best available detector in priority order:
 *   Chrome LanguageDetector API → Firefox i18n API → franc → character heuristics → 'en'
 */
export async function detectLanguage(text: string): Promise<string> {
  // 1. Chrome 138+ built-in LanguageDetector (ML model, works on short text)
  if (typeof LanguageDetector !== 'undefined') {
    try {
      const availability = await LanguageDetector.availability();
      if (availability === 'available') {
        const detector = await LanguageDetector.create();
        const results = await detector.detect(text.substring(0, 500));
        if (results.length > 0 && results[0].confidence >= 0.7) {
          log.debug(`Chrome LanguageDetector: "${results[0].detectedLanguage}" (${(results[0].confidence * 100).toFixed(0)}%)`);
          return results[0].detectedLanguage;
        }
      }
    } catch (e) {
      log.debug('Chrome LanguageDetector failed, trying next method:', e);
    }
  }

  // 2. Firefox built-in i18n language detection
  if (browserAPI.i18n && 'detectLanguage' in browserAPI.i18n) {
    try {
      const result = await (browserAPI.i18n as { detectLanguage(text: string): Promise<{ isReliable: boolean; languages: Array<{ language: string }> }> }).detectLanguage(text);
      if (result.isReliable && result.languages.length > 0) {
        const lang = result.languages[0].language.split('-')[0]; // strip region
        log.debug(`Firefox i18n.detectLanguage: "${lang}"`);
        return lang;
      }
    } catch (e) {
      log.debug('Firefox i18n.detectLanguage failed:', e);
    }
  }

  // 3. franc trigram model (needs ≥20 chars for reliable results) — lazy-loaded
  const { franc } = await import('franc-min');
  const detected = franc(text, { minLength: 20 });
  log.debug(`franc raw detection: "${detected}" for text: "${text.slice(0, 50)}..."`);

  if (detected === 'und' || !detected) {
    // 4. Unicode character-set heuristics for scripts franc often misses
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // Japanese kana
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh';               // CJK unified
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';               // Cyrillic → Russian
    if (/[äöåÄÖÅ]/.test(text)) return 'fi';                     // Finnish diacritics
    log.info('Could not detect language, defaulting to English');
    return 'en';
  }

  const lang = FRANC_TO_ISO[detected];
  log.info(`Detected language: ${detected} -> ${lang || 'en'}`);
  return lang || 'en';
}
