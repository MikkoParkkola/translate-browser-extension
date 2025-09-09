/**
 * @fileoverview Test suite for unified provider architecture
 * Validates that providers extend BaseProvider correctly and maintain compatibility
 */

// Mock fetch and other dependencies
global.fetch = jest.fn();
global.TextDecoder = jest.fn(() => ({
  decode: jest.fn((data) => {
    // Mock implementation that avoids infinite recursion
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      return String.fromCharCode(...new Uint8Array(data));
    }
    return String(data);
  })
}));
global.TextEncoder = jest.fn(() => ({
  encode: jest.fn((text) => {
    // Mock implementation that avoids infinite recursion
    const str = String(text);
    const result = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      result[i] = str.charCodeAt(i);
    }
    return result;
  })
}));
// Create proper AbortSignal mock that passes instanceof check
class MockAbortSignal {
  constructor() {
    let aborted = false;
    let reason = undefined;
    
    // Use defineProperty to create aborted getter like real AbortSignal
    Object.defineProperty(this, 'aborted', {
      get() { return aborted; },
      configurable: true
    });
    
    // Use defineProperty to create reason getter like real AbortSignal
    Object.defineProperty(this, 'reason', {
      get() { return reason; },
      configurable: true
    });
    
    // Store internal setters for AbortController to use
    this._setAborted = (value) => { aborted = value; };
    this._setReason = (value) => { reason = value; };
    
    this.addEventListener = jest.fn();
    this.removeEventListener = jest.fn();
  }
}

// Make MockAbortSignal pass instanceof AbortSignal check
if (typeof AbortSignal !== 'undefined') {
  Object.setPrototypeOf(MockAbortSignal.prototype, AbortSignal.prototype);
}

global.AbortController = jest.fn(function MockAbortController() {
  const listeners = [];
  
  const signal = new MockAbortSignal();
  
  signal.addEventListener = jest.fn((type, listener) => {
    if (type === 'abort') listeners.push(listener);
  });
  
  const abort = jest.fn(() => {
    signal._setAborted(true);
    signal._setReason(new Error('AbortError'));
    listeners.forEach(listener => listener({ type: 'abort' }));
  });
  
  return { signal, abort };
});

