// @jest-environment node

describe('provider error normalization', () => {
  beforeEach(() => {
    jest.resetModules();
    fetch.resetMocks();
  });

  function mockResp(status, body = { error: { message: 'x' } }, headers = {}) {
    const h = new Headers(headers);
    fetch.mockResponseOnce(JSON.stringify(body), { status, headers: h });
  }

  test('openai: 401 sets retryable=false', async () => {
    const openai = require('../src/providers/openai.js');
    mockResp(401, { error: { message: 'unauthorized' } });
    await expect(openai.translate({ endpoint: 'https://api.openai.com/v1', apiKey: 'bad', model: 'gpt', text: 't', source: 'en', target: 'es', stream: false }))
      .rejects.toMatchObject({ status: 401, retryable: false });
  });

  test('openai: 429 sets retryable=true and parses Retry-After', async () => {
    const openai = require('../src/providers/openai.js');
    mockResp(429, { error: { message: 'too many' } }, { 'retry-after': '2' });
    const p = openai.translate({ endpoint: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt', text: 't', source: 'en', target: 'es', stream: false });
    await expect(p).rejects.toMatchObject({ status: 429, retryable: true, retryAfter: expect.any(Number) });
  });

  test('deepl: 403 retryable=false; 500 retryable=true', async () => {
    const deepl = require('../src/providers/deepl.js');
    mockResp(403, { message: 'forbidden' });
    await expect(deepl.translate({ apiKey: 'bad', text: 't', source: 'en', target: 'es' })).rejects.toMatchObject({ status: 403, retryable: false });
    fetch.resetMocks();
    mockResp(500, { message: 'server' });
    await expect(deepl.translate({ apiKey: 'k', text: 't', source: 'en', target: 'es' })).rejects.toMatchObject({ status: 500, retryable: true });
  });
});

