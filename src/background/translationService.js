/**
 * Translation Service Module
 * Handles core translation logic and provider communication
 */

import { logger } from '../lib/logger.js';
import { OptimizedThrottle } from '../lib/optimizedThrottle.js';
import { startTimer, endTimer, trackTranslation, trackError } from '../lib/performanceTracker.js';
import { createErrorHandler, throwStandardError, ERROR_CODES } from '../lib/standardErrorHandler.js';

class TranslationService {
  constructor() {
    this.providers = new Map();
    this.cache = new Map();
    this.throttle = new OptimizedThrottle({
      requestLimit: 60,
      tokenLimit: 100000,
      windowMs: 60000
    });
    this.errorHandler = createErrorHandler('TranslationService');

    this.initializeProviders();
  }

  initializeProviders() {
    // Qwen MT Turbo (fast, good quality)
    this.providers.set('qwen-mt-turbo', {
      endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen-mt-turbo',
      maxTokens: 8192,
      temperature: 0.1,
      cost: { inputPer1k: 0.0015, outputPer1k: 0.002 }
    });

    // Qwen MT (slower, higher quality)
    this.providers.set('qwen-mt', {
      endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen-mt',
      maxTokens: 8192,
      temperature: 0.1,
      cost: { inputPer1k: 0.003, outputPer1k: 0.006 }
    });

    logger.info('TranslationService', `Initialized ${this.providers.size} translation providers`);
  }

