/**
 * Base Provider Interface
 * All translation providers must implement this interface
 */

export class BaseProvider {
  constructor(config = {}) {
    this.id = config.id || 'unknown';
    this.name = config.name || 'Unknown Provider';
    this.type = config.type || 'cloud'; // 'local' | 'cloud' | 'hybrid'
    this.qualityTier = config.qualityTier || 'standard'; // 'basic' | 'standard' | 'premium'
    this.costPerMillion = config.costPerMillion || 0; // 0 for local
    this.icon = config.icon || '🌐';
  }

  /**
   * Translate text
   * @param {string|string[]} text - Text or array of texts to translate
   * @param {string} sourceLang - Source language code (e.g., 'en', 'fi')
   * @param {string} targetLang - Target language code
   * @param {Object} options - Additional options
   * @returns {Promise<string|string[]>} Translated text(s)
   */
  async translate(text, sourceLang, targetLang, options = {}) {
    throw new Error('translate() must be implemented');
  }

  /**
   * Detect language of text
   * @param {string} text - Text to detect
   * @returns {Promise<string>} Language code
   */
  async detectLanguage(text) {
    throw new Error('detectLanguage() must be implemented');
  }

  /**
   * Check if provider is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return true;
  }

  /**
   * Get usage statistics
   * @returns {Promise<Object>} Usage stats
   */
  async getUsage() {
    return {
      requests: 0,
      tokens: 0,
      cost: 0,
      limitReached: false,
    };
  }

  /**
   * Validate configuration
   * @returns {Promise<boolean>}
   */
  async validateConfig() {
    return true;
  }

  /**
   * Get supported language pairs
   * @returns {Array} Language pairs
   */
  getSupportedLanguages() {
    return [];
  }

  /**
   * Test the provider
   * @returns {Promise<boolean>}
   */
  async test() {
    try {
      const result = await this.translate('Hello', 'en', 'fi');
      return result && result.length > 0;
    } catch (error) {
      console.error(`${this.name} test failed:`, error);
      return false;
    }
  }

  /**
   * Get provider info for UI
   * @returns {Object}
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      qualityTier: this.qualityTier,
      costPerMillion: this.costPerMillion,
      icon: this.icon,
    };
  }
}

export default BaseProvider;
