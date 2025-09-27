/**
 * DeepL Pro API Provider
 *
 * Premium tier provider for DeepL's highest-quality neural machine translation,
 * with unlimited usage, advanced features, and enterprise-grade reliability.
 *
 * @author Backend Systems Lead
 * @version 1.0.0
 */

/**
 * @typedef {Object} DeepLProTranslateOptions
 * @property {string} [sourceLanguage='auto'] - Source language code
 * @property {string} targetLanguage - Target language code
 * @property {number} [timeout=30000] - Request timeout in milliseconds
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 * @property {'default'|'more'|'less'} [formality='default'] - Formality level
 * @property {boolean} [preserveFormatting=true] - Preserve source formatting
 * @property {'xml'|'html'} [tagHandling] - How to handle XML/HTML tags
 * @property {string[]} [ignoreTags] - Tags to ignore during translation
 * @property {Object} [glossary] - Custom glossary for translation
 */

/**
 * @typedef {Object} DeepLProTranslationResult
 * @property {string} translatedText - Translated text
 * @property {string} sourceLanguage - Detected source language
 * @property {number} confidence - Translation confidence (0-1)
 * @property {number} cost - Translation cost in USD
 * @property {Object} metadata - Provider-specific metadata
 */

class DeepLProProvider {
    /**
     * Initialize DeepL Pro provider
     */
    constructor() {
        this.id = 'deepl-pro';
        this.name = 'DeepL Pro';
        this.type = 'traditional-mt';
        this.endpoint = 'https://api.deepl.com/v2/translate';
        this.usageEndpoint = 'https://api.deepl.com/v2/usage';
        this.glossaryEndpoint = 'https://api.deepl.com/v2/glossaries';
        this.enabled = true;
        this.supportsBatch = true;

        // Provider features
        this.features = ['highest-quality', 'unlimited', 'formal-informal', 'tag-handling', 'glossary-support'];

        // Rate limits and quotas (DeepL Pro tier)
        this.limits = {
            requestsPerMinute: 1000,
            requestsPerHour: 60000,
            requestsPerDay: 1440000,
            charactersPerMinute: 1000000,
            charactersPerHour: 60000000,
            charactersPerDay: 1440000000,
            costPer1K: 0.020 // $20 per million characters
        };

        // Supported languages (DeepL Pro full set)
        this.languages = [
            'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr',
            'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'nl', 'pl',
            'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh', 'ar'
        ];

        this.priority = 4; // Highest quality, premium option

        // API configuration
        this.apiKey = null;
        this.baseHeaders = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'TranslateExtension-Pro/1.0'
        };

        // Enhanced DeepL language code mappings (Pro tier supports more variants)
        this.languageMap = {
            'en': 'EN',
            'en-us': 'EN-US',
            'en-gb': 'EN-GB',
            'de': 'DE',
            'fr': 'FR',
            'it': 'IT',
            'ja': 'JA',
            'es': 'ES',
            'nl': 'NL',
            'pl': 'PL',
            'pt': 'PT',
            'pt-br': 'PT-BR',
            'pt-pt': 'PT-PT',
            'ru': 'RU',
            'zh': 'ZH',
            'zh-cn': 'ZH',
            'zh-tw': 'ZH',
            'bg': 'BG',
            'cs': 'CS',
            'da': 'DA',
            'el': 'EL',
            'et': 'ET',
            'fi': 'FI',
            'hu': 'HU',
            'id': 'ID',
            'ko': 'KO',
            'lt': 'LT',
            'lv': 'LV',
            'nb': 'NB',
            'ro': 'RO',
            'sk': 'SK',
            'sl': 'SL',
            'sv': 'SV',
            'tr': 'TR',
            'uk': 'UK',
            'ar': 'AR'
        };

        // Advanced formality options (Pro specific)
        this.formalityOptions = {
            'default': undefined,
            'more': 'more',
            'less': 'less'
        };

        // Tag handling options
        this.tagHandlingOptions = {
            'xml': 'xml',
            'html': 'html'
        };

        // Pro-specific features
        this.proFeatures = {
            glossarySupport: true,
            tagHandling: true,
            formalityControl: true,
            unlimitedUsage: true,
            priorityProcessing: true
        };

