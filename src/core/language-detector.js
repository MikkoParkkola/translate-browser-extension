/**
 * Language Detector Module - Implements DetectorInterface
 * Provides language detection with multiple strategies and fallbacks
 */

// Initialize logger
const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
  ? window.qwenLogger.create('language-detector')
  : (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create)
    ? self.qwenLogger.create('language-detector')
    : console;

/**
 * Language Detector implementation
 */
class LanguageDetector {
  constructor(options = {}) {
    this.defaultMinLength = options.minLength || 10;
    this.defaultSensitivity = options.sensitivity || 0.5;
    this.fallbackLanguage = options.fallbackLanguage || 'en';
    
    // Try to load existing detector modules
    this.detectors = [];
    this._initDetectors();
  }

  /**
   * Initialize available detector modules
   * @private
   */
  _initDetectors() {
    // Try to load local detector
    try {
      if (typeof window !== 'undefined' && window.qwenDetect) {
        this.detectors.push({
          name: 'local',
          detect: window.qwenDetect.detectLocal,
          priority: 3
        });
      } else if (typeof self !== 'undefined' && self.qwenDetect) {
        this.detectors.push({
          name: 'local',
          detect: self.qwenDetect.detectLocal,
          priority: 3
        });
      } else if (typeof require !== 'undefined') {
        const localDetector = require('../lib/detect');
        if (localDetector && localDetector.detectLocal) {
          this.detectors.push({
            name: 'local',
            detect: localDetector.detectLocal,
            priority: 3
          });
        }
      }
    } catch (e) {
      logger.warn('Local language detector not available:', e);
    }

    // Add simple pattern-based detector as fallback
    this.detectors.push({
      name: 'pattern',
      detect: this._patternBasedDetection.bind(this),
      priority: 1
    });

    // Sort by priority (higher first)
    this.detectors.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Detect language of text
   * @param {string} text - Text to analyze
   * @param {Object} options - Detection options
   * @returns {Promise<Object>} Detection result with lang and confidence
   */
  async detect(text, options = {}) {
    const {
      minLength = this.defaultMinLength,
      sensitivity = this.defaultSensitivity,
      strategy = 'best'
    } = options;

    // Preprocess text
    const cleanText = this._preprocessText(text);
    
    if (cleanText.length < minLength) {
      return {
        lang: this.fallbackLanguage,
        confidence: 0.1,
        reason: 'text_too_short'
      };
    }

    let bestResult = {
      lang: this.fallbackLanguage,
      confidence: 0,
      reason: 'no_detection'
    };

    // Try each detector in priority order
    for (const detector of this.detectors) {
      try {
        const result = await this._runDetector(detector, cleanText, options);
        
        if (result && result.confidence > sensitivity) {
          if (strategy === 'first' || result.confidence > bestResult.confidence) {
            bestResult = {
              ...result,
              detector: detector.name
            };
            
            if (strategy === 'first') break;
          }
        }
      } catch (e) {
        logger.warn(`Detector ${detector.name} failed:`, e);
        continue;
      }
    }

    return bestResult;
  }

  /**
   * Run a specific detector
   * @private
   */
  async _runDetector(detector, text, options) {
    if (typeof detector.detect !== 'function') {
      return null;
    }

    const result = await detector.detect(text, options);
    
    if (!result || typeof result !== 'object') {
      return null;
    }

    return {
      lang: result.lang || result.language || this.fallbackLanguage,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5
    };
  }

  /**
   * Simple pattern-based language detection fallback
   * @private
   */
  _patternBasedDetection(text) {
    const patterns = {
      'zh': /[\u4e00-\u9fff]/,  // Chinese characters
      'ja': /[\u3040-\u309f\u30a0-\u30ff]/,  // Hiragana/Katakana
      'ko': /[\uac00-\ud7af]/,  // Korean
      'ar': /[\u0600-\u06ff]/,  // Arabic
      'ru': /[\u0400-\u04ff]/,  // Cyrillic
      'th': /[\u0e00-\u0e7f]/,  // Thai
      'hi': /[\u0900-\u097f]/,  // Devanagari
      'es': /[ñáéíóúü]/i,      // Spanish chars
      'fr': /[àâäéèêëïîôöùûüÿç]/i, // French chars
      'de': /[äöüß]/i,         // German chars
      'pt': /[ãáâàéêíóôõúç]/i  // Portuguese chars
    };

    let bestMatch = { lang: 'en', confidence: 0.1 };
    
    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = text.match(pattern);
      if (matches) {
        const confidence = Math.min(0.9, matches.length / text.length + 0.3);
        if (confidence > bestMatch.confidence) {
          bestMatch = { lang, confidence };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Preprocess text for detection
   * @private
   */
  _preprocessText(text) {
    if (typeof text !== 'string') return '';
    
    // Remove excessive whitespace and limit length
    return text.replace(/\s+/g, ' ').trim().slice(0, 2000);
  }

  /**
   * Get supported languages for detection
   * @returns {Array<string>} Array of supported language codes
   */
  getSupportedLanguages() {
    // Return common languages that the detector can identify
    return [
      'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'pl', 'tr',
      'zh', 'ja', 'ko', 'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tl',
      'sv', 'no', 'da', 'fi', 'hu', 'cs', 'sk', 'hr', 'sr', 'bg',
      'ro', 'el', 'he', 'fa', 'ur', 'bn', 'ta', 'te', 'kn', 'ml'
    ];
  }

  /**
   * Check if a language is supported
   * @param {string} lang - Language code
   * @returns {boolean} True if supported
   */
  supportsLanguage(lang) {
    return this.getSupportedLanguages().includes(lang);
  }

  /**
   * Get detector statistics
   * @returns {Object} Detector statistics
   */
  getStats() {
    return {
      detectorsAvailable: this.detectors.length,
      detectors: this.detectors.map(d => ({ name: d.name, priority: d.priority })),
      supportedLanguages: this.getSupportedLanguages().length
    };
  }
}

// Create default instance
const defaultDetector = new LanguageDetector();

// Export for different environments
if (typeof module !== 'undefined') {
  module.exports = {
    LanguageDetector,
    defaultDetector
  };
}

if (typeof window !== 'undefined') {
  window.qwenLanguageDetector = {
    LanguageDetector,
    defaultDetector
  };
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenLanguageDetector = {
    LanguageDetector,
    defaultDetector
  };
}