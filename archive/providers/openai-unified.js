/**
 * @fileoverview OpenAI provider implementation using unified BaseProvider architecture
 * Demonstrates the new provider pattern with standardized error handling and capabilities
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenProviderOpenAI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const BaseProvider = (typeof self !== 'undefined' && self.qwenBaseProvider?.BaseProvider) ||
                      (typeof require !== 'undefined' ? require('../core/base-provider').BaseProvider : null);
  
  const { PROVIDER_CAPABILITIES } = (typeof self !== 'undefined' && self.qwenBaseProvider) ||
                                   (typeof require !== 'undefined' ? require('../core/base-provider') : {});

  if (!BaseProvider) {
    throw new Error('BaseProvider not available - ensure base-provider.js is loaded');
  }

  /**
   * OpenAI translation provider extending BaseProvider
   */
  class OpenAIProvider extends BaseProvider {
    constructor(config = {}) {
      super({
        name: 'openai',
        label: 'OpenAI',
        capabilities: [
          PROVIDER_CAPABILITIES.STREAMING,
          PROVIDER_CAPABILITIES.MULTIPLE_MODELS,
          PROVIDER_CAPABILITIES.CUSTOM_PROMPTS
        ],
        schema: {
          required: ['apiKey'],
          optional: ['endpoint', 'model', 'timeout'],
          validation: {
            apiKey: (val) => typeof val === 'string' && val.trim().length > 0,
            endpoint: (val) => !val || /^https?:\/\//.test(val),
            model: (val) => !val || typeof val === 'string'
          }
        },
        ...config
      });

      // OpenAI specific defaults
      this.config = {
        endpoint: 'https://api.openai.com/v1/',
        model: 'gpt-3.5-turbo',
        ...this.config
      };
    }

    /**
     * Add OpenAI-specific authentication headers
     */
    addAuth(headers, apiKey) {
      const key = (apiKey || this.config.apiKey || '').trim();
      if (key) {
        headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
      }
      return headers;
    }

    /**
     * Create OpenAI-specific request body
     */
    createRequestBody(params) {
      const { text, source = 'auto', target = 'en', model, stream = true } = params;
      
      const systemPrompt = this.config.customPrompt || 
        `You are a professional translator. Translate the user message from ${source} to ${target}. Output only the translation, no explanations.`;

      return {
        model: model || this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        stream: !!stream
      };
    }

    /**
     * Parse streaming OpenAI response
     */
    async parseStreamingResponse(response, onData, signal) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = '';

      try {
        while (true) {
          if (signal?.aborted) {
            throw new Error('Request aborted');
          }

          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              try { reader.cancel(); } catch {}
              break;
            }

            try {
              const obj = JSON.parse(data);
              const chunk = obj.choices?.[0]?.delta?.content || '';
              if (chunk) {
                result += chunk;
                if (onData) onData(chunk);
              }
            } catch (e) {
              // Skip invalid JSON chunks
              continue;
            }
          }
        }
      } finally {
        try { reader.cancel(); } catch {}
      }

      return { text: result };
    }

    /**
     * Parse non-streaming OpenAI response
     */
    async parseResponse(response) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      
      if (!text) {
        throw new Error('Invalid API response: missing content in choices[0].message.content');
      }

      return { 
        text,
        metadata: {
          model: data.model,
          usage: data.usage,
          id: data.id
        }
      };
    }

    /**
     * Get endpoint URL for requests
     */
    getEndpoint() {
      const base = this.config.endpoint.replace(/\/$/, '');
      return `${base}/chat/completions`;
    }

    /**
     * List available models (if supported)
     */
    async listModels({ signal } = {}) {
      try {
        const headers = this.addAuth(
          this.createHeaders(),
          this.config.apiKey
        );

        const response = await this.fetchFn(
          this.config.endpoint.replace(/\/$/, '') + '/models',
          {
            method: 'GET',
            headers,
            signal
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return (data.data || [])
          .map(model => model.id)
          .filter(id => id && (id.includes('gpt') || id.includes('text-')))
          .sort();

      } catch (error) {
        this.logger.warn('Failed to list OpenAI models:', error.message);
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']; // Default models
      }
    }

    /**
     * Test connection with OpenAI API
     */
    async testConnection(testConfig = {}) {
      this.testStartTime = Date.now();
      
      try {
        const result = await this.translate({
          text: 'Hello world',
          source: 'en',
          target: 'es',
          stream: false,
          ...testConfig
        });

        return {
          success: true,
          result: result.text,
          latency: Date.now() - this.testStartTime,
          provider: this.name
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code || error.status,
          retryable: error.retryable !== false,
          latency: Date.now() - this.testStartTime,
          provider: this.name
        };
      }
    }

    /**
     * Get provider metadata
     */
    getMetadata() {
      return {
        ...super.getMetadata(),
        models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'gpt-4o'],
        pricing: {
          input_cost_per_token: 0.0005 / 1000,  // $0.0005 per 1K tokens
          output_cost_per_token: 0.0015 / 1000  // $0.0015 per 1K tokens
        },
        limits: {
          max_tokens: 4096,
          requests_per_minute: 3500,
          tokens_per_minute: 90000
        }
      };
    }
  }

  // Create provider instance (with test config if no API key available)
  const provider = new OpenAIProvider({
    apiKey: 'test-key-placeholder'  // Will be overridden by actual config
  });

  // Wrap with legacy interface for backward compatibility
  const legacyInterface = {
    translate: provider.translate.bind(provider),
    listModels: provider.listModels.bind(provider),
    testConnection: provider.testConnection.bind(provider),
    getMetadata: provider.getMetadata.bind(provider),
    throttle: { requestLimit: 60, windowMs: 60000 }
  };

  // Register with provider registry if available
  try {
    const registry = (typeof self !== 'undefined' && self.qwenProviders) ||
                    (typeof require !== 'undefined' ? require('./index') : null);
    
    if (registry && registry.registerProvider && !registry.getProvider('openai-unified')) {
      registry.registerProvider('openai-unified', legacyInterface);
    }
  } catch (e) {
    // Registry not available, continue without registration
  }

  return legacyInterface;
}));