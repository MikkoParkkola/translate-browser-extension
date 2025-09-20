/**
 * Translation Processor - Responsible for actual translation logic
 * 
 * Handles API communication, caching, retry mechanisms, and translation
 * result processing for the content script.
 */

class TranslationProcessor {
  constructor(logger, security, errorHandler) {
    this.logger = logger;
    this.security = security;
    this.errorHandler = errorHandler;
    
    // Translation state
    this.abortControllers = new Set();
    this.translationCache = new Map();
    this.currentConfig = null;
    
    // Statistics
    this.stats = {
      requests: 0,
      totalRequests: 0,
      tokens: 0,
      words: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Initialize processor with configuration
   * @param {Object} config - Translation configuration
   */
  async initialize(config) {
    this.currentConfig = config;
    this.logger?.debug('Translation processor initialized with config:', config);
  }

  /**
   * Process a batch of translation nodes
   * @param {Object} batchItem - Batch item with nodes and metadata
   * @returns {Promise<Object>} - Translation results
   */
  async processBatch(batchItem) {
    const { nodes, id } = batchItem;
    
    this.logger?.debug(`Processing translation batch ${id} with ${nodes.length} nodes`);
    
    // Extract unique texts from nodes
    const textMap = this.extractTexts(nodes);
    const uniqueTexts = Array.from(textMap.keys());
    
    if (uniqueTexts.length === 0) {
      return { success: true, results: [] };
    }
    
    // Check cache first
    const cacheResults = this.checkCache(uniqueTexts);
    const uncachedTexts = cacheResults.uncachedTexts;
    
    let translationResults = cacheResults.cachedResults;
    
    // Translate uncached texts
    if (uncachedTexts.length > 0) {
      try {
        const apiResults = await this.translateTexts(uncachedTexts);
        
        // Cache results
        this.cacheResults(apiResults);
        
        // Merge with cached results
        translationResults = { ...translationResults, ...apiResults };
        
      } catch (error) {
        this.logger?.error(`Translation batch ${id} failed:`, error);
        throw error;
      }
    }
    
    // Apply translations to DOM nodes
    const appliedCount = this.applyTranslations(textMap, translationResults);
    
    this.updateStats({
      processed: nodes.length,
      applied: appliedCount,
      cacheHits: cacheResults.cacheHits,
      cacheMisses: uncachedTexts.length,
    });
    
    return {
      success: true,
      processed: nodes.length,
      applied: appliedCount,
      cacheHits: cacheResults.cacheHits,
      cacheMisses: uncachedTexts.length,
    };
  }

  /**
   * Extract unique texts from nodes
   * @param {Node[]} nodes - Array of text nodes
   * @returns {Map} - Map of text -> array of nodes
   */
  extractTexts(nodes) {
    const textMap = new Map();
    
    for (const node of nodes) {
      const text = node.textContent?.trim();
      if (!text) continue;
      
      if (!textMap.has(text)) {
        textMap.set(text, []);
      }
      textMap.get(text).push(node);
    }
    
    return textMap;
  }

  /**
   * Check cache for translations
   * @param {string[]} texts - Texts to check
   * @returns {Object} - Cache results
   */
  checkCache(texts) {
    const cachedResults = {};
    const uncachedTexts = [];
    let cacheHits = 0;
    
    for (const text of texts) {
      const cacheKey = this.getCacheKey(text);
      
      if (this.translationCache.has(cacheKey)) {
        cachedResults[text] = this.translationCache.get(cacheKey);
        cacheHits++;
      } else {
        uncachedTexts.push(text);
      }
    }
    
    this.logger?.debug(`Cache check: ${cacheHits} hits, ${uncachedTexts.length} misses`);
    
    return {
      cachedResults,
      uncachedTexts,
      cacheHits,
    };
  }

  /**
   * Generate cache key for text
   * @param {string} text - Text to generate key for
   * @returns {string} - Cache key
   */
  getCacheKey(text) {
    const sourceLang = this.currentConfig?.sourceLang || 'auto';
    const targetLang = this.currentConfig?.targetLang || 'en';
    return `${sourceLang}:${targetLang}:${text}`;
  }

  /**
   * Translate texts via API
   * @param {string[]} texts - Texts to translate
   * @returns {Promise<Object>} - Translation results
   */
  async translateTexts(texts) {
    if (!texts || texts.length === 0) {
      return {};
    }
    
    // Create abort controller for this request
    const controller = new AbortController();
    this.abortControllers.add(controller);
    
    try {
      // Prepare translation options
      const opts = {
        text: texts.join('\n'),
        source: this.currentConfig?.sourceLang || 'auto',
        target: this.currentConfig?.targetLang || 'en',
        signal: controller.signal,
      };
      
      // Security validation
      if (this.security?.validateInput) {
        const validation = this.security.validateInput(opts.text);
        if (!validation.valid) {
          throw new Error(`Security validation failed: ${validation.issues.join(', ')}`);
        }
        opts.text = validation.sanitized;
      }
      
      // Send translation request to background script
      const result = await this.sendTranslationRequest(opts);
      
      if (!result || result.error) {
        throw new Error(result?.error || 'Translation request failed');
      }
      
      // Parse translation results
      const translatedTexts = this.parseTranslationResult(result, texts);
      
      this.updateStats({
        requests: 1,
        totalRequests: 1,
        tokens: this.estimateTokens(opts.text),
        words: this.estimateWords(opts.text),
      });
      
      return translatedTexts;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger?.debug('Translation request aborted');
        throw new Error('Translation cancelled');
      }
      
      this.logger?.error('Translation API error:', error);
      throw error;
      
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  /**
   * Send translation request to background script
   * @param {Object} opts - Translation options
   * @returns {Promise<Object>} - Translation result
   */
  async sendTranslationRequest(opts) {
    // Check if qwenTranslateBatch is available for direct translation
    if (typeof window !== 'undefined' && window.qwenTranslateBatch) {
      try {
        return await window.qwenTranslateBatch(opts);
      } catch (error) {
        this.logger?.warn('Direct qwenTranslateBatch failed, falling back to background script:', error);
      }
    }
    
    // Fallback to background script
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Translation request timeout'));
      }, this.currentConfig?.translateTimeoutMs || 30000);
      
      chrome.runtime.sendMessage(
        { action: 'translate', opts },
        (response) => {
          clearTimeout(timeout);
          
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          resolve(response);
        }
      );
    });
  }

  /**
   * Parse translation API result
   * @param {Object} result - API result
   * @param {string[]} originalTexts - Original texts
   * @returns {Object} - Parsed translations
   */
  parseTranslationResult(result, originalTexts) {
    if (!result.text) {
      throw new Error('No translation text in result');
    }
    
    const translatedLines = result.text.split('\n');
    const translations = {};
    
    // Map translated lines back to original texts
    for (let i = 0; i < originalTexts.length && i < translatedLines.length; i++) {
      const original = originalTexts[i];
      const translated = translatedLines[i]?.trim();
      
      if (translated && translated !== original) {
        // Security sanitization
        if (this.security?.sanitizeTranslationText) {
          translations[original] = this.security.sanitizeTranslationText(translated);
        } else {
          translations[original] = translated;
        }
      }
    }
    
    return translations;
  }

  /**
   * Cache translation results
   * @param {Object} results - Translation results to cache
   */
  cacheResults(results) {
    for (const [original, translated] of Object.entries(results)) {
      const cacheKey = this.getCacheKey(original);
      this.translationCache.set(cacheKey, translated);
    }
    
    // Clean cache if it gets too large
    if (this.translationCache.size > 1000) {
      this.cleanCache();
    }
  }

  /**
   * Clean translation cache
   */
  cleanCache() {
    // Remove oldest entries if cache is too large
    const entries = Array.from(this.translationCache.entries());
    const toKeep = entries.slice(-500); // Keep newest 500 entries
    
    this.translationCache.clear();
    for (const [key, value] of toKeep) {
      this.translationCache.set(key, value);
    }
    
    this.logger?.debug(`Cache cleaned, kept ${toKeep.length} entries`);
  }

  /**
   * Apply translations to DOM nodes
   * @param {Map} textMap - Map of text -> nodes
   * @param {Object} translations - Translation results
   * @returns {number} - Number of nodes updated
   */
  applyTranslations(textMap, translations) {
    let appliedCount = 0;
    
    for (const [originalText, nodes] of textMap.entries()) {
      const translatedText = translations[originalText];
      if (!translatedText) continue;
      
      for (const node of nodes) {
        try {
          // Update node content
          node.textContent = translatedText;
          
          // Mark as translated
          this.markNodeAsTranslated(node);
          
          appliedCount++;
          
        } catch (error) {
          this.logger?.warn('Failed to apply translation to node:', error);
        }
      }
    }
    
    this.logger?.debug(`Applied ${appliedCount} translations to DOM`);
    return appliedCount;
  }

  /**
   * Mark node as translated
   * @param {Node} node - Node to mark
   */
  markNodeAsTranslated(node) {
    const parent = node.parentElement;
    if (!parent) return;
    
    parent.setAttribute('data-qwen-translated', 'true');
    parent.classList.add('qwen-translated');
  }

  /**
   * Estimate token count for text
   * @param {string} text - Text to estimate
   * @returns {number} - Estimated token count
   */
  estimateTokens(text) {
    if (window.qwenThrottle?.approxTokens) {
      return window.qwenThrottle.approxTokens(text);
    }
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate word count for text
   * @param {string} text - Text to estimate
   * @returns {number} - Estimated word count
   */
  estimateWords(text) {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Update processing statistics
   * @param {Object} updates - Statistics updates
   */
  updateStats(updates) {
    this.stats = { ...this.stats, ...updates };
  }

  /**
   * Abort all ongoing translations
   */
  abortAll() {
    for (const controller of this.abortControllers) {
      try {
        controller.abort();
      } catch (error) {
        this.logger?.warn('Error aborting translation:', error);
      }
    }
    this.abortControllers.clear();
    
    this.logger?.debug('All translation requests aborted');
  }

  /**
   * Clear translation cache
   */
  clearCache() {
    this.translationCache.clear();
    this.logger?.debug('Translation cache cleared');
  }

  /**
   * Get processor statistics
   * @returns {Object} - Current statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.translationCache.size,
      activeRequests: this.abortControllers.size,
    };
  }

  /**
   * Clean up processor resources
   */
  cleanup() {
    this.abortAll();
    this.clearCache();
    this.stats = {
      requests: 0,
      totalRequests: 0,
      tokens: 0,
      words: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationProcessor;
} else {
  self.qwenTranslationProcessor = TranslationProcessor;
}