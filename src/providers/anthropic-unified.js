/**
 * @fileoverview Anthropic provider implementation using unified BaseProvider architecture
 * Demonstrates Claude API integration with standardized error handling and capabilities
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenProviderAnthropic = factory();
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
   * Anthropic translation provider extending BaseProvider
   */
  class AnthropicProvider extends BaseProvider {
    constructor(config = {}) {
      super({
        name: 'anthropic',
        label: 'Anthropic Claude',
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

      // Anthropic specific defaults
      this.config = {
        endpoint: 'https://api.anthropic.com/v1/',
        model: 'claude-3-haiku-20240307',
        ...this.config
      };
    }

    /**
     * Add Anthropic-specific authentication headers
     */
    addAuth(headers, apiKey) {
      const key = (apiKey || this.config.apiKey || '').trim();
      if (key) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
      }
      return headers;
    }

    /**
     * Create Anthropic-specific request body
     */
    createRequestBody(params) {
      const { text, source = 'auto', target = 'en', model, stream = true } = params;
      
      const systemPrompt = this.config.customPrompt || 
        `You are a professional translator. Translate the user message from ${source} to ${target}. Output only the translation, no explanations.`;

      return {
        model: model || this.config.model,
        system: systemPrompt,
        messages: [
          { role: 'user', content: text }
        ],
        stream: !!stream,
        max_tokens: 4096
      };
    }

    /**
     * Parse streaming Anthropic response
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
            if (!data) continue;

            try {
              const obj = JSON.parse(data);
              const chunk = obj.delta?.text || obj.content?.[0]?.text || '';
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
     * Parse non-streaming Anthropic response
     */
    async parseResponse(response) {
      const data = await response.json();
      const text = data.content?.[0]?.text;
      
      if (!text) {
        throw new Error('Invalid API response: missing content[0].text');
      }

      return { 
        text,
        metadata: {
          model: data.model,
          usage: data.usage,
          id: data.id,
          stop_reason: data.stop_reason
        }
      };
    }

    /**
     * Get endpoint URL for requests
     */
    getEndpoint() {
      const base = this.config.endpoint.replace(/\/$/, '');
      return `${base}/messages`;
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
          // Anthropic doesn't have a public models endpoint, return defaults
          throw new Error('Models endpoint not available');
        }

        const data = await response.json();
        return (data.data || []).map(model => model.id).filter(Boolean);

      } catch (error) {
        this.logger.warn('Failed to list Anthropic models:', error.message);
        return [
          'claude-3-haiku-20240307',
          'claude-3-sonnet-20240229',
          'claude-3-opus-20240229',
          'claude-3-5-sonnet-20241022'
        ];
      }
    }

    /**
     * Test connection with Anthropic API
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
        models: [
          'claude-3-haiku-20240307',
          'claude-3-sonnet-20240229', 
          'claude-3-opus-20240229',
          'claude-3-5-sonnet-20241022'
        ],
        pricing: {
          input_cost_per_token: 0.00025 / 1000,  // Haiku pricing
          output_cost_per_token: 0.00125 / 1000
        },
        limits: {
          max_tokens: 4096,
          requests_per_minute: 1000,
          tokens_per_minute: 40000
        }
      };
    }
  }

  // Create provider instance (with test config if no API key available)
  const provider = new AnthropicProvider({
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
    
    if (registry && registry.registerProvider && !registry.getProvider('anthropic-unified')) {
      registry.registerProvider('anthropic-unified', legacyInterface);
    }
  } catch (e) {
    // Registry not available, continue without registration
  }

  return legacyInterface;
}));