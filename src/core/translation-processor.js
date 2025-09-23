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
    this.currentConfig = null;

    // High-performance LRU cache with memory limits
    this.cacheConfig = {
      maxEntries: 5000,
      maxMemoryMB: 30,
      ttlMs: 24 * 60 * 60 * 1000, // 24 hour TTL
      cleanupIntervalMs: 5 * 60 * 1000 // 5 minute cleanup
    };

    this.translationCache = new Map();
    this.cacheOrder = new Map(); // Track access order for LRU
    this.cacheMemorySize = 0;
    this.lastCleanup = Date.now();

    // Statistics with performance tracking
    this.stats = {
      requests: 0,
      totalRequests: 0,
      tokens: 0,
      words: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgProcessingTimeMs: 0,
      memoryUsageMB: 0,
    };
  }

  /**
   * Initialize processor with configuration
   * @param {Object} config - Translation configuration
   */
  async initialize(config) {
    const normalized = { ...(config || {}) };
    normalized.sourceLang = normalized.sourceLang || normalized.sourceLanguage || normalized.source || 'auto';
    normalized.targetLang = normalized.targetLang || normalized.targetLanguage || normalized.target || 'en';
    const order = Array.isArray(normalized.providerOrder) ? normalized.providerOrder.filter(Boolean) : [];
    const ordered = normalized.provider ? [normalized.provider, ...order] : order;
    normalized.providerOrder = Array.from(new Set(ordered));
    normalized.endpoints = typeof normalized.endpoints === 'object' && normalized.endpoints !== null ? { ...normalized.endpoints } : {};
    if (normalized.provider && normalized.apiEndpoint && !normalized.endpoints[normalized.provider]) {
      normalized.endpoints[normalized.provider] = String(normalized.apiEndpoint);
    }
    normalized.failover = normalized.failover !== false;
    normalized.debug = Boolean(normalized.debug);
    this.currentConfig = normalized;
    this.logger?.debug('Translation processor initialized with config:', normalized);
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
   * Check cache for translations with access tracking
   * @param {string[]} texts - Texts to check
   * @returns {Object} - Cache results
   */
  checkCache(texts) {
    const cachedResults = {};
    const uncachedTexts = [];
    let cacheHits = 0;
    const now = Date.now();

    for (const text of texts) {
      const cacheKey = this.getCacheKey(text);
      const entry = this.translationCache.get(cacheKey);

      if (entry && (now - entry.timestamp) < this.cacheConfig.ttlMs) {
        // Update access time and count for LRU
        entry.accessCount++;
        this.cacheOrder.set(cacheKey, now);

        cachedResults[text] = entry.value;
        cacheHits++;
      } else {
        // Remove expired entry
        if (entry) {
          this.cacheMemorySize -= entry.size;
          this.translationCache.delete(cacheKey);
          this.cacheOrder.delete(cacheKey);
        }
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
      const cfg = this.currentConfig || {};
      const opts = {
        text: texts.join('\n'),
        source: cfg.sourceLang || 'auto',
        target: cfg.targetLang || 'en',
        model: cfg.model,
        endpoint: cfg.apiEndpoint,
        provider: cfg.provider,
        providerOrder: cfg.providerOrder && cfg.providerOrder.length ? cfg.providerOrder : undefined,
        endpoints: Object.keys(cfg.endpoints || {}).length ? cfg.endpoints : undefined,
        detector: cfg.detector,
        failover: cfg.failover,
        parallel: cfg.parallel,
        debug: cfg.debug,
        autoInit: true,
        signal: controller.signal,
      };
      if (cfg.tokenBudget) {
        opts.tokenBudget = cfg.tokenBudget;
      }
      
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
   * Cache translation results with LRU eviction and memory management
   * @param {Object} results - Translation results to cache
   */
  cacheResults(results) {
    const now = Date.now();

    for (const [original, translated] of Object.entries(results)) {
      const cacheKey = this.getCacheKey(original);
      const entry = {
        value: translated,
        timestamp: now,
        accessCount: 1,
        size: this.estimateMemorySize(original + translated)
      };

      // Remove old entry if exists
      if (this.translationCache.has(cacheKey)) {
        this.cacheMemorySize -= this.translationCache.get(cacheKey).size;
      }

      this.translationCache.set(cacheKey, entry);
      this.cacheOrder.set(cacheKey, now);
      this.cacheMemorySize += entry.size;
    }

    // Trigger cleanup if memory or size limits exceeded
    if (this.shouldCleanCache()) {
      this.cleanCache();
    }
  }

  /**
   * Determine if cache should be cleaned
   * @returns {boolean} - Whether cleanup is needed
   */
  shouldCleanCache() {
    const now = Date.now();
    const memoryLimitMB = this.cacheConfig.maxMemoryMB;
    const sizeLimit = this.cacheConfig.maxEntries;
    const timeSinceCleanup = now - this.lastCleanup;

    return (
      this.cacheMemorySize > memoryLimitMB * 1024 * 1024 ||
      this.translationCache.size > sizeLimit ||
      timeSinceCleanup > this.cacheConfig.cleanupIntervalMs
    );
  }

  /**
   * Clean translation cache with LRU eviction and TTL
   */
  cleanCache() {
    const now = Date.now();
    const ttl = this.cacheConfig.ttlMs;
    const maxEntries = this.cacheConfig.maxEntries;
    const maxMemoryBytes = this.cacheConfig.maxMemoryMB * 1024 * 1024;

    // Remove expired entries first
    let removedExpired = 0;
    for (const [key, entry] of this.translationCache.entries()) {
      if (now - entry.timestamp > ttl) {
        this.cacheMemorySize -= entry.size;
        this.translationCache.delete(key);
        this.cacheOrder.delete(key);
        removedExpired++;
      }
    }

    // If still over limits, apply LRU eviction
    if (this.translationCache.size > maxEntries || this.cacheMemorySize > maxMemoryBytes) {
      // Sort by access time (LRU)
      const sortedEntries = Array.from(this.cacheOrder.entries())
        .sort((a, b) => a[1] - b[1]); // Sort by timestamp

      let removedLRU = 0;
      for (const [key] of sortedEntries) {
        if (this.translationCache.size <= maxEntries * 0.8 &&
            this.cacheMemorySize <= maxMemoryBytes * 0.8) {
          break;
        }

        const entry = this.translationCache.get(key);
        if (entry) {
          this.cacheMemorySize -= entry.size;
          this.translationCache.delete(key);
          this.cacheOrder.delete(key);
          removedLRU++;
        }
      }
    }

    this.lastCleanup = now;
    this.updateMemoryStats();

    this.logger?.debug(`Cache cleaned: ${removedExpired} expired, ${removedLRU} LRU evicted, ${this.translationCache.size} entries remaining`);
  }

  /**
   * Estimate memory size of a string in bytes
   * @param {string} str - String to estimate
   * @returns {number} - Estimated bytes
   */
  estimateMemorySize(str) {
    // JavaScript uses UTF-16, so 2 bytes per character + object overhead
    return (str.length * 2) + 64;
  }

  /**
   * Update memory usage statistics
   */
  updateMemoryStats() {
    this.stats.memoryUsageMB = this.cacheMemorySize / (1024 * 1024);
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