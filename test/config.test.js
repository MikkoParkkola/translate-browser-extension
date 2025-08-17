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

  test('does not add qwen-mt-plus fallback by default', async () => {
    const stored = { model: 'qwen-mt-turbo', provider: 'qwen' };
    const set = jest.fn((o, cb) => cb && cb());
    global.chrome = { storage: { sync: { get: (d, cb) => cb({ ...d, ...stored }), set } } };
    const { qwenLoadConfig } = require('../src/config.js');
    const cfg = await qwenLoadConfig();
    expect(cfg.models).toEqual(['qwen-mt-turbo']);
    expect(cfg.secondaryModel).toBe('');
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

  test('defaults charLimit for google and deepl', async () => {
    const set = jest.fn((o, cb) => cb && cb());
    global.chrome = { storage: { sync: { get: (d, cb) => cb(d), set } } };
    const { qwenLoadConfig } = require('../src/config.js');
    const cfg = await qwenLoadConfig();
    expect(cfg.providers.google.charLimit).toBe(500000);
    expect(cfg.providers.deepl.charLimit).toBe(500000);
  });

  test('selection popup disabled by default', async () => {
    const set = jest.fn((o, cb) => cb && cb());
    global.chrome = { storage: { sync: { get: (d, cb) => cb(d), set } } };
    const { qwenLoadConfig } = require('../src/config.js');
    const cfg = await qwenLoadConfig();
    expect(cfg.selectionPopup).toBe(false);
  });
});
