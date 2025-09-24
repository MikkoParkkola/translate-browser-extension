/**
 * @fileoverview Base provider class for unified translation provider implementation
 * Provides standardized interface, error handling, and common functionality
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenBaseProvider = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const errorHandler = (typeof self !== 'undefined' && self.qwenProviderErrorHandler) ||
                     (typeof require !== 'undefined' ? require('./provider-error-handler') : null);

  /**
   * Provider capability flags
   */
  const PROVIDER_CAPABILITIES = {
    STREAMING: 'streaming',
    BATCH_TRANSLATION: 'batch_translation',
    LANGUAGE_DETECTION: 'language_detection',
    CUSTOM_PROMPTS: 'custom_prompts',
    MULTIPLE_MODELS: 'multiple_models',
    USAGE_TRACKING: 'usage_tracking'
  };

  /**
   * Configuration schema for provider validation
   */
  const CONFIG_SCHEMA = {
    required: ['apiKey', 'endpoint'],
    optional: ['model', 'timeout', 'retryAttempts', 'customPrompt'],
    validation: {
      apiKey: (val) => typeof val === 'string' && val.trim().length > 0,
      endpoint: (val) => typeof val === 'string' && /^https?:\/\//.test(val),
      model: (val) => !val || typeof val === 'string',
      timeout: (val) => !val || (Number.isInteger(val) && val > 0),
      retryAttempts: (val) => !val || (Number.isInteger(val) && val >= 0)
    }
  };

  /**
   * Abstract base class for translation providers
   */
  class BaseProvider {
    constructor(config = {}) {
      this.name = config.name || 'unknown';
      this.label = config.label || this.name;
      this.capabilities = new Set(config.capabilities || []);
      this.logger = config.logger || console;
      this.fetchFn = config.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
      
      // Default configuration
      this.config = {
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        maxRetryDelay: 30000,
        ...config
      };

      // Validate configuration if schema is provided
      if (config.schema) {
        this.validateConfig(config.schema);
      }

      // Bind methods to preserve context
      this.translate = this.translate.bind(this);
      this.validateParams = this.validateParams.bind(this);
      this.handleError = this.handleError.bind(this);
    }

    /**
     * Validate provider configuration against schema
     */
    validateConfig(schema = CONFIG_SCHEMA) {
      // Check required fields
      for (const field of schema.required || []) {
        if (!(field in this.config)) {
          throw new Error(`Missing required configuration field: ${field}`);
        }
      }

      // Validate field values
      for (const [field, validator] of Object.entries(schema.validation || {})) {
        if (field in this.config && !validator(this.config[field])) {
          throw new Error(`Invalid configuration for field: ${field}`);
        }
      }
    }

    /**
     * Check if provider supports a capability
     */
    hasCapability(capability) {
      return this.capabilities.has(capability);
    }

    /**
     * Add a capability to the provider
     */
    addCapability(capability) {
      this.capabilities.add(capability);
      return this;
    }

    /**
     * Validate translation parameters
     */
    validateParams(params) {
      const required = ['text'];
      const optional = ['source', 'target', 'model', 'stream', 'signal', 'onData', 'debug'];
      
      for (const param of required) {
        if (!(param in params) || !params[param]) {
          throw new Error(`Missing required parameter: ${param}`);
        }
      }

      // Validate parameter types
      if (typeof params.text !== 'string') {
        throw new Error('Parameter "text" must be a string');
      }

      if (params.stream !== undefined && typeof params.stream !== 'boolean') {
        throw new Error('Parameter "stream" must be a boolean');
      }

      if (params.onData !== undefined && typeof params.onData !== 'function') {
        throw new Error('Parameter "onData" must be a function');
      }

      if (params.signal !== undefined && !(params.signal instanceof AbortSignal)) {
        throw new Error('Parameter "signal" must be an AbortSignal');
      }

      return true;
    }

    /**
     * Create standardized request headers
     */
    createHeaders(customHeaders = {}) {
      return {
        'Content-Type': 'application/json',
        'User-Agent': `TRANSLATE! by Mikko/${this.name}`,
        ...customHeaders
      };
    }

    /**
     * Add authentication to headers
     */
    addAuth(headers, apiKey) {
      // To be overridden by specific providers
      return headers;
    }

    /**
     * Create request body for translation
     */
    createRequestBody(params) {
      // To be implemented by specific providers
      throw new Error('createRequestBody must be implemented by provider');
    }

    /**
     * Parse streaming response
     */
    async parseStreamingResponse(response, onData, signal) {
      // To be implemented by providers that support streaming
      throw new Error('parseStreamingResponse must be implemented by streaming providers');
    }

    /**
     * Parse non-streaming response
     */
    async parseResponse(response) {
      // To be implemented by specific providers
      throw new Error('parseResponse must be implemented by provider');
    }

    /**
     * Handle provider-specific errors
     */
    handleError(error, context = {}) {
      const providerContext = {
        provider: this.name,
        logger: this.logger,
        ...context
      };

      // Preserve AbortError as-is for proper signal handling
      if (error.name === 'AbortError') {
        throw error;
      }

      if (errorHandler) {
        if (error.name === 'TypeError') {
          errorHandler.handleNetworkError(error, providerContext);
        } else if (error.status) {
          // This is likely already handled by handleHttpError in the translate method
          throw error;
        } else {
          // Generic error - wrap it
          const wrappedOperation = errorHandler.wrapProviderOperation(
            async () => { throw error; },
            providerContext
          );
          return wrappedOperation();
        }
      } else {
        // Fallback error handling
        throw error;
      }
    }

    /**
     * Implement retry logic with exponential backoff
     */
    async withRetry(operation, maxAttempts = this.config.retryAttempts) {
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          
          // Don't retry on certain error types
          if (error.retryable === false || 
              error.type === 'authentication' || 
              error.type === 'invalid_request' ||
              attempt === maxAttempts) {
            throw error;
          }

          // Calculate delay with exponential backoff and jitter
          const baseDelay = error.retryAfter || (this.config.retryDelay * Math.pow(2, attempt - 1));
          const jitter = Math.random() * 0.1 * baseDelay; // Up to 10% jitter
          const delay = Math.min(baseDelay + jitter, this.config.maxRetryDelay);

          this.logger.warn(`Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms:`, error.message);
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      throw lastError;
    }

    /**
     * Main translation method - to be implemented by providers
     */
    async translate(params) {
      this.validateParams(params);
      
      const operation = async () => {
        if (!this.fetchFn) {
          throw new Error('Fetch function not available');
        }

        const { text, source = 'auto', target = 'en', model, stream = true, signal, onData, debug } = params;

        // Log request if debug mode
        if (debug) {
          this.logger.debug(`[${this.name}] Translation request:`, { 
            textLength: text.length, 
            source, 
            target, 
            model: model || 'default',
            stream
          });
        }

        // Create request
        const headers = this.addAuth(
          this.createHeaders(), 
          params.apiKey || this.config.apiKey
        );
        
        const body = this.createRequestBody({
          text, source, target, model, stream
        });

        const requestOptions = {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal
        };

        // Make request
        let response;
        try {
          response = await this.fetchFn(this.getEndpoint(params), requestOptions);
        } catch (error) {
          return this.handleError(error, { endpoint: this.getEndpoint(params) });
        }

        // Handle HTTP errors
        if (!response.ok) {
          if (errorHandler) {
            await errorHandler.handleHttpError(response, {
              provider: this.name,
              logger: this.logger,
              endpoint: this.getEndpoint(params)
            });
          } else {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.status = response.status;
            throw error;
          }
        }

        // Parse response
        if (stream && onData && this.hasCapability(PROVIDER_CAPABILITIES.STREAMING)) {
          return await this.parseStreamingResponse(response, onData, signal);
        } else {
          return await this.parseResponse(response);
        }
      };

      // Apply retry logic
      return await this.withRetry(operation);
    }

    /**
     * Get endpoint URL for requests
     */
    getEndpoint(params) {
      return params.endpoint || this.config.endpoint;
    }

    /**
     * Get provider metadata
     */
    getMetadata() {
      return {
        name: this.name,
        label: this.label,
        capabilities: Array.from(this.capabilities),
        version: this.version || '1.0.0',
        description: this.description || `${this.label} translation provider`
      };
    }

    /**
     * Test provider connectivity
     */
    async testConnection(testConfig = {}) {
      try {
        const testText = 'Hello';
        const result = await this.translate({
          text: testText,
          source: 'en',
          target: 'es',
          stream: false,
          ...testConfig
        });
        
        return {
          success: true,
          result: result?.text || result,
          latency: Date.now() - (this.testStartTime || Date.now())
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          retryable: error.retryable
        };
      }
    }
  }

  /**
   * Utility function to create a provider wrapper with UMD pattern
   */
  function createProviderWrapper(ProviderClass, name) {
    return function (root, factory) {
      const provider = factory(root);
      const globalName = `qwenProvider${name.charAt(0).toUpperCase() + name.slice(1)}`;
      
      if (typeof window !== 'undefined') window[globalName] = provider;
      else if (typeof self !== 'undefined') self[globalName] = provider;
      if (typeof module !== 'undefined') module.exports = provider;
    };
  }

  /**
   * Helper function to ensure URL ends with slash
   */
  function withSlash(url) {
    return /\/$/.test(url) ? url : (url + '/');
  }

  /**
   * Helper function to create system prompts
   */
  function createSystemPrompt(source, target, customPrompt) {
    if (customPrompt) {
      return customPrompt.replace(/\{source\}/g, source).replace(/\{target\}/g, target);
    }
    
    return `You are a professional translator. Translate the user message from ${source} to ${target}. Output only the translation, no explanations.`;
  }

  // Public API
  return {
    BaseProvider,
    PROVIDER_CAPABILITIES,
    CONFIG_SCHEMA,
    createProviderWrapper,
    withSlash,
    createSystemPrompt
  };

}));