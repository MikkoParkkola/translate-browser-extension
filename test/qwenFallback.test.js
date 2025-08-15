const provider = require('../src/providers/qwen');

describe('qwen provider fallback', () => {
  beforeEach(() => {
    fetch.resetMocks();
  });

  test('falls back to secondary model on 429', async () => {
    fetch
      .mockResponseOnce(JSON.stringify({ message: 'limit' }), { status: 429 })
      .mockResponseOnce(
        JSON.stringify({ output: { text: 'hi' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const res = await provider.translate({
      endpoint: 'https://api.example.com',
      apiKey: 'k',
      model: 'primary',
      secondaryModel: 'fallback',
      text: 'hello',
      source: 'en',
      target: 'zh',
      stream: false,
    });

    expect(res.text).toBe('hi');
    expect(fetch.mock.calls.length).toBe(2);
    const firstBody = JSON.parse(fetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(firstBody.model).toBe('primary');
    expect(secondBody.model).toBe('fallback');
  });
});
