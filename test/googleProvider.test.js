const { getProvider, listProviders } = require('../src/providers');
require('../src/providers/google');

describe('google provider', () => {
  beforeEach(() => fetch.resetMocks());

  test('registers with providers list', () => {
    const list = listProviders();
    expect(list).toEqual(expect.arrayContaining([{ name: 'google', label: 'Google' }]));
    const prov = getProvider('google');
    expect(prov).toHaveProperty('translate');
    expect(prov).toHaveProperty('translateDocument');
  });

  test('translate returns usage', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ translations: [{ translatedText: 'hola' }], totalCharacters: 5 }),
    });
    const prov = getProvider('google');
    const res = await prov.translate({ apiKey: 'k', projectId: 'p', location: 'l', text: 'hello', source: 'en', target: 'es' });
    expect(res).toEqual({ text: 'hola', usage: { chars: 5 } });
  });

  test('translateDocument returns usage and file', async () => {
    const out = Buffer.from('out').toString('base64');
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ documentTranslation: { byteStreamOutputs: [out] }, totalCharacters: 3 }),
    });
    const prov = getProvider('google');
    const res = await prov.translateDocument({ apiKey: 'k', projectId: 'p', location: 'l', file: new Uint8Array([1,2,3]), mimeType: 'application/pdf', source: 'en', target: 'es' });
    expect(res.usage.chars).toBe(3);
    expect(Buffer.from(res.file).toString()).toBe('out');
  });
});
