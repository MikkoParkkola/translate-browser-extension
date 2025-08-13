const {
  registerProvider,
  listProviders,
  setProviderOrder,
  translateWithFallback,
  getProviderOrder,
} = require('../src/providers');
require('../src/providers/qwen');

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

test('falls back to next provider on exhaustion', async () => {
  const err = new Error('quota');
  const p1 = { translate: jest.fn().mockRejectedValue(err), label: 'P1' };
  const p2 = { translate: jest.fn().mockResolvedValue({ text: 'ok' }), label: 'P2' };
  registerProvider('p1', p1);
  registerProvider('p2', p2);
  setProviderOrder(['p1', 'p2']);
  const res = await translateWithFallback({ text: 'hi' });
  expect(res).toEqual({ text: 'ok', provider: 'p2' });
  expect(p1.translate).toHaveBeenCalled();
  expect(p2.translate).toHaveBeenCalled();
  expect(getProviderOrder()[0]).toBe('p2');
});
