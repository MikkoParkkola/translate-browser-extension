const fetchMock = require('jest-fetch-mock');
beforeAll(() => fetchMock.enableMocks());
beforeEach(() => fetch.resetMocks());

describe('providers basic translate (non-streaming)', () => {
  test('openai.translate returns text and sets Authorization', async () => {
    const { translate } = require('../src/providers/openai');
    fetch.mockResponseOnce(JSON.stringify({ choices: [{ message: { content: 'hola' } }] }));
    const res = await translate({ endpoint: 'https://o/', apiKey: 'k', model: 'gpt', text: 'hello', source: 'en', target: 'es', stream: false });
    expect(res.text).toBe('hola');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://o/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer k');
  });

  test('dashscope.translate returns text and sets Authorization', async () => {
    const { translate } = require('../src/providers/dashscope');
    fetch.mockResponseOnce(JSON.stringify({ output: { text: 'bonjour' } }));
    const res = await translate({ endpoint: 'https://d/', apiKey: 'key', model: 'qwen', text: 'hello', source: 'en', target: 'fr', stream: false });
    expect(res.text).toBe('bonjour');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://d/services/aigc/text-generation/generation');
    expect(opts.headers.Authorization).toBe('Bearer key');
  });

  test('openrouter.translate returns text and sets Authorization', async () => {
    const { translate } = require('../src/providers/openrouter');
    fetch.mockResponseOnce(JSON.stringify({ choices: [{ message: { content: 'ciao' } }] }));
    const res = await translate({ endpoint: 'https://r/', apiKey: 'tok', model: 'm', text: 'hello', source: 'en', target: 'it', stream: false });
    expect(res.text).toBe('ciao');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://r/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  test('mistral.translate returns text and sets Authorization', async () => {
    const { translate } = require('../src/providers/mistral');
    fetch.mockResponseOnce(JSON.stringify({ choices: [{ message: { content: 'hola' } }] }));
    const res = await translate({ endpoint: 'https://mi/', apiKey: 'mkey', model: 'mistral', text: 'hello', source: 'en', target: 'es', stream: false });
    expect(res.text).toBe('hola');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://mi/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer mkey');
  });

  test('ollama.translate returns text without Authorization', async () => {
    const { translate } = require('../src/providers/ollama');
    fetch.mockResponseOnce(JSON.stringify({ response: 'servus' }));
    const res = await translate({ endpoint: 'http://l/', model: 'llm', text: 'hello', source: 'en', target: 'de', stream: false });
    expect(res.text).toBe('servus');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://l/api/generate');
    expect(opts.headers.Authorization).toBeUndefined();
  });

  test('anthropic.translate returns text and sets x-api-key', async () => {
    const { translate } = require('../src/providers/anthropic');
    fetch.mockResponseOnce(JSON.stringify({ content: [{ text: 'salut' }] }));
    const res = await translate({ endpoint: 'https://a/', apiKey: 'akey', model: 'claude', text: 'hello', source: 'en', target: 'fr', stream: false });
    expect(res.text).toBe('salut');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://a/messages');
    expect(opts.headers['x-api-key']).toBe('akey');
  });

  test('gemini.translate returns text and includes key in query', async () => {
    const { translate } = require('../src/providers/gemini');
    fetch.mockResponseOnce(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hola' }] } }] }));
    const res = await translate({ endpoint: 'https://g/', apiKey: 'gkey', model: 'gemini-pro', text: 'hello', source: 'en', target: 'es', stream: false });
    expect(res.text).toBe('hola');
    const [url] = fetch.mock.calls[0];
    expect(url).toBe('https://g/models/gemini-pro:generateContent?key=gkey');
  });

  test('qwen.translate returns text and sets Authorization', async () => {
    const { translate } = require('../src/providers/qwen');
    fetch.mockResponseOnce(JSON.stringify({ output: { text: 'hei' } }));
    const res = await translate({ endpoint: 'https://q/', apiKey: 'qkey', model: 'qwen', text: 'hello', source: 'en', target: 'fi', stream: false });
    expect(res.text).toBe('hei');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://q/services/aigc/text-generation/generation');
    expect(opts.headers.Authorization).toBe('Bearer qkey');
  });
});

