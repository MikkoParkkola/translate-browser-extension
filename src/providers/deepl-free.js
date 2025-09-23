/**
 * DeepL Free API Provider
 *
 * Free tier provider for DeepL's high-quality neural machine translation,
 * with monthly quota limits and essential translation features.
 *
 * @author Backend Systems Lead
 * @version 1.0.0
 */

/**
 * @typedef {Object} DeepLFreeTranslateOptions
 * @property {string} [sourceLanguage='auto'] - Source language code
 * @property {string} targetLanguage - Target language code
 * @property {number} [timeout=30000] - Request timeout in milliseconds
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 * @property {'default'|'more'|'less'} [formality='default'] - Formality level
 * @property {boolean} [preserveFormatting=false] - Preserve source formatting
 */

/**
 * @typedef {Object} DeepLFreeTranslationResult
 * @property {string} translatedText - Translated text
 * @property {string} sourceLanguage - Detected source language
 * @property {number} confidence - Translation confidence (0-1)
 * @property {number} cost - Translation cost (always 0 for free tier)
 * @property {Object} metadata - Provider-specific metadata
 */

class DeepLFreeProvider {
    /**
     * Initialize DeepL Free provider
     */
    constructor() {
        this.id = 'deepl-free';
        this.name = 'DeepL Free';
        this.type = 'traditional-mt';
        this.endpoint = 'https://api-free.deepl.com/v2/translate';
        this.usageEndpoint = 'https://api-free.deepl.com/v2/usage';
        this.enabled = true;
        this.supportsBatch = true;

        // Provider features
        this.features = ['high-quality', 'limited-usage', 'formality-control'];

        // Rate limits and quotas (DeepL Free tier)
        this.limits = {
            requestsPerMinute: 5,
            requestsPerHour: 100,
            requestsPerDay: 500,
            charactersPerMinute: 1000,
            charactersPerHour: 20000,
            charactersPerDay: 16667, // 500k/month ÷ 30 days
            monthlyQuota: 500000,
            costPer1K: 0 // Free tier
        };

        // Supported languages (DeepL Free subset)
        this.languages = [
            'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr',
            'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'nl', 'pl',
            'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh'
        ];

        this.priority = 3; // Third priority as fallback

        // API configuration
        this.apiKey = null;
        this.baseHeaders = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'TranslateExtension/1.0'
        };