describe('Unified Provider Architecture', () => {
  let BaseProvider, PROVIDER_CAPABILITIES;
  let OpenAIProvider, AnthropicProvider;

  beforeAll(() => {
    // Load base provider
    const baseProviderModule = require('../../src/core/base-provider');
    BaseProvider = baseProviderModule.BaseProvider;
    PROVIDER_CAPABILITIES = baseProviderModule.PROVIDER_CAPABILITIES;

    // Mock the environment for providers
    global.self = {
      qwenBaseProvider: { BaseProvider, PROVIDER_CAPABILITIES }
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockClear();
  });

  describe('OpenAI Unified Provider', () => {
    beforeEach(() => {
      delete require.cache[require.resolve('../../src/providers/openai-unified.js')];
      OpenAIProvider = require('../../src/providers/openai-unified.js');
    });

    test('GOLDEN: provider extends BaseProvider correctly', () => {
      expect(OpenAIProvider).toBeDefined();
      expect(typeof OpenAIProvider.translate).toBe('function');
      expect(typeof OpenAIProvider.listModels).toBe('function');
      expect(typeof OpenAIProvider.testConnection).toBe('function');
    });

    test('GOLDEN: translation request with streaming', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: jest.fn()
              .mockResolvedValueOnce({
                done: false,
                value: Buffer.from('data: {"choices":[{"delta":{"content":"Hola"}}]}\n')
              })
              .mockResolvedValueOnce({
                done: false,
                value: Buffer.from('data: {"choices":[{"delta":{"content":" mundo"}}]}\n')
              })
              .mockResolvedValueOnce({
                done: false,
                value: Buffer.from('data: [DONE]\n')
              })
              .mockResolvedValueOnce({ done: true }),
            cancel: jest.fn()
          })
        }
      };

      global.fetch.mockResolvedValue(mockResponse);

      const result = await OpenAIProvider.translate({
        text: 'Hello world',
        source: 'en',
        target: 'es',
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo',
        stream: true,
        onData: jest.fn()
      });

      expect(result.text).toBe('Hola mundo');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key'
          }),
          body: expect.stringContaining('gpt-3.5-turbo')
        })
      );
    });

    test('translation request with non-streaming', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: { content: 'Hola mundo' }
          }],
          model: 'gpt-3.5-turbo',
          usage: { prompt_tokens: 20, completion_tokens: 5 }
        })
      };

      global.fetch.mockResolvedValue(mockResponse);

      const result = await OpenAIProvider.translate({
        text: 'Hello world',
        source: 'en',
        target: 'es',
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo',
        stream: false
      });

      expect(result.text).toBe('Hola mundo');
      expect(result.metadata.model).toBe('gpt-3.5-turbo');
      expect(result.metadata.usage).toBeDefined();
    });

    test('error handling with retry logic', async () => {
      const mockError = { status: 429, statusText: 'Too Many Requests' };
      global.fetch
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: 'Hola mundo' } }]
          })
        });

      const result = await OpenAIProvider.translate({
        text: 'Hello world',
        source: 'en',
        target: 'es',
        apiKey: 'test-key',
        stream: false
      });

      expect(result.text).toBe('Hola mundo');
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('test connection validates API access', async () => {
      // Mock Date.now to ensure latency > 0
      const originalDateNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        return originalDateNow() + (callCount - 1) * 10; // Each call adds 10ms
      });

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Hola' } }]
        })
      });

      const result = await OpenAIProvider.testConnection();

      expect(result.success).toBe(true);
      expect(result.result).toBe('Hola');
      expect(result.latency).toBeGreaterThan(0);
      expect(result.provider).toBe('openai');

      // Restore Date.now
      Date.now = originalDateNow;
    });

    test('metadata contains expected structure', () => {
      const metadata = OpenAIProvider.getMetadata();
      
      expect(metadata.name).toBe('openai');
      expect(metadata.label).toBe('OpenAI');
      expect(metadata.models).toContain('gpt-3.5-turbo');
      expect(metadata.pricing).toBeDefined();
      expect(metadata.limits).toBeDefined();
    });
  });

  describe('Anthropic Unified Provider', () => {
    beforeEach(() => {
      delete require.cache[require.resolve('../../src/providers/anthropic-unified.js')];
      AnthropicProvider = require('../../src/providers/anthropic-unified.js');
    });

    test('GOLDEN: provider extends BaseProvider correctly', () => {
      expect(AnthropicProvider).toBeDefined();
      expect(typeof AnthropicProvider.translate).toBe('function');
      expect(typeof AnthropicProvider.listModels).toBe('function');
      expect(typeof AnthropicProvider.testConnection).toBe('function');
    });

    test('GOLDEN: translation request with Anthropic API format', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          content: [{ text: 'Hola mundo' }],
          model: 'claude-3-haiku-20240307',
          usage: { input_tokens: 20, output_tokens: 5 },
          stop_reason: 'end_turn'
        })
      };

      global.fetch.mockResolvedValue(mockResponse);

      const result = await AnthropicProvider.translate({
        text: 'Hello world',
        source: 'en',
        target: 'es',
        apiKey: 'test-key',
        model: 'claude-3-haiku-20240307',
        stream: false
      });

      expect(result.text).toBe('Hola mundo');
      expect(result.metadata.model).toBe('claude-3-haiku-20240307');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-key': 'test-key',
            'anthropic-version': '2023-06-01'
          })
        })
      );
    });

    test('streaming translation with Claude format', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: jest.fn()
              .mockResolvedValueOnce({
                done: false,
                value: Buffer.from('data: {"delta":{"text":"Hola"}}\n')
              })
              .mockResolvedValueOnce({
                done: false,
                value: Buffer.from('data: {"delta":{"text":" mundo"}}\n')
              })
              .mockResolvedValueOnce({ done: true }),
            cancel: jest.fn()
          })
        }
      };

      global.fetch.mockResolvedValue(mockResponse);

      const onDataMock = jest.fn();
      const result = await AnthropicProvider.translate({
        text: 'Hello world',
        source: 'en',
        target: 'es',
        apiKey: 'test-key',
        stream: true,
        onData: onDataMock
      });

      expect(result.text).toBe('Hola mundo');
      expect(onDataMock).toHaveBeenCalledWith('Hola');
      expect(onDataMock).toHaveBeenCalledWith(' mundo');
    });

    test('metadata contains Anthropic-specific information', () => {
      const metadata = AnthropicProvider.getMetadata();
      
      expect(metadata.name).toBe('anthropic');
      expect(metadata.label).toBe('Anthropic Claude');
      expect(metadata.models).toContain('claude-3-haiku-20240307');
      expect(metadata.pricing).toBeDefined();
      expect(metadata.limits).toBeDefined();
    });
  });

  describe('Provider Compatibility', () => {
    test('GOLDEN: both providers implement same interface', () => {
      const openaiMethods = Object.keys(OpenAIProvider).sort();
      const anthropicMethods = Object.keys(AnthropicProvider).sort();
      
      expect(openaiMethods).toEqual(anthropicMethods);
    });

    test('providers maintain legacy interface compatibility', () => {
      const requiredMethods = ['translate', 'listModels', 'testConnection', 'getMetadata'];
      
      for (const method of requiredMethods) {
        expect(typeof OpenAIProvider[method]).toBe('function');
        expect(typeof AnthropicProvider[method]).toBe('function');
      }
    });

    test('providers handle AbortSignal correctly', async () => {
      const controller = new AbortController();
      controller.abort();

      global.fetch.mockImplementation(() => {
        throw { name: 'AbortError', message: 'Request aborted' };
      });

      await expect(OpenAIProvider.translate({
        text: 'Hello',
        target: 'es',
        apiKey: 'test',
        signal: controller.signal
      })).rejects.toMatchObject({
        name: 'AbortError'
      });
    });

    test('providers handle invalid API responses gracefully', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}) // Empty response
      });

      await expect(OpenAIProvider.translate({
        text: 'Hello',
        target: 'es',
        apiKey: 'test',
        stream: false
      })).rejects.toThrow('Invalid API response');
    });
  });

  describe('BaseProvider Integration', () => {
    let mockProvider;

    beforeEach(() => {
      // Create a mock provider that extends BaseProvider
      class MockProvider extends BaseProvider {
        constructor() {
          super({
            name: 'mock',
            label: 'Mock Provider',
            capabilities: [PROVIDER_CAPABILITIES.STREAMING]
          });
        }

        createRequestBody(params) {
          return { text: params.text, model: 'mock-model' };
        }

        async parseResponse(response) {
          const data = await response.json();
          return { text: data.translation };
        }

        getEndpoint() {
          return 'https://api.mock.com/translate';
        }
      }

      mockProvider = new MockProvider();
    });

    test('BaseProvider provides retry logic', async () => {
      let callCount = 0;
      const mockOperation = jest.fn(() => {
        callCount++;
        if (callCount < 3) {
          const error = new Error('Temporary failure');
          error.retryable = true;
          throw error;
        }
        return 'success';
      });

      const result = await mockProvider.withRetry(mockOperation, 3);
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    test('BaseProvider validates parameters', () => {
      expect(() => {
        mockProvider.validateParams({});
      }).toThrow('Missing required parameter: text');

      expect(() => {
        mockProvider.validateParams({ text: 123 });
      }).toThrow('Parameter "text" must be a string');

      expect(mockProvider.validateParams({ text: 'Hello' })).toBe(true);
    });

    test('BaseProvider handles capabilities correctly', () => {
      expect(mockProvider.hasCapability(PROVIDER_CAPABILITIES.STREAMING)).toBe(true);
      expect(mockProvider.hasCapability(PROVIDER_CAPABILITIES.BATCH_TRANSLATION)).toBe(false);
      
      mockProvider.addCapability(PROVIDER_CAPABILITIES.BATCH_TRANSLATION);
      expect(mockProvider.hasCapability(PROVIDER_CAPABILITIES.BATCH_TRANSLATION)).toBe(true);
    });
  });
});