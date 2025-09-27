import { Logger } from '../lib/logger.js';

/**
 * Translation Engine - Core translation orchestration and provider management
 *
 * Provides unified interface for translation services with intelligent provider selection,
 * adaptive rate limiting, cost optimization, and comprehensive error handling.
 *
 * @author Backend Systems Lead
 * @version 1.0.0
 */

/**
 * @typedef {Object} TranslateOptions
 * @property {string} [sourceLanguage] - Source language code (auto-detect if omitted)
 * @property {string} targetLanguage - Target language code
 * @property {'smart'|'fast'|'quality'} [strategy='smart'] - Translation strategy
 * @property {number} [maxRetries=3] - Maximum retry attempts
 * @property {number} [timeout=30000] - Request timeout in milliseconds
 * @property {'low'|'medium'|'high'} [priority='medium'] - Request priority
 * @property {boolean} [streaming=false] - Enable streaming translation
 */

/**
 * @typedef {Object} TranslationResult
 * @property {string} originalText - Original text
 * @property {string} translatedText - Translated text
 * @property {string} sourceLanguage - Detected/specified source language
 * @property {string} targetLanguage - Target language
 * @property {string} provider - Provider used for translation
 * @property {number} confidence - Translation confidence (0-1)
 * @property {number} cost - Translation cost in USD
 * @property {number} duration - Translation duration in milliseconds
 * @property {Object} metadata - Additional provider-specific metadata
 */

/**
 * @typedef {Object} BatchTranslationResult
 * @property {TranslationResult[]} results - Individual translation results
 * @property {number} totalCost - Total cost for batch
 * @property {number} totalDuration - Total duration for batch
 * @property {string} provider - Provider used for batch
 * @property {Object} summary - Batch processing summary
 */

