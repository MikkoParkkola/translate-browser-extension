/**
 * Language Detection Module
 * Handles language detection from text content and DOM context
 */

class AdvancedLanguageDetector {
  constructor(options = {}) {
    this.options = {
      enableDOMAnalysis: true,
      enableContextualHints: true,
      confidence: {
        word: 0.8,
        context: 0.7
      },
      ...options
    };

    // Simple language patterns
    this.patterns = {
      'zh': /[\u4e00-\u9fff]/,
      'ja': /[\u3040-\u309f\u30a0-\u30ff]/,
      'ko': /[\uac00-\ud7af]/,
      'ar': /[\u0600-\u06ff]/,
      'ru': /[\u0400-\u04ff]/,
      'th': /[\u0e00-\u0e7f]/,
      'he': /[\u0590-\u05ff]/,
      'hi': /[\u0900-\u097f]/
    };
  }

  async detectLanguage(text, context = {}) {
    if (!text || text.length < 10) return null;

    try {
      // Character-based detection for CJK and other scripts
      for (const [lang, pattern] of Object.entries(this.patterns)) {
        if (pattern.test(text)) {
          return {
            language: lang,
            confidence: 0.9,
            method: 'pattern',
            script: this.getScriptName(lang)
          };
        }
      }

      // For Latin script languages, use basic heuristics
      const result = this.detectLatinLanguage(text, context);
      return result;

    } catch (error) {
      console.warn('[LanguageDetector] Detection failed:', error);
      return null;
    }
  }

  detectLatinLanguage(text, context) {
    // Simple heuristics for common European languages
    const words = text.toLowerCase().split(/\s+/).slice(0, 20);

    const indicators = {
      'es': ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'una', 'muy'],
      'fr': ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son', 'une', 'sur', 'avec', 'ne', 'se', 'pas', 'tout', 'plus'],
      'de': ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im', 'dem', 'nicht', 'ein', 'eine', 'als', 'auch', 'es', 'an'],
      'it': ['il', 'di', 'che', 'e', 'la', 'per', 'un', 'in', 'con', 'del', 'da', 'non', 'le', 'si', 'gli', 'come', 'più', 'ma', 'tutti', 'una', 'su', 'anche'],
      'pt': ['de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'é', 'com', 'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos'],
      'nl': ['de', 'het', 'een', 'en', 'van', 'te', 'dat', 'op', 'is', 'in', 'die', 'niet', 'ik', 'hij', 'met', 'als', 'voor', 'aan', 'zijn', 'er', 'maar'],
      'en': ['the', 'and', 'to', 'of', 'a', 'in', 'is', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'as', 'with', 'his', 'they', 'i', 'at', 'be', 'this', 'have', 'from', 'or', 'one', 'had', 'by', 'words', 'but', 'not', 'what', 'all', 'were', 'we', 'when', 'your', 'can', 'said']
    };

    const scores = {};

    for (const [lang, commonWords] of Object.entries(indicators)) {
      let score = 0;
      for (const word of words) {
        if (commonWords.includes(word)) {
          score++;
        }
      }
      scores[lang] = score / words.length;
    }

    // Find language with highest score
    let bestLang = 'en';
    let bestScore = 0;

    for (const [lang, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestLang = lang;
      }
    }

    // Only return if confidence is reasonable
    if (bestScore > 0.15) {
      return {
        language: bestLang,
        confidence: Math.min(bestScore * 3, 0.9),
        method: 'heuristic',
        script: 'Latin'
      };
    }

    return null;
  }

  getScriptName(languageCode) {
    const scripts = {
      'zh': 'Han',
      'ja': 'Hiragana/Katakana',
      'ko': 'Hangul',
      'ar': 'Arabic',
      'ru': 'Cyrillic',
      'th': 'Thai',
      'he': 'Hebrew',
      'hi': 'Devanagari'
    };

    return scripts[languageCode] || 'Latin';
  }

  analyzeContext(element) {
    const context = {
      attributes: {},
      meta: {}
    };

    // Check language attributes
    if (element.lang) context.attributes.lang = element.lang;
    if (element.getAttribute('xml:lang')) context.attributes.xmlLang = element.getAttribute('xml:lang');

    // Check document-level hints
    const htmlLang = document.documentElement.lang;
    if (htmlLang) context.meta.documentLang = htmlLang;

    // Check meta tags
    const metaLang = document.querySelector('meta[http-equiv="content-language"]');
    if (metaLang) context.meta.contentLanguage = metaLang.content;

    return context;
  }
}

export { AdvancedLanguageDetector };