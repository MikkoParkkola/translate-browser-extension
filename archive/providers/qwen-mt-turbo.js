/**
 * Alibaba Cloud Qwen MT Turbo Provider
 *
 * High-speed AI-powered translation provider with streaming support,
 * optimized for real-time web page translation with cost-effective pricing.
 *
 * @author Backend Systems Lead
 * @version 1.0.0
 */

/**
 * @typedef {Object} QwenTranslateOptions
 * @property {string} [sourceLanguage='auto'] - Source language code
 * @property {string} targetLanguage - Target language code
 * @property {number} [timeout=30000] - Request timeout in milliseconds
 * @property {boolean} [streaming=false] - Enable streaming translation
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 */

/**
 * @typedef {Object} QwenTranslationResult
 * @property {string} translatedText - Translated text
 * @property {string} sourceLanguage - Detected source language
 * @property {number} confidence - Translation confidence (0-1)
 * @property {number} cost - Translation cost in USD
 * @property {Object} metadata - Provider-specific metadata
 */

class QwenMTTurboProvider {
    /**
     * Initialize Qwen MT Turbo provider
     */
    constructor() {
        this.id = 'qwen-mt-turbo';
        this.name = 'Qwen MT Turbo';
        this.type = 'ai-mt';
        this.endpoint = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message';
        this.model = 'qwen-mt-turbo';
        this.enabled = true;
        this.supportsBatch = true;

        // Provider features
        this.features = ['fast', 'cost-effective', 'streaming', 'batch-support'];

        // Rate limits and quotas
        this.limits = {
            requestsPerMinute: 100,
            requestsPerHour: 6000,
            requestsPerDay: 144000,
            charactersPerMinute: 50000,
            charactersPerHour: 3000000,
            charactersPerDay: 72000000,
            costPer1K: 0.002
        };

        // Supported languages (ISO 639-1 codes)
        this.languages = [
            'en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru',
            'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tr', 'pl', 'nl', 'sv',
            'da', 'no', 'fi', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sl',
            'et', 'lv', 'lt', 'mt', 'ga', 'cy', 'eu', 'ca', 'gl', 'is',
            'mk', 'sq', 'az', 'be', 'ka', 'hy', 'he', 'ur', 'fa', 'bn',
            'ta', 'te', 'ml', 'kn', 'gu', 'pa', 'ne', 'si', 'my', 'km',
            'lo', 'mn', 'kk', 'ky', 'uz', 'tg', 'am', 'sw', 'yo', 'ig',
            'ha', 'zu', 'af', 'xh', 'st', 'tn', 'ss', 've', 'ts', 'nr'
        ];

        this.priority = 1; // Highest priority for speed

        // API configuration
        this.apiKey = null;
        this.baseHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        // Language code mappings for Qwen MT API
        this.languageMap = {
            'zh': 'zh-cn',
            'zh-cn': 'zh-cn',
            'zh-tw': 'zh-tw',
            'zh-hk': 'zh-tw',
            'en': 'en',
            'ja': 'ja',
            'ko': 'ko',
            'es': 'es',
            'fr': 'fr',
            'de': 'de',
            'it': 'it',
            'pt': 'pt',
            'ru': 'ru',
            'ar': 'ar',
            'hi': 'hi',
            'th': 'th',
            'vi': 'vi',
            'id': 'id',
            'ms': 'ms',
            'tr': 'tr'
        };
    }

