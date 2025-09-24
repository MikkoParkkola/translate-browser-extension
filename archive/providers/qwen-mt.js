/**
 * Alibaba Cloud Qwen MT Standard Provider
 *
 * High-quality AI-powered translation provider with enhanced accuracy,
 * optimized for content where translation quality is paramount.
 *
 * @author Backend Systems Lead
 * @version 1.0.0
 */

/**
 * @typedef {Object} QwenMTTranslateOptions
 * @property {string} [sourceLanguage='auto'] - Source language code
 * @property {string} targetLanguage - Target language code
 * @property {number} [timeout=30000] - Request timeout in milliseconds
 * @property {boolean} [streaming=false] - Enable streaming translation
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 * @property {'formal'|'informal'|'auto'} [tone='auto'] - Translation tone
 */

/**
 * @typedef {Object} QwenMTTranslationResult
 * @property {string} translatedText - Translated text
 * @property {string} sourceLanguage - Detected source language
 * @property {number} confidence - Translation confidence (0-1)
 * @property {number} cost - Translation cost in USD
 * @property {Object} metadata - Provider-specific metadata
 */

class QwenMTProvider {
    /**
     * Initialize Qwen MT Standard provider
     */
    constructor() {
        this.id = 'qwen-mt';
        this.name = 'Qwen MT';
        this.type = 'ai-mt';
        this.endpoint = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message';
        this.model = 'qwen-mt';
        this.enabled = true;
        this.supportsBatch = true;

        // Provider features
        this.features = ['high-quality', 'batch-support', 'tone-control', 'context-aware'];

        // Rate limits and quotas
        this.limits = {
            requestsPerMinute: 50,
            requestsPerHour: 3000,
            requestsPerDay: 72000,
            charactersPerMinute: 30000,
            charactersPerHour: 1800000,
            charactersPerDay: 43200000,
            costPer1K: 0.004
        };

        // Supported languages (ISO 639-1 codes) - Same as Turbo but with better quality
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

        this.priority = 2; // Second priority for quality

        // API configuration
        this.apiKey = null;
        this.baseHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        // Enhanced language code mappings for Qwen MT API
        this.languageMap = {
            'zh': 'zh-cn',
            'zh-cn': 'zh-cn',
            'zh-tw': 'zh-tw',
            'zh-hk': 'zh-tw',
            'zh-sg': 'zh-cn',
            'en': 'en',
            'en-us': 'en',
            'en-gb': 'en',
            'en-au': 'en',
            'en-ca': 'en',
            'ja': 'ja',
            'ko': 'ko',
            'es': 'es',
            'es-es': 'es',
            'es-mx': 'es',
            'es-ar': 'es',
            'fr': 'fr',
            'fr-fr': 'fr',
            'fr-ca': 'fr',
            'de': 'de',
            'de-de': 'de',
            'de-at': 'de',
            'de-ch': 'de',
            'it': 'it',
            'pt': 'pt',
            'pt-br': 'pt',
            'pt-pt': 'pt',
            'ru': 'ru',
            'ar': 'ar',
            'hi': 'hi',
            'th': 'th',
            'vi': 'vi',
            'id': 'id',
            'ms': 'ms',
            'tr': 'tr',
            'pl': 'pl',
            'nl': 'nl',
            'sv': 'sv',
            'da': 'da',
            'no': 'no',
            'fi': 'fi',
            'cs': 'cs',
            'sk': 'sk',
            'hu': 'hu',
            'ro': 'ro',
            'bg': 'bg',
            'hr': 'hr',
            'sl': 'sl'
        };

        // Quality enhancement settings
        this.qualitySettings = {
            contextWindow: 1000, // Characters of context to consider
            preserveFormatting: true,
            handleSpecialTerms: true,
            toneMappings: {
                'formal': 'formal',
                'informal': 'casual',
                'auto': 'auto'
            }
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
        console.log('Qwen MT Standard API key configured');
    }

    /**
     * Translate single text with enhanced quality
     * @param {string} text - Text to translate
     * @param {QwenMTTranslateOptions} options - Translation options
     * @returns {Promise<QwenMTTranslationResult>}
     */
    async translate(text, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for Qwen MT Standard');
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Invalid text input for translation');
        }

        const translateOptions = {
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            timeout: 30000,
            streaming: false,
            tone: 'auto',
            ...options
        };

        const startTime = Date.now();

        try {
            const requestBody = this._buildEnhancedRequestBody(text.trim(), translateOptions);
            const response = await this._makeRequest(requestBody, translateOptions);

            const result = this._parseEnhancedResponse(response, text, translateOptions, startTime);

            console.log(`Qwen MT Standard translation completed in ${result.metadata.duration}ms with quality score ${result.confidence}`);
            return result;

        } catch (error) {
            console.error('Qwen MT Standard translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Translate multiple texts in batch with quality optimization
     * @param {string[]} texts - Array of texts to translate
     * @param {QwenMTTranslateOptions} options - Translation options
     * @returns {Promise<QwenMTTranslationResult[]>}
     */
    async translateBatch(texts, options = {}) {
        if (!this.apiKey) {
            throw new Error('API key not configured for Qwen MT Standard');
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
            tone: 'auto',
            ...options
        };

        const startTime = Date.now();

        try {
            // Optimize batch processing with context awareness
            const optimizedBatches = this._optimizeBatchForQuality(validTexts, translateOptions);
            const results = [];

            for (const batch of optimizedBatches) {
                const batchResults = await this._processBatchWithContext(batch, translateOptions);
                results.push(...batchResults);
            }

            console.log(`Qwen MT Standard batch translation completed: ${results.length} texts in ${Date.now() - startTime}ms`);
            return results;

        } catch (error) {
            console.error('Qwen MT Standard batch translation failed:', error.message);
            throw this._wrapError(error);
        }
    }

    /**
     * Build enhanced request body with quality parameters
     * @private
     */
    _buildEnhancedRequestBody(text, options) {
        const sourceLanguage = this._mapLanguageCode(options.sourceLanguage);
        const targetLanguage = this._mapLanguageCode(options.targetLanguage);

        const requestBody = {
            model: this.model,
            input: {
                text: text,
                source_language: sourceLanguage,
                target_language: targetLanguage
            },
            parameters: {
                stream: options.streaming || false,
                format: 'text',
                quality: 'high', // Enable high quality mode
                preserve_formatting: this.qualitySettings.preserveFormatting,
                context_aware: true
            }
        };

        // Add tone control if specified
        if (options.tone && options.tone !== 'auto') {
            requestBody.parameters.tone = this.qualitySettings.toneMappings[options.tone] || 'auto';
        }

        // Add context if text is part of larger content
        if (options.context && typeof options.context === 'string') {
            requestBody.input.context = options.context.substring(0, this.qualitySettings.contextWindow);
        }

        return requestBody;
    }

    /**
     * Make HTTP request to Qwen MT API with retry logic
     * @private
     */
    async _makeRequest(requestBody, options, retryCount = 0) {
        const maxRetries = 2;
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

                // Retry on server errors
                if (response.status >= 500 && retryCount < maxRetries) {
                    const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                    console.warn(`Qwen MT request failed, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this._makeRequest(requestBody, options, retryCount + 1);
                }

                throw new Error(errorMessage);
            }

            return await response.json();

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error('Translation request timed out');
            }

            // Retry on network errors
            if (retryCount < maxRetries && (error.message.includes('network') || error.message.includes('fetch'))) {
                const delay = Math.pow(2, retryCount) * 1000;
                console.warn(`Qwen MT network error, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._makeRequest(requestBody, options, retryCount + 1);
            }

            throw error;
        }
    }

    /**
     * Parse API response with quality assessment
     * @private
     */
    _parseEnhancedResponse(response, originalText, options, startTime) {
        if (!response || !response.output) {
            throw new Error('Invalid response format from Qwen MT API');
        }

        const output = response.output;
        const translatedText = output.text || originalText;
        const sourceLanguage = this._unmapLanguageCode(output.source_language || options.sourceLanguage);

        // Calculate cost
        const characterCount = originalText.length;
        const cost = (characterCount / 1000) * this.limits.costPer1K;

        // Enhanced confidence calculation based on quality indicators
        let confidence = this._calculateQualityScore(originalText, translatedText, output);

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
                qualityScore: confidence,
                features: ['high-quality', 'context-aware'],
                originalText
            }
        };
    }

    /**
     * Calculate quality score based on multiple factors
     * @private
     */
    _calculateQualityScore(originalText, translatedText, output) {
        let score = 0.9; // Base high confidence for Qwen MT Standard

        // Check if translation actually occurred
        if (translatedText === originalText) {
            return 0.15; // Very low confidence if no translation
        }

        // Length consistency check
        const lengthRatio = translatedText.length / originalText.length;
        if (lengthRatio < 0.3 || lengthRatio > 3.0) {
            score -= 0.2; // Penalize extreme length differences
        }

        // Check for common translation issues
        if (translatedText.includes('\\n') || translatedText.includes('\\t')) {
            score -= 0.1; // Penalize escaped characters
        }

        // Check for partial translations (mixed languages)
        const originalLangPattern = /[\u4e00-\u9fff]/; // Chinese characters
        const translatedLangPattern = /[a-zA-Z]/; // Latin characters
        if (originalLangPattern.test(originalText) && originalLangPattern.test(translatedText)) {
            score -= 0.15; // Penalize incomplete translations
        }

        // Bonus for quality indicators in response
        if (output.quality_score && output.quality_score > 0.8) {
            score += 0.05;
        }

        if (output.confidence && output.confidence > 0.85) {
            score += 0.05;
        }

        return Math.max(0.1, Math.min(1.0, score));
    }

    /**
     * Optimize batch processing for quality
     * @private
     */
    _optimizeBatchForQuality(texts, options) {
        // Group texts by similarity and context for better translation quality
        const batches = [];
        const maxBatchSize = 3; // Smaller batches for quality

        for (let i = 0; i < texts.length; i += maxBatchSize) {
            batches.push(texts.slice(i, i + maxBatchSize));
        }

        return batches;
    }

    /**
     * Process batch with context awareness
     * @private
     */
    async _processBatchWithContext(batch, options) {
        const results = [];

        // Process each text with context from surrounding texts
        for (let i = 0; i < batch.length; i++) {
            const text = batch[i];

            // Build context from surrounding texts
            let context = '';
            if (i > 0) context += batch[i - 1] + ' ';
            if (i < batch.length - 1) context += ' ' + batch[i + 1];

            const textOptions = {
                ...options,
                context: context.trim()
            };

            try {
                const result = await this.translate(text, textOptions);
                results.push(result);
            } catch (error) {
                console.error(`Context-aware translation failed for text ${i}:`, error.message);
                results.push({
                    translatedText: text, // Fallback to original
                    sourceLanguage: options.sourceLanguage,
                    confidence: 0,
                    cost: 0,
                    metadata: {
                        error: error.message,
                        duration: 0,
                        provider: this.id
                    }
                });
            }
        }

        return results;
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

        return new Error(`Qwen MT Standard error: ${message}`);
    }

    /**
     * Test provider connectivity and authentication
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const result = await this.translate('Hello world', {
                sourceLanguage: 'en',
                targetLanguage: 'es',
                timeout: 10000
            });

            // Additional quality check for connection test
            return result.confidence > 0.5 && result.translatedText !== 'Hello world';
        } catch (error) {
            console.error('Qwen MT Standard connection test failed:', error.message);
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
            qualityFeatures: {
                contextAware: true,
                toneControl: true,
                formattingPreservation: this.qualitySettings.preserveFormatting
            }
        };
    }
}

// Export for browser extension environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { QwenMTProvider };
} else if (typeof window !== 'undefined') {
    window.QwenMTProvider = QwenMTProvider;
}