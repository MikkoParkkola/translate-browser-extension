const { getProvider } = require('../src/providers');
require('../src/providers/deepl');

describe('deepl provider', () => {
  beforeEach(() => {
    fetch.resetMocks();
  });

  test('deepl-free translates text and returns character counts', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({ translations: [{ text: 'Hallo' }] }),
      { headers: { 'x-deepl-usage': '123/1000' } }
    );
    const prov = getProvider('deepl-free');
    const res = await prov.translate({ apiKey: 'k', text: 'hello', source: 'EN', target: 'DE' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api-free.deepl.com/v2/translate',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.text).toBe('Hallo');
    expect(res.characters).toEqual({ used: 123, limit: 1000 });
  });

  test('deepl-pro document translation returns bytes and billed characters', async () => {
    fetch.mockResponses(
      [JSON.stringify({ document_id: 'id', document_key: 'key' }), { status: 200 }],
      [JSON.stringify({ status: 'done', billed_characters: 42 }), { status: 200 }],
      ['PDF', { status: 200 }]
    );
    const prov = getProvider('deepl-pro');
    const res = await prov.translateDocument({ apiKey: 'k', document: Buffer.from('PDF'), target: 'DE' });
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepl.com/v2/document');
    expect(fetch.mock.calls[1][0]).toBe('https://api.deepl.com/v2/document/id?document_key=key');
    expect(fetch.mock.calls[2][0]).toBe('https://api.deepl.com/v2/document/id/result?document_key=key');
    expect(Buffer.from(res.document).toString()).toBe('PDF');
    expect(res.characters).toEqual({ billed: 42 });
  });
});

