const fetchMock = require('jest-fetch-mock');
beforeAll(() => fetchMock.enableMocks());
beforeEach(() => fetch.resetMocks());

describe('google provider', () => {
  const { translate } = require('../src/providers/google');
  test('sends request and parses response', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({ data: { translations: [{ translatedText: 'hola' }] } })
    );
    const res = await translate({
      endpoint: 'https://g/',
      apiKey: 'k',
      model: 'nmt',
      text: 'hello',
      source: 'en',
      target: 'es',
    });
    expect(res.text).toBe('hola');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://g/language/translate/v2');
    expect(JSON.parse(opts.body)).toEqual({
      q: 'hello',
      source: 'en',
      target: 'es',
      format: 'text',
      model: 'nmt',
    });
    expect(opts.headers.Authorization).toBe('Bearer k');
  });
});
