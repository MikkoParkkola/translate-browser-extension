const { TextEncoder, TextDecoder } = require('util');

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

describe('BaseProvider and unified providers', () => {
  let BaseProviderModule;
  let BaseProvider;
  let PROVIDER_CAPABILITIES;
  let createProviderWrapper;
  let withSlash;
  let createSystemPrompt;
  let errorHandlerMock;

  class FakeResponse {
    constructor({ ok = true, status = 200, statusText = 'OK', body = null, json = null }) {
      this.ok = ok;
      this.status = status;
      this.statusText = statusText;
      this._json = json;
      this.body = body;
    }

    async json() {
      if (typeof this._json === 'function') {
        return this._json();
      }
      return this._json;
    }
  }

  beforeEach(() => {
    jest.resetModules();
    global.self = global;
    errorHandlerMock = {
      handleNetworkError: jest.fn(),
      wrapProviderOperation: jest.fn((fn) => fn),
      handleHttpError: jest.fn(async (response) => {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      })
    };
    global.self.qwenProviderErrorHandler = errorHandlerMock;

    BaseProviderModule = require('../src/core/base-provider.js');
    BaseProvider = BaseProviderModule.BaseProvider;
    PROVIDER_CAPABILITIES = BaseProviderModule.PROVIDER_CAPABILITIES;
    createProviderWrapper = BaseProviderModule.createProviderWrapper;
    withSlash = BaseProviderModule.withSlash;
    createSystemPrompt = BaseProviderModule.createSystemPrompt;

    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    delete global.self.qwenProviderErrorHandler;
    delete global.self.qwenBaseProvider;
    if (Math.random.mockRestore) Math.random.mockRestore();
    jest.useRealTimers();
  });

  function buildTestProvider(config = {}) {
    class ConcreteProvider extends BaseProvider {
      constructor(conf = {}) {
        super({
          name: 'test',
          label: 'Test Provider',
          capabilities: [PROVIDER_CAPABILITIES.STREAMING],
          schema: {
            required: ['apiKey', 'endpoint'],
            validation: {
              apiKey: (val) => typeof val === 'string' && val.length > 0,
              endpoint: (val) => typeof val === 'string' && val.startsWith('https://'),
            }
          },
          fetchFn: conf.fetchFn,
          ...conf
        });
      }

      addAuth(headers, apiKey) {
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        return headers;
      }

      createRequestBody(params) {
        return { text: params.text, stream: params.stream };
      }

      async parseStreamingResponse(response, onData) {
        const reader = response.body.getReader();
        let text = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = new TextDecoder().decode(value);
          text += chunk;
          onData(chunk);
        }
        return { text };
      }

      async parseResponse(response) {
        const data = await response.json();
        return { text: data.translation };
      }
    }

    return new ConcreteProvider(config);
  }

  function createStreamingResponse(chunks) {
    let index = 0;
    const encoder = new TextEncoder();
    return {
      getReader() {
        return {
          read() {
            if (index < chunks.length) {
              const value = encoder.encode(chunks[index++]);
              return Promise.resolve({ value, done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
          cancel: jest.fn(),
        };
      }
    };
  }

  test('creates headers, capabilities, and metadata', () => {
    const provider = buildTestProvider({ apiKey: 'secret', endpoint: 'https://example.com', fetchFn: jest.fn() });
    expect(provider.hasCapability(PROVIDER_CAPABILITIES.STREAMING)).toBe(true);
    provider.addCapability('batch');
    expect(provider.hasCapability('batch')).toBe(true);

    const headers = provider.createHeaders();
    expect(headers['Content-Type']).toBe('application/json');

    const metadata = provider.getMetadata();
    expect(metadata.name).toBe('test');
    expect(metadata.capabilities).toContain(PROVIDER_CAPABILITIES.STREAMING);
  });

  test('validateParams enforces input types', () => {
    const provider = buildTestProvider({ apiKey: 'abc', endpoint: 'https://example.com', fetchFn: jest.fn() });
    expect(() => provider.validateParams({})).toThrow('Missing required parameter: text');
    expect(() => provider.validateParams({ text: 5 })).toThrow('Parameter "text" must be a string');

    const controller = new AbortController();
    expect(provider.validateParams({ text: 'hello', signal: controller.signal })).toBe(true);
  });

  test('translate handles non-streaming responses', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new FakeResponse({
      ok: true,
      json: () => ({ translation: 'Hola' })
    }));
    const provider = buildTestProvider({ apiKey: 'key', endpoint: 'https://example.com/api', fetchFn });

    const result = await provider.translate({ text: 'Hello', stream: false });
    expect(result.text).toBe('Hola');
    expect(fetchFn).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({ method: 'POST' }));
  });

  test('translate handles streaming responses', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new FakeResponse({
      ok: true,
      body: createStreamingResponse(['Par', 'cial']),
    }));
    const onData = jest.fn();
    const provider = buildTestProvider({ apiKey: 'key', endpoint: 'https://example.com/api', fetchFn });
    const result = await provider.translate({ text: 'Hello', stream: true, onData });
    expect(result.text).toBe('Parcial');
    expect(onData).toHaveBeenCalledWith('Par');
  });

  test('translate handles network error through error handler', async () => {
    const error = new TypeError('network failed');
    const fetchFn = jest.fn().mockRejectedValue(error);
    const provider = buildTestProvider({ apiKey: 'x', endpoint: 'https://example.com/api', fetchFn });
    await expect(provider.translate({ text: 'Hi', stream: false })).resolves.toBeUndefined();
    expect(errorHandlerMock.handleNetworkError).toHaveBeenCalled();
  });

  test('translate surfaces HTTP error via handler', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new FakeResponse({ ok: false, status: 500, statusText: 'Server Error' }));
    const provider = buildTestProvider({ apiKey: 'k', endpoint: 'https://example.com/api', fetchFn });
    await expect(provider.translate({ text: 'Hi', stream: false })).rejects.toThrow(/HTTP 500/);
    expect(errorHandlerMock.handleHttpError).toHaveBeenCalled();
  });

  test('withRetry retries until success', async () => {
    jest.useFakeTimers();
    const provider = buildTestProvider({ apiKey: 'k', endpoint: 'https://example.com', fetchFn: jest.fn() });
    let attempts = 0;
    const op = jest.fn(() => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('retry me');
        err.retryable = true;
        throw err;
      }
      return 'done';
    });
    const promise = provider.withRetry(op, 3);
    if (jest.advanceTimersByTimeAsync) {
      await jest.advanceTimersByTimeAsync(100);
    } else {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }
    await expect(promise).resolves.toBe('done');
    expect(op).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });

  test('testConnection returns success and failure results', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new FakeResponse({ ok: true, json: () => ({ translation: 'Hola' }) }));
    const provider = buildTestProvider({ apiKey: 'k', endpoint: 'https://example.com/api', fetchFn });
    const ok = await provider.testConnection({ stream: false });
    expect(ok.success).toBe(true);

    provider.translate = jest.fn().mockRejectedValue(new Error('boom'));
    const fail = await provider.testConnection();
    expect(fail.success).toBe(false);
    expect(fail.error).toBe('boom');
  });

  test('utility helpers work as expected', () => {
    expect(withSlash('https://api.example.com')).toBe('https://api.example.com/');
    expect(withSlash('https://api.example.com/')).toBe('https://api.example.com/');
    expect(createSystemPrompt('en', 'fr')).toContain('en');
    expect(createSystemPrompt('en', 'fr', 'Custom {source} -> {target}')).toBe('Custom en -> fr');

    const registry = {};
    const wrapper = createProviderWrapper(function Provider() { return { id: 'wrapped' }; }, 'sample');
    wrapper(registry, () => ({ id: 'wrapped' }));
    expect(global.qwenProviderSample).toEqual({ id: 'wrapped' });
  });

  test('handleError wraps generic errors', async () => {
    const provider = buildTestProvider({ apiKey: 'k', endpoint: 'https://example.com', fetchFn: jest.fn() });
    const generic = new Error('generic');
    await expect(provider.handleError(generic, { endpoint: 'https://example.com' })).rejects.toThrow('generic');
    expect(errorHandlerMock.wrapProviderOperation).toHaveBeenCalled();
  });

  test('handleError respects abort and status errors', async () => {
    const provider = buildTestProvider({ apiKey: 'k', endpoint: 'https://example.com', fetchFn: jest.fn() });
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    expect(() => provider.handleError(abortError)).toThrow('aborted');

    const statusError = new Error('http');
    statusError.status = 502;
    expect(() => provider.handleError(statusError)).toThrow('http');
  });

  describe('Unified providers', () => {
    let OpenAIProvider;
    let AnthropicProvider;

    beforeEach(() => {
      global.self.qwenBaseProvider = BaseProviderModule;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function createStreamPayload(payloads) {
      const encoder = new TextEncoder();
      let index = 0;
      return {
        getReader() {
          return {
            read() {
              if (index < payloads.length) {
                const value = encoder.encode(payloads[index++]);
                return Promise.resolve({ value, done: false });
              }
              return Promise.resolve({ value: undefined, done: true });
            },
            cancel: jest.fn(),
          };
        }
      };
    }

    test('OpenAI provider flows', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(new FakeResponse({ ok: true, json: () => ({ choices: [{ message: { content: 'Bonjour' } }], model: 'gpt', usage: {}, id: 'id' }) }))
        .mockResolvedValueOnce(new FakeResponse({ ok: true, body: createStreamPayload(['data: {"choices":[{"delta":{"content":"Bon"}}]}\n', 'data: {"choices":[{"delta":{"content":"jour"}}]}\n', 'data: [DONE]\n']) }))
        .mockResolvedValueOnce(new FakeResponse({ ok: true, json: () => ({ data: [{ id: 'gpt-a' }, { id: 'text-b' }] }) }))
        .mockResolvedValueOnce(new FakeResponse({ ok: false, status: 500, statusText: 'err' }))
        .mockResolvedValueOnce(new FakeResponse({ ok: true, json: () => ({ choices: [{ message: { content: 'Test' } }], model: 'gpt', usage: {}, id: 'test' }) }));

      global.fetch = fetchFn;
      global.self.qwenProviders = { registerProvider: jest.fn(), getProvider: jest.fn().mockReturnValue(null) };

      let openai;
      jest.isolateModules(() => {
        openai = require('../src/providers/openai-unified.js');
      });

      const result = await openai.translate({ text: 'Hi', stream: false, apiKey: 'token-123' });
      expect(result.text).toBe('Bonjour');
      expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer token-123');

      const onData = jest.fn();
      const streamed = await openai.translate({ text: 'Hi', stream: true, onData, apiKey: 'token-123' });
      expect(streamed.text).toBe('Bonjour');
      expect(onData).toHaveBeenCalled();

      const models = await openai.listModels();
      expect(models).toEqual(['gpt-a', 'text-b']);

      const fallback = await openai.listModels();
      expect(fallback).toContain('gpt-3.5-turbo');

      const metadata = openai.getMetadata();
      expect(metadata.models).toContain('gpt-4');

      const testResult = await openai.testConnection({ stream: false, apiKey: 'token-123' });
      expect(testResult.success).toBe(true);

      delete global.fetch;
      delete global.self.qwenProviders;
    });

    test('Anthropic provider flows', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(new FakeResponse({ ok: true, json: () => ({ content: [{ text: 'Salut' }], model: 'claude', usage: {}, id: 'id', stop_reason: 'end' }) }))
        .mockResolvedValueOnce(new FakeResponse({ ok: true, body: createStreamPayload(['data: {"delta":{"text":"Sa"}}\n', 'data: {"delta":{"text":"lut"}}\n', 'data: {"stop_reason":"end"}\n']) }))
        .mockResolvedValueOnce(new FakeResponse({ ok: false, status: 404, statusText: 'missing' }))
        .mockResolvedValueOnce(new FakeResponse({ ok: true, json: () => ({ content: [{ text: 'Salut' }], model: 'claude', usage: {}, id: 'id', stop_reason: 'end' }) }));

      global.fetch = fetchFn;
      global.self.qwenProviders = { registerProvider: jest.fn(), getProvider: jest.fn().mockReturnValue(null) };

      let anthropic;
      jest.isolateModules(() => {
        anthropic = require('../src/providers/anthropic-unified.js');
      });

      const response = await anthropic.translate({ text: 'Hi', stream: false, apiKey: 'anthro-key' });
      expect(response.text).toBe('Salut');
      expect(fetchFn.mock.calls[0][1].headers['x-api-key']).toBe('anthro-key');

      const onData = jest.fn();
      const stream = await anthropic.translate({ text: 'Hi', stream: true, onData, apiKey: 'anthro-key' });
      expect(stream.text).toBe('Salut');
      expect(onData).toHaveBeenCalled();

      const fallback = await anthropic.listModels();
      expect(fallback).toContain('claude-3-haiku-20240307');

      const metadata = anthropic.getMetadata();
      expect(metadata.models).toContain('claude-3-haiku-20240307');

      const testResult = await anthropic.testConnection({ stream: false, apiKey: 'anthro-key' });
      expect(testResult.success).toBe(true);

      delete global.fetch;
      delete global.self.qwenProviders;
    });
  });
});
