describe('providers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('listProviders returns name and label', () => {
    const { registerProvider, listProviders } = require('../src/providers');
    require('../src/providers/qwen');
    const mock = { translate: jest.fn(), label: 'Mock Provider' };
    registerProvider('mock', mock);
    const list = listProviders();
    expect(list).toEqual(
      expect.arrayContaining([
        { name: 'qwen', label: 'Qwen' },
        { name: 'mock', label: 'Mock Provider' },
      ])
    );
  });

  test('qwen provider exposes quota', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ requests: 5, tokens: 10 }),
    });
    const { getProvider } = require('../src/providers');
    require('../src/providers/qwen');
    const prov = getProvider('qwen');
    const res = await prov.quota({ endpoint: 'https://api/', apiKey: 'k' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api/quota',
      expect.objectContaining({ method: 'GET' })
    );
    expect(res).toEqual({ requests: 5, tokens: 10 });
    global.fetch = origFetch;
  });
});