    /**
     * Set API key for authentication
     * @param {string} apiKey - Alibaba Cloud API key
     */
    setApiKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('Invalid API key provided');
        }

        this.apiKey = apiKey;
        this.baseHeaders['Authorization'] = `Bearer ${apiKey}`;
        console.log('Qwen MT Turbo API key configured');
    }

    /**
     * Translate single text
     * @param {string} text - Text to translate
     * @param {QwenTranslateOptions} options - Translation options
     * @returns {Promise<QwenTranslationResult>}
     */
    async translate(text, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for Qwen MT Turbo');
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Invalid text input for translation');
        }

        const translateOptions = {
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            timeout: 30000,
            streaming: false,
            ...options
        };

        const startTime = Date.now();

        try {
            const requestBody = this._buildRequestBody(text.trim(), translateOptions);
            const response = await this._makeRequest(requestBody, translateOptions);

            const result = this._parseResponse(response, text, translateOptions, startTime);

            console.log(`Qwen MT Turbo translation completed in ${result.metadata.duration}ms`);
            return result;

        } catch (error) {
            console.error('Qwen MT Turbo translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Translate multiple texts in batch
     * @param {string[]} texts - Array of texts to translate
     * @param {QwenTranslateOptions} options - Translation options
     * @returns {Promise<QwenTranslationResult[]>}
     */
    async translateBatch(texts, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for Qwen MT Turbo');
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
            timeout: 60000, // Longer timeout for batch
            streaming: false,
            ...options
        };

        const startTime = Date.now();

        try {
            // For batch processing, send multiple requests concurrently
            // Qwen MT API doesn't have native batch support, so we simulate it
            const maxConcurrency = 5;
            const results = [];

            for (let i = 0; i < validTexts.length; i += maxConcurrency) {
                const batch = validTexts.slice(i, i + maxConcurrency);
                const batchPromises = batch.map(text => this.translate(text, translateOptions));

                const batchResults = await Promise.allSettled(batchPromises);

                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        results.push(result.value);
                    } else {
                        console.error(`Batch translation failed for text ${i + index}:`, result.reason);
                        // Create error result
                        results.push({
                            translatedText: batch[index], // Fallback to original
                            sourceLanguage: translateOptions.sourceLanguage,
                            confidence: 0,
                            cost: 0,
                            metadata: {
                                error: result.reason.message,
                                duration: 0,
                                provider: this.id
                            }
                        });
                    }
                });
            }

            console.log(`Qwen MT Turbo batch translation completed: ${results.length} texts in ${Date.now() - startTime}ms`);
            return results;

        } catch (error) {
            console.error('Qwen MT Turbo batch translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Build request body for Qwen MT API
     * @private
     */
    _buildRequestBody(text, options) {
        const sourceLanguage = this._mapLanguageCode(options.sourceLanguage);
        const targetLanguage = this._mapLanguageCode(options.targetLanguage);

        return {
            model: this.model,
            input: {
                text: text,
                source_language: sourceLanguage,
                target_language: targetLanguage
            },
            parameters: {
                stream: options.streaming || false,
                format: 'text'
            }
        };
    }

    /**
     * Make HTTP request to Qwen MT API
     * @private
     */
    async _makeRequest(requestBody, options) {
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
                body: JSON.stringify(requestBody),
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
                    } else if (errorData.error && errorData.error.message) {
                        errorMessage = errorData.error.message;
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
     * Parse API response
     * @private
     */
    _parseResponse(response, originalText, options, startTime) {
        if (!response || !response.output) {
            throw new Error('Invalid response format from Qwen MT API');
        }

        const output = response.output;
        const translatedText = output.text || originalText;
        const sourceLanguage = this._unmapLanguageCode(output.source_language || options.sourceLanguage);

        // Calculate cost
        const characterCount = originalText.length;
        const cost = (characterCount / 1000) * this.limits.costPer1K;

        // Calculate confidence (Qwen MT doesn't provide confidence scores, so we estimate)
        let confidence = 0.85; // Default high confidence
        if (translatedText === originalText) {
            confidence = 0.1; // Low confidence if no translation occurred
        } else if (translatedText.length < originalText.length * 0.5) {
            confidence = 0.6; // Medium confidence for very short translations
        }

        const duration = Date.now() - startTime;

        return {
            translatedText,
            sourceLanguage,
            confidence,
            cost,
            metadata: {
                provider: this.id,
                model: this.model,
                duration,
                characterCount,
                requestId: response.request_id || null,
                usage: response.usage || null,
                originalText
            }
        };
    }

    /**
     * Map language codes to Qwen MT format
     * @private
     */
    _mapLanguageCode(languageCode) {
        if (!languageCode || languageCode === 'auto') {
            return 'auto';
        }

        const normalized = languageCode.toLowerCase();
        return this.languageMap[normalized] || normalized;
    }

    /**
     * Unmap language codes from Qwen MT format
     * @private
     */
    _unmapLanguageCode(qwenLanguageCode) {
        if (!qwenLanguageCode || qwenLanguageCode === 'auto') {
            return 'auto';
        }

        // Reverse lookup in language map
        for (const [standard, qwen] of Object.entries(this.languageMap)) {
            if (qwen === qwenLanguageCode) {
                return standard;
            }
        }

        return qwenLanguageCode;
    }

    /**
     * Wrap and categorize errors
     * @private
     */
    _wrapError(error) {
        const message = error.message || 'Unknown error';

        // Categorize errors for better handling
        if (message.includes('401') || message.includes('authentication') || message.includes('API key')) {
            return new Error(`Authentication failed: ${message}`);
        }

        if (message.includes('403') || message.includes('forbidden')) {
            return new Error(`Access denied: ${message}`);
        }

        if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) {
            return new Error(`Rate limit exceeded: ${message}`);
        }

        if (message.includes('timeout') || message.includes('timed out')) {
            return new Error(`Request timeout: ${message}`);
        }

        if (message.includes('network') || message.includes('connection')) {
            return new Error(`Network error: ${message}`);
        }

        return new Error(`Qwen MT Turbo error: ${message}`);
    }

    /**
     * Test provider connectivity and authentication
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            await this.translate('Hello', {
                sourceLanguage: 'en',
                targetLanguage: 'es',
                timeout: 10000
            });
            return true;
        } catch (error) {
            console.error('Qwen MT Turbo connection test failed:', error.message);
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
            features: this.features
        };
    }
}

// Export for browser extension environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { QwenMTTurboProvider };
} else if (typeof window !== 'undefined') {
    window.QwenMTTurboProvider = QwenMTTurboProvider;
}