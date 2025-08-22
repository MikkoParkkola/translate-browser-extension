const fetchMock = require('jest-fetch-mock');
beforeAll(() => fetchMock.enableMocks());
beforeEach(() => fetch.resetMocks());

function makeJson(body, init = {}) {
  return [JSON.stringify(body), init];
}

// Minimal args per provider to hit translate()
const providers = {
  openai: {
    mod: () => require('../src/providers/openai'),
    args: () => ({ endpoint: 'https://o/', apiKey: 'k', model: 'gpt-4o', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
  dashscope: {
    mod: () => require('../src/providers/dashscope'),
    args: () => ({ endpoint: 'https://d/', apiKey: 'k', model: 'qwen', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
  openrouter: {
    mod: () => require('../src/providers/openrouter'),
    args: () => ({ endpoint: 'https://r/', apiKey: 'k', model: 'm', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
  mistral: {
    mod: () => require('../src/providers/mistral'),
    args: () => ({ endpoint: 'https://mi/', apiKey: 'k', model: 'mistral', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
  gemini: {
    mod: () => require('../src/providers/gemini'),
    args: () => ({ endpoint: 'https://g/', apiKey: 'k', model: 'gemini-pro', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
  anthropic: {
    mod: () => require('../src/providers/anthropic'),
    args: () => ({ endpoint: 'https://a/', apiKey: 'k', model: 'claude-3', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
  ollama: {
    mod: () => require('../src/providers/ollama'),
    args: () => ({ endpoint: 'http://l/', model: 'llm', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
  deepl: {
    mod: () => require('../src/providers/deepl'),
    args: () => ({ endpoint: 'https://api.deepl.com/', apiKey: 'k', text: 'hi', source: 'EN', target: 'ES' }),
  },
  qwen: {
    mod: () => require('../src/providers/qwen'),
    args: () => ({ endpoint: 'https://q/', apiKey: 'k', model: 'qwen', text: 'hi', source: 'en', target: 'es', stream: false }),
  },
};

describe('provider error normalization', () => {
  const ids = Object.keys(providers);

  test.each(ids)('%s: 401/403 are non-retryable', async (id) => {
    const { translate } = providers[id].mod();
    const args = providers[id].args();
    fetch.mockResponseOnce(...makeJson({ error: { message: 'nope' } }, { status: 401 }));
    await translate(args).then(
      () => { throw new Error('expected throw'); },
      (e) => {
        expect(e).toBeTruthy();
        expect(e.status).toBe(401);
        expect(!!e.retryable).toBe(false);
      }
    );

    fetch.mockResponseOnce(...makeJson({ error: { message: 'forbidden' } }, { status: 403 }));
    await translate(args).then(
      () => { throw new Error('expected throw'); },
      (e) => {
        expect(e).toBeTruthy();
        expect(e.status).toBe(403);
        expect(!!e.retryable).toBe(false);
      }
    );
  });

  test.each(ids)('%s: 429 sets retryable and retryAfter (numeric seconds)', async (id) => {
    const { translate } = providers[id].mod();
    const args = providers[id].args();
    fetch.mockResponseOnce(...makeJson({ error: { message: 'rate limited' } }, { status: 429, headers: { 'retry-after': '2' } }));
    try { await translate(args); } catch (e) {
      expect(e.status).toBe(429);
      expect(e.retryable).toBe(true);
      // numeric header 2 -> ~2000ms, within [1000, 60000]
      expect(e.retryAfter).toBeGreaterThanOrEqual(1000);
      expect(e.retryAfter).toBeLessThanOrEqual(60000);
    }
  });

  test.each(ids)('%s: 429 without header sets sane default', async (id) => {
    const { translate } = providers[id].mod();
    const args = providers[id].args();
    fetch.mockResponseOnce(...makeJson({ error: { message: 'rate limited' } }, { status: 429 }));
    try { await translate(args); } catch (e) {
      expect(e.status).toBe(429);
      expect(e.retryable).toBe(true);
      // many providers default to 60000; allow >= 100ms
      expect(e.retryAfter).toBeGreaterThanOrEqual(100);
      expect(e.retryAfter).toBeLessThanOrEqual(60000);
    }
  });

  test.each(ids)('%s: 5xx are retryable', async (id) => {
    const { translate } = providers[id].mod();
    const args = providers[id].args();
    fetch.mockResponseOnce(...makeJson({ error: { message: 'server error' } }, { status: 503, headers: { 'retry-after': '3' } }));
    try { await translate(args); } catch (e) {
      expect(e.status).toBe(503);
      expect(e.retryable).toBe(true);
      expect(e.retryAfter).toBeGreaterThanOrEqual(100);
      expect(e.retryAfter).toBeLessThanOrEqual(60000);
    }
  });
});
