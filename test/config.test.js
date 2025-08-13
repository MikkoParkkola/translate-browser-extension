describe('config migration', () => {
  beforeEach(() => {
    jest.resetModules();
    delete global.chrome;
  });

  test('migrates flat config to providers', async () => {
    const stored = { apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', provider: 'qwen' };
    const set = jest.fn((o, cb) => cb && cb());
    global.chrome = { storage: { sync: { get: (d, cb) => cb({ ...d, ...stored }), set } } };
    const { qwenLoadConfig } = require('../src/config.js');
    const cfg = await qwenLoadConfig();
    expect(cfg.providers.qwen.apiKey).toBe('k');
    expect(cfg.apiKey).toBe('k');
    expect(set).toHaveBeenCalled();
  });

  test('saves provider specific fields', async () => {
    const set = jest.fn((o, cb) => cb && cb());
    global.chrome = { storage: { sync: { set } } };
    const { qwenSaveConfig } = require('../src/config.js');
    await qwenSaveConfig({ provider: 'google', apiKey: 'g', apiEndpoint: 'https://g/', model: 'gm', providers: {} });
    const saved = set.mock.calls[0][0];
    expect(saved.providers.google.apiKey).toBe('g');
    expect(saved.apiKey).toBe('g');
  });
});