        // DeepL language code mappings
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
            'uk': 'UK'
        };

        // Formality options
        this.formalityOptions = {
            'default': undefined,
            'more': 'more',
            'less': 'less'
        };

        // Usage tracking
        this.currentUsage = {
            characterCount: 0,
            characterLimit: 500000,
            lastUpdated: Date.now()
        };
    }

    /**
     * Set API key for authentication
     * @param {string} apiKey - DeepL Free API key
     */
    setApiKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('Invalid API key provided');
        }

        this.apiKey = apiKey;
        this.baseHeaders['Authorization'] = `DeepL-Auth-Key ${apiKey}`;
        console.log('DeepL Free API key configured');
    }

    /**
     * Translate single text
     * @param {string} text - Text to translate
     * @param {DeepLFreeTranslateOptions} options - Translation options
     * @returns {Promise<DeepLFreeTranslationResult>}
     */
    async translate(text, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for DeepL Free');
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Invalid text input for translation');
        }

        const translateOptions = {
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            timeout: 30000,
            formality: 'default',
            preserveFormatting: false,
            ...options
        };

        const startTime = Date.now();

        try {
            // Check quota before translation
            await this._checkQuotaAvailability(text.length);

            const requestBody = this._buildRequestBody(text.trim(), translateOptions);
            const response = await this._makeRequest(requestBody, translateOptions);

            const result = this._parseResponse(response, text, translateOptions, startTime);

            // Update usage tracking
            this._updateUsageTracking(text.length);

            console.log(`DeepL Free translation completed in ${result.metadata.duration}ms`);
            return result;

        } catch (error) {
            console.error('DeepL Free translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Translate multiple texts in batch
     * @param {string[]} texts - Array of texts to translate
     * @param {DeepLFreeTranslateOptions} options - Translation options
     * @returns {Promise<DeepLFreeTranslationResult[]>}
     */
    async translateBatch(texts, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for DeepL Free');
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
            preserveFormatting: false,
            ...options
        };

        const startTime = Date.now();

        try {
            // Check total quota requirement
            const totalCharacters = validTexts.reduce((sum, text) => sum + text.length, 0);
            await this._checkQuotaAvailability(totalCharacters);

            // DeepL supports batch translation natively
            const requestBody = this._buildBatchRequestBody(validTexts, translateOptions);
            const response = await this._makeRequest(requestBody, translateOptions, true);

            const results = this._parseBatchResponse(response, validTexts, translateOptions, startTime);

            // Update usage tracking
            this._updateUsageTracking(totalCharacters);

            console.log(`DeepL Free batch translation completed: ${results.length} texts in ${Date.now() - startTime}ms`);
            return results;

        } catch (error) {
            console.error('DeepL Free batch translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Check available quota before translation
     * @private
     */
    async _checkQuotaAvailability(characterCount) {
        try {
            // Update current usage from API
            await this._updateUsageFromAPI();

            const remainingQuota = this.currentUsage.characterLimit - this.currentUsage.characterCount;

            if (characterCount > remainingQuota) {
                throw new Error(`Insufficient quota: ${characterCount} characters requested, ${remainingQuota} available`);
            }

            console.log(`DeepL Free quota check: ${characterCount} chars requested, ${remainingQuota} remaining`);

        } catch (error) {
            if (error.message.includes('quota')) {
                throw error;
            }
            // If quota check fails, log warning but continue (may be temporary API issue)
            console.warn('DeepL quota check failed, proceeding with translation:', error.message);
        }
    }

    /**
     * Update usage from DeepL API
     * @private
     */
    async _updateUsageFromAPI() {
        try {
            const response = await fetch(this.usageEndpoint, {
                method: 'GET',
                headers: this.baseHeaders
            });

            if (response.ok) {
                const usageData = await response.json();
                this.currentUsage = {
                    characterCount: usageData.character_count || 0,
                    characterLimit: usageData.character_limit || 500000,
                    lastUpdated: Date.now()
                };
            }
        } catch (error) {
            console.warn('Failed to update DeepL usage from API:', error.message);
        }
    }

    /**
     * Build request body for single translation
     * @private
     */
    _buildRequestBody(text, options) {
        const params = new URLSearchParams();

        params.append('text', text);
        params.append('target_lang', this._mapLanguageCode(options.targetLanguage));

        if (options.sourceLanguage && options.sourceLanguage !== 'auto') {
            params.append('source_lang', this._mapLanguageCode(options.sourceLanguage));
        }

        if (options.formality && options.formality !== 'default') {
            const formalityValue = this.formalityOptions[options.formality];
            if (formalityValue) {
                params.append('formality', formalityValue);
            }
        }

        if (options.preserveFormatting) {
            params.append('preserve_formatting', '1');
        }

        return params.toString();
    }

    /**
     * Build request body for batch translation
     * @private
     */
    _buildBatchRequestBody(texts, options) {
        const params = new URLSearchParams();

        // Add all texts
        texts.forEach(text => {
            params.append('text', text.trim());
        });

        params.append('target_lang', this._mapLanguageCode(options.targetLanguage));

        if (options.sourceLanguage && options.sourceLanguage !== 'auto') {
            params.append('source_lang', this._mapLanguageCode(options.sourceLanguage));
        }

        if (options.formality && options.formality !== 'default') {
            const formalityValue = this.formalityOptions[options.formality];
            if (formalityValue) {
                params.append('formality', formalityValue);
            }
        }

        if (options.preserveFormatting) {
            params.append('preserve_formatting', '1');
        }

        return params.toString();
    }

    /**
     * Make HTTP request to DeepL API
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
                headers: this.baseHeaders,
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
     * Parse single translation response
     * @private
     */
    _parseResponse(response, originalText, options, startTime) {
        if (!response || !response.translations || response.translations.length === 0) {
            throw new Error('Invalid response format from DeepL API');
        }

        const translation = response.translations[0];
        const translatedText = translation.text || originalText;
        const sourceLanguage = this._unmapLanguageCode(translation.detected_source_language || options.sourceLanguage);

        // DeepL provides high-quality translations, assign confidence accordingly
        let confidence = 0.92; // High base confidence for DeepL

        if (translatedText === originalText) {
            confidence = 0.1; // Low confidence if no translation occurred
        }

        const duration = Date.now() - startTime;

        return {
            translatedText,
            sourceLanguage,
            confidence,
            cost: 0, // Free tier
            metadata: {
                provider: this.id,
                duration,
                characterCount: originalText.length,
                detectedSourceLanguage: translation.detected_source_language,
                freeUsage: true,
                qualityScore: confidence,
                originalText
            }
        };
    }

    /**
     * Parse batch translation response
     * @private
     */
    _parseBatchResponse(response, originalTexts, options, startTime) {
        if (!response || !response.translations || !Array.isArray(response.translations)) {
            throw new Error('Invalid batch response format from DeepL API');
        }

        const duration = Date.now() - startTime;
        const results = [];

        response.translations.forEach((translation, index) => {
            const originalText = originalTexts[index] || '';
            const translatedText = translation.text || originalText;
            const sourceLanguage = this._unmapLanguageCode(translation.detected_source_language || options.sourceLanguage);

            let confidence = 0.92;
            if (translatedText === originalText) {
                confidence = 0.1;
            }

            results.push({
                translatedText,
                sourceLanguage,
                confidence,
                cost: 0,
                metadata: {
                    provider: this.id,
                    duration: duration / response.translations.length, // Distributed duration
                    characterCount: originalText.length,
                    detectedSourceLanguage: translation.detected_source_language,
                    freeUsage: true,
                    qualityScore: confidence,
                    batchIndex: index,
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
            throw new Error(`Unsupported language: ${languageCode}. DeepL Free supports: ${this.languages.join(', ')}`);
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
     * Update local usage tracking
     * @private
     */
    _updateUsageTracking(characterCount) {
        this.currentUsage.characterCount += characterCount;
        this.currentUsage.lastUpdated = Date.now();
    }

    /**
     * Wrap and categorize errors
     * @private
     */
    _wrapError(error) {
        const message = error.message || 'Unknown error';

        // Categorize DeepL-specific errors
        if (message.includes('401') || message.includes('403') || message.includes('Invalid API key')) {
            return new Error(`Authentication failed: ${message}`);
        }

        if (message.includes('413') || message.includes('too large') || message.includes('text too long')) {
            return new Error(`Text too large: ${message}`);
        }

        if (message.includes('429') || message.includes('rate limit') || message.includes('quota exceeded')) {
            return new Error(`Rate limit exceeded: ${message}`);
        }

        if (message.includes('456') || message.includes('quota')) {
            return new Error(`Monthly quota exceeded: ${message}`);
        }

        if (message.includes('timeout') || message.includes('timed out')) {
            return new Error(`Request timeout: ${message}`);
        }

        if (message.includes('network') || message.includes('connection')) {
            return new Error(`Network error: ${message}`);
        }

        return new Error(`DeepL Free error: ${message}`);
    }

    /**
     * Get current usage statistics
     * @returns {Promise<Object>}
     */
    async getUsage() {
        await this._updateUsageFromAPI();

        return {
            characterCount: this.currentUsage.characterCount,
            characterLimit: this.currentUsage.characterLimit,
            charactersRemaining: this.currentUsage.characterLimit - this.currentUsage.characterCount,
            utilizationPercentage: (this.currentUsage.characterCount / this.currentUsage.characterLimit) * 100,
            lastUpdated: this.currentUsage.lastUpdated
        };
    }

    /**
     * Test provider connectivity and authentication
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            await this.translate('Hello', {
                sourceLanguage: 'en',
                targetLanguage: 'de',
                timeout: 10000
            });
            return true;
        } catch (error) {
            console.error('DeepL Free connection test failed:', error.message);
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
            usage: {
                current: this.currentUsage.characterCount,
                limit: this.currentUsage.characterLimit,
                remaining: this.currentUsage.characterLimit - this.currentUsage.characterCount
            }
        };
    }
}

// Export for browser extension environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DeepLFreeProvider };
} else if (typeof window !== 'undefined') {
    window.DeepLFreeProvider = DeepLFreeProvider;
}