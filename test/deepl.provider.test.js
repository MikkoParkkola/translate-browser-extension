const fetchMock = require('jest-fetch-mock');
beforeAll(() => fetchMock.enableMocks());
beforeEach(() => fetch.resetMocks());

describe('deepl provider', () => {
  const { translate } = require('../src/providers/deepl');
  test('sends request and parses response', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({ translations: [{ text: 'hola' }] })
    );
    const res = await translate({
      endpoint: 'https://d/',
      apiKey: 'k',
      text: 'hello',
      source: 'en',
      target: 'es',
    });
    expect(res.text).toBe('hola');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://d/v2/translate');
    expect(opts.headers.Authorization).toBe('DeepL-Auth-Key k');
    expect(opts.body).toBe('text=hello&source_lang=EN&target_lang=ES');
  });
});
