const fetchMock = require('jest-fetch-mock');
beforeAll(() => fetchMock.enableMocks());
beforeEach(() => fetch.resetMocks());

describe('google provider', () => {
  const { translate } = require('../src/providers/google');
  test('sends request and parses response', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({ translations: [{ translatedText: 'hola' }], totalCharacters: 5 })
    );
    const res = await translate({
      endpoint: 'https://g/',
      apiKey: 'k',
      projectId: 'p',
      location: 'l',
      model: 'nmt',
      text: 'hello',
      source: 'en',
      target: 'es',
    });
    expect(res.text).toBe('hola');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://g/projects/p/locations/l:translateText');
    expect(JSON.parse(opts.body)).toEqual({
      contents: ['hello'],
      mimeType: 'text/plain',
      sourceLanguageCode: 'en',
      targetLanguageCode: 'es',
      model: 'nmt',
    });
    expect(opts.headers.Authorization).toBe('Bearer k');
  });
});