class TranslationEngine {
    /**
     * Initialize translation engine with provider manager and rate limiter
     */
    constructor() {
        /** @type {Logger} */
        this.logger = Logger.create('translation-engine');

        /** @type {ProviderManager} */
        this.providerManager = null;

        /** @type {AdaptiveRateLimiter} */
        this.rateLimiter = null;

        /** @type {Map<string, TranslationResult>} Session cache for translations */
        this.cache = new Map();

        /** @type {boolean} */
        this.isInitialized = false;

        /** @type {AbortController[]} */
        this.activeRequests = [];

        /** @type {Object} */
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalCost: 0,
            totalDuration: 0,
            cacheHits: 0
        };
    }

    /**
     * Initialize the translation engine with dependencies
     * @param {ProviderManager} providerManager - Provider management instance
     * @param {AdaptiveRateLimiter} rateLimiter - Rate limiting instance
     */
    async initialize(providerManager, rateLimiter) {
        try {
            this.providerManager = providerManager;
            this.rateLimiter = rateLimiter;

            await this.providerManager.initialize();
            await this.rateLimiter.initialize();

            this.isInitialized = true;
            this.logger.info('Translation engine initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize translation engine:', error);
            throw new Error(`Translation engine initialization failed: ${error.message}`);
        }
    }

    /**
     * Translate single text with automatic provider selection
     * @param {string} text - Text to translate
     * @param {TranslateOptions} options - Translation options
     * @returns {Promise<TranslationResult>}
     */
    async translate(text, options = {}) {
        if (!this.isInitialized) {
            throw new Error('Translation engine not initialized');
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Invalid text input for translation');
        }

        const startTime = Date.now();
        const normalizedText = text.trim();
        const cacheKey = this._generateCacheKey(normalizedText, options);

        // Check cache first
        if (this.cache.has(cacheKey)) {
            this.metrics.cacheHits++;
            return {
                ...this.cache.get(cacheKey),
                duration: Date.now() - startTime
            };
        }

        const translationOptions = {
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            strategy: 'smart',
            maxRetries: 3,
            timeout: 30000,
            priority: 'medium',
            streaming: false,
            ...options
        };

        let lastError = null;
        let attempts = 0;
        const maxAttempts = translationOptions.maxRetries + 1;

        while (attempts < maxAttempts) {
            attempts++;

            try {
                // Select optimal provider
                const provider = await this.providerManager.selectProvider({
                    textLength: normalizedText.length,
                    strategy: translationOptions.strategy,
                    sourceLanguage: translationOptions.sourceLanguage,
                    targetLanguage: translationOptions.targetLanguage
                });

                if (!provider) {
                    throw new Error('No available providers for translation');
                }

                // Check rate limits
                const rateLimitCheck = await this.rateLimiter.canMakeRequest(
                    provider.id,
                    normalizedText.length
                );

                if (!rateLimitCheck.allowed) {
                    if (rateLimitCheck.suggestedProvider) {
                        // Try suggested alternative provider
                        const alternativeProvider = this.providerManager.getProvider(rateLimitCheck.suggestedProvider);
                        if (alternativeProvider) {
                            const result = await this._executeTranslation(
                                normalizedText,
                                translationOptions,
                                alternativeProvider,
                                startTime
                            );

                            this.cache.set(cacheKey, result);
                            return result;
                        }
                    }

                    throw new Error(`Rate limit exceeded: ${rateLimitCheck.reason}. Wait ${rateLimitCheck.waitTime}ms`);
                }

                // Execute translation
                const result = await this._executeTranslation(
                    normalizedText,
                    translationOptions,
                    provider,
                    startTime
                );

                // Cache successful result
                this.cache.set(cacheKey, result);
                this._updateMetrics(true, result.cost, result.duration);

                return result;

            } catch (error) {
                lastError = error;
                this.logger.warn(`Translation attempt ${attempts} failed:`, error.message);

                // Don't retry for certain errors
                if (error.message.includes('authentication') ||
                    error.message.includes('invalid API key') ||
                    error.message.includes('quota exceeded') ||
                    attempts >= maxAttempts) {
                    break;
                }

                // Wait before retry (exponential backoff)
                if (attempts < maxAttempts) {
                    const waitTime = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
                    await this._delay(waitTime);
                }
            }
        }

        this._updateMetrics(false, 0, Date.now() - startTime);
        throw new Error(`Translation failed after ${attempts} attempts: ${lastError?.message || 'Unknown error'}`);
    }

    /**
     * Translate multiple texts in batch with optimization
     * @param {string[]} texts - Array of texts to translate
     * @param {TranslateOptions} options - Translation options
     * @returns {Promise<BatchTranslationResult>}
     */
    async translateBatch(texts, options = {}) {
        if (!this.isInitialized) {
            throw new Error('Translation engine not initialized');
        }

        if (!Array.isArray(texts) || texts.length === 0) {
            throw new Error('Invalid texts array for batch translation');
        }

        const startTime = Date.now();
        const validTexts = texts.filter(text => text && typeof text === 'string' && text.trim().length > 0);

        if (validTexts.length === 0) {
            throw new Error('No valid texts provided for batch translation');
        }

        const batchOptions = {
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            strategy: 'smart',
            maxRetries: 3,
            timeout: 60000, // Longer timeout for batch
            priority: 'medium',
            ...options
        };

        try {
            // Check cache for existing translations
            const cachedResults = [];
            const uncachedTexts = [];
            const textIndexMap = new Map();

            validTexts.forEach((text, index) => {
                const normalizedText = text.trim();
                const cacheKey = this._generateCacheKey(normalizedText, batchOptions);

                if (this.cache.has(cacheKey)) {
                    cachedResults[index] = this.cache.get(cacheKey);
                    this.metrics.cacheHits++;
                } else {
                    uncachedTexts.push(normalizedText);
                    textIndexMap.set(normalizedText, index);
                }
            });

            let newResults = [];
            let provider = null;
            let totalCost = 0;

            // Translate uncached texts
            if (uncachedTexts.length > 0) {
                // Select provider for batch
                const totalLength = uncachedTexts.reduce((sum, text) => sum + text.length, 0);
                provider = await this.providerManager.selectProvider({
                    textLength: totalLength,
                    strategy: batchOptions.strategy,
                    sourceLanguage: batchOptions.sourceLanguage,
                    targetLanguage: batchOptions.targetLanguage,
                    batchSize: uncachedTexts.length
                });

                if (!provider) {
                    throw new Error('No available providers for batch translation');
                }

                // Check rate limits for batch
                const rateLimitCheck = await this.rateLimiter.canMakeRequest(
                    provider.id,
                    totalLength
                );

                if (!rateLimitCheck.allowed) {
                    throw new Error(`Rate limit exceeded for batch: ${rateLimitCheck.reason}`);
                }

                // Execute batch translation
                newResults = await this._executeBatchTranslation(
                    uncachedTexts,
                    batchOptions,
                    provider
                );

                // Cache new results
                newResults.forEach((result, index) => {
                    const originalText = uncachedTexts[index];
                    const cacheKey = this._generateCacheKey(originalText, batchOptions);
                    this.cache.set(cacheKey, result);
                    totalCost += result.cost;
                });
            }

            // Combine cached and new results
            const allResults = [];
            let newResultIndex = 0;

            validTexts.forEach((text, index) => {
                if (cachedResults[index]) {
                    allResults[index] = cachedResults[index];
                } else {
                    allResults[index] = newResults[newResultIndex++];
                }
            });

            const totalDuration = Date.now() - startTime;
            this._updateMetrics(true, totalCost, totalDuration);

            return {
                results: allResults,
                totalCost: totalCost + cachedResults.reduce((sum, result) => sum + (result?.cost || 0), 0),
                totalDuration,
                provider: provider?.id || 'mixed',
                summary: {
                    totalTexts: validTexts.length,
                    cachedResults: cachedResults.filter(r => r).length,
                    newTranslations: newResults.length,
                    averageCostPerText: totalCost / Math.max(newResults.length, 1)
                }
            };

        } catch (error) {
            this._updateMetrics(false, 0, Date.now() - startTime);
            throw new Error(`Batch translation failed: ${error.message}`);
        }
    }

    /**
     * Execute single translation with selected provider
     * @private
     */
    async _executeTranslation(text, options, provider, startTime) {
        const abortController = new AbortController();
        this.activeRequests.push(abortController);

        try {
            const translationStart = Date.now();

            const result = await provider.translate(text, {
                ...options,
                signal: abortController.signal
            });

            const duration = Date.now() - translationStart;

            // Record usage with rate limiter
            await this.rateLimiter.recordUsage(provider.id, {
                characterCount: text.length,
                cost: result.cost || 0,
                duration,
                success: true
            });

            return {
                originalText: text,
                translatedText: result.translatedText,
                sourceLanguage: result.sourceLanguage || options.sourceLanguage,
                targetLanguage: options.targetLanguage,
                provider: provider.id,
                confidence: result.confidence || 0.8,
                cost: result.cost || 0,
                duration,
                metadata: result.metadata || {}
            };

        } catch (error) {
            // Record failed usage
            await this.rateLimiter.recordUsage(provider.id, {
                characterCount: text.length,
                cost: 0,
                duration: Date.now() - startTime,
                success: false
            });

            throw error;
        } finally {
            this.activeRequests = this.activeRequests.filter(controller => controller !== abortController);
        }
    }

    /**
     * Execute batch translation with selected provider
     * @private
     */
    async _executeBatchTranslation(texts, options, provider) {
        if (provider.supportsBatch) {
            // Use provider's native batch support
            return await provider.translateBatch(texts, options);
        } else {
            // Fall back to individual translations with concurrency control
            const maxConcurrency = 5;
            const results = [];

            for (let i = 0; i < texts.length; i += maxConcurrency) {
                const batch = texts.slice(i, i + maxConcurrency);
                const batchPromises = batch.map(text =>
                    this._executeTranslation(text, options, provider, Date.now())
                );

                const batchResults = await Promise.allSettled(batchPromises);

                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        results.push(result.value);
                    } else {
                        this.logger.error(`Batch translation failed for text ${i + index}:`, result.reason);
                        // Create error result
                        results.push({
                            originalText: batch[index],
                            translatedText: batch[index], // Fallback to original
                            sourceLanguage: options.sourceLanguage,
                            targetLanguage: options.targetLanguage,
                            provider: provider.id,
                            confidence: 0,
                            cost: 0,
                            duration: 0,
                            metadata: { error: result.reason.message }
                        });
                    }
                });
            }

            return results;
        }
    }

    /**
     * Generate cache key for translation
     * @private
     */
    _generateCacheKey(text, options) {
        const key = `${options.sourceLanguage || 'auto'}:${options.targetLanguage}:${text}`;
        return key.length > 200 ? `${key.substring(0, 200)}:${this._hashString(key)}` : key;
    }

    /**
     * Simple hash function for long cache keys
     * @private
     */
    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    /**
     * Update engine metrics
     * @private
     */
    _updateMetrics(success, cost, duration) {
        this.metrics.totalRequests++;
        if (success) {
            this.metrics.successfulRequests++;
            this.metrics.totalCost += cost;
        } else {
            this.metrics.failedRequests++;
        }
        this.metrics.totalDuration += duration;
    }

    /**
     * Utility delay function
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current engine metrics
     * @returns {Object} Current metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            successRate: this.metrics.totalRequests > 0
                ? this.metrics.successfulRequests / this.metrics.totalRequests
                : 0,
            averageCost: this.metrics.successfulRequests > 0
                ? this.metrics.totalCost / this.metrics.successfulRequests
                : 0,
            averageDuration: this.metrics.totalRequests > 0
                ? this.metrics.totalDuration / this.metrics.totalRequests
                : 0,
            cacheHitRate: this.metrics.totalRequests > 0
                ? this.metrics.cacheHits / this.metrics.totalRequests
                : 0
        };
    }

    /**
     * Clear translation cache
     */
    clearCache() {
        this.cache.clear();
        this.logger.info('Translation cache cleared');
    }

    /**
     * Cancel all active translation requests
     */
    cancelAllRequests() {
        this.activeRequests.forEach(controller => {
            try {
                controller.abort();
            } catch (error) {
                this.logger.warn('Error aborting request:', error);
            }
        });
        this.activeRequests = [];
        this.logger.info('All active translation requests cancelled');
    }

    /**
     * Get engine status and health
     * @returns {Object} Engine status
     */
    async getStatus() {
        if (!this.isInitialized) {
            return {
                status: 'not_initialized',
                health: 'unknown',
                providers: [],
                metrics: this.getMetrics()
            };
        }

        try {
            const providerHealth = await this.providerManager.checkHealth();
            const healthyProviders = providerHealth.filter(p => p.healthy).length;

            return {
                status: 'initialized',
                health: healthyProviders > 0 ? 'healthy' : 'degraded',
                providers: providerHealth,
                activeRequests: this.activeRequests.length,
                cacheSize: this.cache.size,
                metrics: this.getMetrics()
            };
        } catch (error) {
            return {
                status: 'error',
                health: 'unhealthy',
                error: error.message,
                metrics: this.getMetrics()
            };
        }
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.cancelAllRequests();
        this.clearCache();
        this.isInitialized = false;
        this.logger.info('Translation engine destroyed');
    }
}

// Export for browser extension environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TranslationEngine };
} else if (typeof window !== 'undefined') {
    window.TranslationEngine = TranslationEngine;
}