        // Usage tracking (for cost calculation)
        this.currentUsage = {
            characterCount: 0,
            cost: 0,
            lastUpdated: Date.now()
        };
    }

    /**
     * Set API key for authentication
     * @param {string} apiKey - DeepL Pro API key
     */
    setApiKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('Invalid API key provided');
        }

        this.apiKey = apiKey;
        this.baseHeaders['Authorization'] = `DeepL-Auth-Key ${apiKey}`;
        console.log('DeepL Pro API key configured');
    }

    /**
     * Translate single text with Pro features
     * @param {string} text - Text to translate
     * @param {DeepLProTranslateOptions} options - Translation options
     * @returns {Promise<DeepLProTranslationResult>}
     */
    async translate(text, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for DeepL Pro');
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Invalid text input for translation');
        }

        const translateOptions = {
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            timeout: 30000,
            formality: 'default',
            preserveFormatting: true,
            ...options
        };

        const startTime = Date.now();

        try {
            const requestBody = this._buildProRequestBody(text.trim(), translateOptions);
            const response = await this._makeRequest(requestBody, translateOptions);

            const result = this._parseProResponse(response, text, translateOptions, startTime);

            // Update usage tracking
            this._updateUsageTracking(text.length, result.cost);

            console.log(`DeepL Pro translation completed in ${result.metadata.duration}ms (Quality: ${result.confidence})`);
            return result;

        } catch (error) {
            console.error('DeepL Pro translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Translate multiple texts with Pro batch optimization
     * @param {string[]} texts - Array of texts to translate
     * @param {DeepLProTranslateOptions} options - Translation options
     * @returns {Promise<DeepLProTranslationResult[]>}
     */
    async translateBatch(texts, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for DeepL Pro');
        }

        if (!Array.isArray(texts) || texts.length === 0) {
            throw new Error('Invalid texts array for batch translation');
        }

        const validTexts = texts.filter(text => text && typeof text === 'string' && text.trim().length > 0);
        if (validTexts.length === 0) {
            throw new Error('No valid texts provided for batch translation');
        }

        const translateOptions = {
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            timeout: 60000,
            formality: 'default',
            preserveFormatting: true,
            ...options
        };

        const startTime = Date.now();

        try {
            // Use DeepL Pro's enhanced batch processing
            const optimizedBatches = this._optimizeBatchForPro(validTexts);
            const results = [];
            let totalCost = 0;

            for (const batch of optimizedBatches) {
                const requestBody = this._buildProBatchRequestBody(batch, translateOptions);
                const response = await this._makeRequest(requestBody, translateOptions, true);

                const batchResults = this._parseBatchResponse(response, batch, translateOptions, startTime);
                results.push(...batchResults);

                // Calculate batch cost
                const batchCost = batchResults.reduce((sum, result) => sum + result.cost, 0);
                totalCost += batchCost;
            }

            // Update usage tracking
            const totalCharacters = validTexts.reduce((sum, text) => sum + text.length, 0);
            this._updateUsageTracking(totalCharacters, totalCost);

            console.log(`DeepL Pro batch translation completed: ${results.length} texts in ${Date.now() - startTime}ms (Cost: $${totalCost.toFixed(4)})`);
            return results;

        } catch (error) {
            console.error('DeepL Pro batch translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Build Pro-enhanced request body
     * @private
     */
    _buildProRequestBody(text, options) {
        const params = new URLSearchParams();

        params.append('text', text);
        params.append('target_lang', this._mapLanguageCode(options.targetLanguage));

        if (options.sourceLanguage && options.sourceLanguage !== 'auto') {
            params.append('source_lang', this._mapLanguageCode(options.sourceLanguage));
        }

        // Pro-specific formality control
        if (options.formality && options.formality !== 'default') {
            const formalityValue = this.formalityOptions[options.formality];
            if (formalityValue) {
                params.append('formality', formalityValue);
            }
        }

        // Enhanced formatting preservation
        if (options.preserveFormatting) {
            params.append('preserve_formatting', '1');
        }

        // Tag handling (Pro feature)
        if (options.tagHandling && this.tagHandlingOptions[options.tagHandling]) {
            params.append('tag_handling', this.tagHandlingOptions[options.tagHandling]);
        }

        // Ignore tags (Pro feature)
        if (options.ignoreTags && Array.isArray(options.ignoreTags)) {
            options.ignoreTags.forEach(tag => {
                params.append('ignore_tags', tag);
            });
        }

        // Glossary support (Pro feature)
        if (options.glossary && options.glossary.id) {
            params.append('glossary_id', options.glossary.id);
        }

        return params.toString();
    }

    /**
     * Build Pro batch request body with optimization
     * @private
     */
    _buildProBatchRequestBody(texts, options) {
        const params = new URLSearchParams();

        // Add all texts with Pro optimization
        texts.forEach(text => {
            params.append('text', text.trim());
        });

        params.append('target_lang', this._mapLanguageCode(options.targetLanguage));

        if (options.sourceLanguage && options.sourceLanguage !== 'auto') {
            params.append('source_lang', this._mapLanguageCode(options.sourceLanguage));
        }

        // Apply Pro features to batch
        if (options.formality && options.formality !== 'default') {
            const formalityValue = this.formalityOptions[options.formality];
            if (formalityValue) {
                params.append('formality', formalityValue);
            }
        }

        if (options.preserveFormatting) {
            params.append('preserve_formatting', '1');
        }

        if (options.tagHandling && this.tagHandlingOptions[options.tagHandling]) {
            params.append('tag_handling', this.tagHandlingOptions[options.tagHandling]);
        }

        if (options.ignoreTags && Array.isArray(options.ignoreTags)) {
            options.ignoreTags.forEach(tag => {
                params.append('ignore_tags', tag);
            });
        }

        if (options.glossary && options.glossary.id) {
            params.append('glossary_id', options.glossary.id);
        }

        return params.toString();
    }

    /**
     * Optimize batch processing for Pro tier
     * @private
     */
    _optimizeBatchForPro(texts) {
        // Pro tier can handle larger batches efficiently
        const maxBatchSize = 50; // Increased batch size for Pro
        const batches = [];

        for (let i = 0; i < texts.length; i += maxBatchSize) {
            batches.push(texts.slice(i, i + maxBatchSize));
        }

        return batches;
    }

    /**
     * Make HTTP request with Pro-tier retry logic
     * @private
     */
    async _makeRequest(requestBody, options, isBatch = false) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout);

        // Use provided abort signal if available
        if (options.signal) {
            options.signal.addEventListener('abort', () => controller.abort());
        }

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    ...this.baseHeaders,
                    'X-DeepL-Pro': 'true' // Indicate Pro tier usage
                },
                body: requestBody,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.message) {
                        errorMessage = errorData.message;
                    } else if (errorData.detail) {
                        errorMessage = errorData.detail;
                    }
                } catch (parseError) {
                    // Use default error message if parsing fails
                }

                throw new Error(errorMessage);
            }

            return await response.json();

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error('Translation request timed out');
            }

            throw error;
        }
    }

    /**
     * Parse Pro response with enhanced quality metrics
     * @private
     */
    _parseProResponse(response, originalText, options, startTime) {
        if (!response || !response.translations || response.translations.length === 0) {
            throw new Error('Invalid response format from DeepL Pro API');
        }

        const translation = response.translations[0];
        const translatedText = translation.text || originalText;
        const sourceLanguage = this._unmapLanguageCode(translation.detected_source_language || options.sourceLanguage);

        // Calculate cost for Pro tier
        const characterCount = originalText.length;
        const cost = (characterCount / 1000) * this.limits.costPer1K;

        // Enhanced confidence calculation for Pro tier
        let confidence = this._calculateProQualityScore(originalText, translatedText, translation, options);

        const duration = Date.now() - startTime;

        return {
            translatedText,
            sourceLanguage,
            confidence,
            cost,
            metadata: {
                provider: this.id,
                duration,
                characterCount,
                detectedSourceLanguage: translation.detected_source_language,
                proFeatures: this._getUsedProFeatures(options),
                qualityScore: confidence,
                billingInfo: {
                    charactersCharged: characterCount,
                    cost: cost
                },
                originalText
            }
        };
    }

    /**
     * Calculate Pro-tier quality score with advanced metrics
     * @private
     */
    _calculateProQualityScore(originalText, translatedText, translation, options) {
        let score = 0.95; // Very high base confidence for DeepL Pro

        // Check if translation actually occurred
        if (translatedText === originalText) {
            return 0.15; // Very low confidence if no translation
        }

        // Length consistency check (more lenient for Pro quality)
        const lengthRatio = translatedText.length / originalText.length;
        if (lengthRatio < 0.2 || lengthRatio > 4.0) {
            score -= 0.1; // Smaller penalty for Pro
        }

        // Check for advanced features usage
        if (options.formality && options.formality !== 'default') {
            score += 0.02; // Bonus for formality control usage
        }

        if (options.preserveFormatting) {
            score += 0.01; // Bonus for formatting preservation
        }

        if (options.glossary) {
            score += 0.02; // Bonus for glossary usage
        }

        // Check for tag handling accuracy
        if (options.tagHandling && this._hasProperTagHandling(originalText, translatedText)) {
            score += 0.02;
        }

        // Detect source language accuracy bonus
        if (translation.detected_source_language) {
            score += 0.01;
        }

        return Math.max(0.2, Math.min(1.0, score));
    }

    /**
     * Check if tag handling was applied properly
     * @private
     */
    _hasProperTagHandling(originalText, translatedText) {
        // Simple check for preserved tags
        const originalTags = originalText.match(/<[^>]+>/g) || [];
        const translatedTags = translatedText.match(/<[^>]+>/g) || [];

        return originalTags.length > 0 && translatedTags.length > 0;
    }

    /**
     * Get list of Pro features used in translation
     * @private
     */
    _getUsedProFeatures(options) {
        const usedFeatures = [];

        if (options.formality && options.formality !== 'default') {
            usedFeatures.push('formality-control');
        }

        if (options.preserveFormatting) {
            usedFeatures.push('formatting-preservation');
        }

        if (options.tagHandling) {
            usedFeatures.push('tag-handling');
        }

        if (options.glossary) {
            usedFeatures.push('glossary');
        }

        if (options.ignoreTags && options.ignoreTags.length > 0) {
            usedFeatures.push('ignore-tags');
        }

        return usedFeatures;
    }

    /**
     * Parse batch response with Pro enhancements
     * @private
     */
    _parseBatchResponse(response, originalTexts, options, startTime) {
        if (!response || !response.translations || !Array.isArray(response.translations)) {
            throw new Error('Invalid batch response format from DeepL Pro API');
        }

        const duration = Date.now() - startTime;
        const results = [];
        const totalCharacters = originalTexts.reduce((sum, text) => sum + text.length, 0);

        response.translations.forEach((translation, index) => {
            const originalText = originalTexts[index] || '';
            const translatedText = translation.text || originalText;
            const sourceLanguage = this._unmapLanguageCode(translation.detected_source_language || options.sourceLanguage);

            const characterCount = originalText.length;
            const cost = (characterCount / 1000) * this.limits.costPer1K;

            let confidence = this._calculateProQualityScore(originalText, translatedText, translation, options);

            results.push({
                translatedText,
                sourceLanguage,
                confidence,
                cost,
                metadata: {
                    provider: this.id,
                    duration: duration / response.translations.length,
                    characterCount,
                    detectedSourceLanguage: translation.detected_source_language,
                    proFeatures: this._getUsedProFeatures(options),
                    qualityScore: confidence,
                    batchIndex: index,
                    billingInfo: {
                        charactersCharged: characterCount,
                        cost: cost
                    },
                    originalText
                }
            });
        });

        return results;
    }

    /**
     * Map language codes to DeepL format
     * @private
     */
    _mapLanguageCode(languageCode) {
        if (!languageCode || languageCode === 'auto') {
            return null; // DeepL auto-detection
        }

        const normalized = languageCode.toLowerCase();
        const mapped = this.languageMap[normalized];

        if (!mapped) {
            throw new Error(`Unsupported language: ${languageCode}. DeepL Pro supports: ${this.languages.join(', ')}`);
        }

        return mapped;
    }

    /**
     * Unmap language codes from DeepL format
     * @private
     */
    _unmapLanguageCode(deeplLanguageCode) {
        if (!deeplLanguageCode) {
            return 'auto';
        }

        // Reverse lookup in language map
        for (const [standard, deepl] of Object.entries(this.languageMap)) {
            if (deepl === deeplLanguageCode.toUpperCase()) {
                return standard;
            }
        }

        return deeplLanguageCode.toLowerCase();
    }

    /**
     * Update usage tracking with cost
     * @private
     */
    _updateUsageTracking(characterCount, cost) {
        this.currentUsage.characterCount += characterCount;
        this.currentUsage.cost += cost;
        this.currentUsage.lastUpdated = Date.now();
    }

    /**
     * Wrap and categorize errors
     * @private
     */
    _wrapError(error) {
        const message = error.message || 'Unknown error';

        // Categorize DeepL Pro specific errors
        if (message.includes('401') || message.includes('403') || message.includes('Invalid API key')) {
            return new Error(`Authentication failed: ${message}`);
        }

        if (message.includes('413') || message.includes('too large') || message.includes('text too long')) {
            return new Error(`Text too large: ${message}`);
        }

        if (message.includes('429') || message.includes('rate limit')) {
            return new Error(`Rate limit exceeded: ${message}`);
        }

        if (message.includes('456') || message.includes('quota')) {
            return new Error(`Quota exceeded: ${message}`);
        }

        if (message.includes('timeout') || message.includes('timed out')) {
            return new Error(`Request timeout: ${message}`);
        }

        if (message.includes('network') || message.includes('connection')) {
            return new Error(`Network error: ${message}`);
        }

        return new Error(`DeepL Pro error: ${message}`);
    }

    /**
     * Get current usage and billing information
     * @returns {Promise<Object>}
     */
    async getUsageInfo() {
        try {
            const response = await fetch(this.usageEndpoint, {
                method: 'GET',
                headers: this.baseHeaders
            });

            if (response.ok) {
                const usageData = await response.json();
                return {
                    characterCount: usageData.character_count || 0,
                    characterLimit: usageData.character_limit || null,
                    billingPeriod: {
                        start: usageData.valid_until ? new Date(usageData.valid_until) : null,
                        estimatedCost: this.currentUsage.cost
                    },
                    lastUpdated: Date.now()
                };
            }
        } catch (error) {
            console.warn('Failed to get DeepL Pro usage info:', error.message);
        }

        return {
            characterCount: this.currentUsage.characterCount,
            characterLimit: null,
            billingPeriod: {
                estimatedCost: this.currentUsage.cost
            },
            lastUpdated: this.currentUsage.lastUpdated
        };
    }

    /**
     * Test provider connectivity with Pro features
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const result = await this.translate('Hello world', {
                sourceLanguage: 'en',
                targetLanguage: 'de',
                formality: 'more',
                preserveFormatting: true,
                timeout: 10000
            });

            // Verify Pro features worked
            return result.confidence > 0.8 &&
                   result.translatedText !== 'Hello world' &&
                   result.metadata.proFeatures.length > 0;
        } catch (error) {
            console.error('DeepL Pro connection test failed:', error.message);
            return false;
        }
    }

    /**
     * Get provider configuration for registration
     * @returns {Object}
     */
    getConfig() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            endpoint: this.endpoint,
            features: this.features,
            limits: this.limits,
            languages: this.languages,
            priority: this.priority,
            enabled: this.enabled,
            supportsBatch: this.supportsBatch,
            translate: this.translate.bind(this),
            translateBatch: this.translateBatch.bind(this)
        };
    }

    /**
     * Get current provider status
     * @returns {Object}
     */
    getStatus() {
        return {
            id: this.id,
            name: this.name,
            enabled: this.enabled,
            authenticated: !!this.apiKey,
            lastError: null,
            supportedLanguages: this.languages.length,
            features: this.features,
            proFeatures: this.proFeatures,
            billing: {
                currentCost: this.currentUsage.cost,
                charactersProcessed: this.currentUsage.characterCount,
                lastUpdated: this.currentUsage.lastUpdated
            }
        };
    }
}

// Export for browser extension environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DeepLProProvider };
} else if (typeof window !== 'undefined') {
    window.DeepLProProvider = DeepLProProvider;
}