  // Main translation method
  async translate(text, sourceLanguage, targetLanguage, options = {}) {
    const timerId = startTimer('translation', {
      sourceLanguage,
      targetLanguage,
      textLength: text.length
    });

    try {
      // Validate input
      if (!text || typeof text !== 'string') {
        throwStandardError('TRANSLATION_INVALID_INPUT', 'Invalid text input', null, { text: typeof text });
      }

      if (text.length > 50000) {
        throwStandardError('TRANSLATION_INVALID_INPUT', 'Text too long (max 50,000 characters)', null, { length: text.length });
      }

      // Check cache first
      const cacheKey = this.getCacheKey(text, sourceLanguage, targetLanguage);
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour cache
        const duration = endTimer(timerId, { fromCache: true });
        trackTranslation(text, cached.translation, duration || 0, true);
        return cached.translation;
      }

      // Determine provider
      const provider = options.provider || this.selectOptimalProvider(text, options);
      const config = this.providers.get(provider);

      if (!config) {
        throwStandardError('TRANSLATION_FAILED', `Unknown provider: ${provider}`, null, { provider });
      }

      // Check token usage and throttle
      const tokenCount = this.estimateTokens(text);

      if (!this.throttle.canMakeRequest(tokenCount)) {
        await this.throttle.waitForCapacity(tokenCount, 10000);
      }

      // Perform translation
      const translation = await this.performTranslation(text, sourceLanguage, targetLanguage, config);

      // Cache result
      this.cache.set(cacheKey, {
        translation,
        timestamp: Date.now()
      });

      // Clean cache if too large
      if (this.cache.size > 1000) {
        this.cleanCache();
      }

      // Record usage
      this.throttle.recordUsage(tokenCount);

      const duration = endTimer(timerId, {
        provider,
        tokens: tokenCount,
        success: true
      });

      trackTranslation(text, translation, duration || 0, false);

      return translation;

    } catch (error) {
      const duration = endTimer(timerId, {
        success: false,
        error: error.message
      });

      trackError('TranslationService', error, {
        sourceLanguage,
        targetLanguage,
        textLength: text?.length
      });

      throw await this.errorHandler.handleError(error, {
        operation: 'translate',
        sourceLanguage,
        targetLanguage,
        textLength: text?.length
      });
    }
  }

  // Perform actual API call to translation provider
  async performTranslation(text, sourceLanguage, targetLanguage, config) {
    const requestBody = {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: this.buildSystemPrompt(sourceLanguage, targetLanguage)
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: config.temperature,
      max_tokens: Math.min(config.maxTokens, this.estimateTokens(text) * 2)
    };

    // Get API key from storage
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throwStandardError('CONFIG_MISSING', 'API key not configured', null, { operation: 'performTranslation' });
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 401 || response.status === 403) {
        throwStandardError('NETWORK_AUTH_FAILED', `API authentication failed: ${response.status}`, null, { status: response.status, errorText });
      } else if (response.status === 429) {
        throwStandardError('NETWORK_RATE_LIMITED', `API rate limited: ${response.status}`, null, { status: response.status, errorText });
      } else if (response.status >= 500) {
        throwStandardError('NETWORK_CONNECTION', `API server error: ${response.status}`, null, { status: response.status, errorText });
      } else {
        throwStandardError('TRANSLATION_FAILED', `API request failed: ${response.status}`, null, { status: response.status, errorText });
      }
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throwStandardError('TRANSLATION_FAILED', 'Invalid API response format', null, { responseStructure: Object.keys(data || {}) });
    }

    return data.choices[0].message.content.trim();
  }

  // Build system prompt for translation
  buildSystemPrompt(sourceLanguage, targetLanguage) {
    const langName = (lang) => {
      const names = {
        'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
        'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese',
        'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'hi': 'Hindi'
      };
      return names[lang] || lang;
    };

    const source = sourceLanguage === 'auto' ? 'the detected language' : langName(sourceLanguage);
    const target = langName(targetLanguage);

    return `You are a professional translator. Translate the following text from ${source} to ${target}.

Rules:
1. Preserve the original meaning and tone
2. Maintain formatting (line breaks, spacing, punctuation)
3. Keep technical terms when appropriate
4. Return ONLY the translated text, no explanations
5. If text is already in target language, return it unchanged`;
  }

  // Select optimal provider based on text and options
  selectOptimalProvider(text, options) {
    if (options.strategy === 'fast') {
      return 'qwen-mt-turbo';
    }

    if (options.strategy === 'quality') {
      return 'qwen-mt';
    }

    // Smart selection (default)
    const textLength = text.length;

    // For short text, use turbo
    if (textLength < 1000) {
      return 'qwen-mt-turbo';
    }

    // For long text, use standard model for better quality
    if (textLength > 5000) {
      return 'qwen-mt';
    }

    // Medium text, prefer turbo for speed
    return 'qwen-mt-turbo';
  }

  // Estimate token count (rough approximation)
  estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 characters for most languages
    return Math.ceil(text.length / 4);
  }

  // Generate cache key
  getCacheKey(text, sourceLanguage, targetLanguage) {
    const hash = this.simpleHash(text);
    return `${sourceLanguage}:${targetLanguage}:${hash}`;
  }

  // Simple hash function for caching
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  // Clean old cache entries
  cleanCache() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > maxAge) {
        this.cache.delete(key);
      }
    }

    logger.debug('TranslationService', `Cache cleaned. Size: ${this.cache.size}`);
  }

  // Get API key from Chrome storage
  async getApiKey() {
    try {
      const result = await chrome.storage.sync.get(['apiKey']);
      return result.apiKey;
    } catch (error) {
      const handledException = await this.errorHandler.handleError(error, { operation: 'getApiKey' });
      // For storage failures, return null to trigger CONFIG_MISSING error
      if (handledException.category === 'storage') {
        return null;
      }
      throw handledException;
    }
  }

  // Get usage statistics
  getUsageStats() {
    return {
      throttle: this.throttle.getUsage(),
      cache: {
        size: this.cache.size,
        hitRate: this.cacheHitRate || 0
      },
      providers: Array.from(this.providers.keys())
    };
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    logger.info('TranslationService', 'Cache cleared');
  }

  // Test provider connectivity
  async testProvider(providerName) {
    try {
      const provider = this.providers.get(providerName);
      if (!provider) {
        throwStandardError('TRANSLATION_FAILED', `Provider ${providerName} not found`, null, { providerName, availableProviders: Array.from(this.providers.keys()) });
      }

      const result = await this.translate('Hello', 'en', 'es', {
        provider: providerName
      });

      return {
        success: true,
        provider: providerName,
        result
      };
    } catch (error) {
      const handledException = await this.errorHandler.handleError(error, { operation: 'testProvider', providerName });
      return {
        success: false,
        provider: providerName,
        error: handledException.message,
        errorCode: handledException.errorCode
      };
    }
  }
}

export { TranslationService };