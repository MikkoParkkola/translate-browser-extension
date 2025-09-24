const PROVIDER_KEY = 'provider:openai';

describe('providerStore persistence', () => {
  let providerStore;
  let secureData;
  let storageData;
  let asyncChromeMock;

  const loadModule = () => {
    jest.resetModules();
    secureData = {};
    storageData = {};

    asyncChromeMock = {
      storage: {
        sync: {
          get: jest.fn(async defaults => ({ ...(defaults || {}), ...(storageData || {}) })),
          set: jest.fn(async values => {
            storageData = { ...(storageData || {}), ...(values || {}) };
          }),
        },
      },
    };

    global.qwenSecureStorage = {
      getSecure: jest.fn(async key => secureData[key] || ''),
      setSecure: jest.fn(async (key, value) => {
        secureData[key] = value;
      }),
    };

    global.qwenAsyncChrome = asyncChromeMock;

    global.chrome = {
      storage: {
        sync: {
          get: (defaults, cb) => cb && cb({ ...(defaults || {}), ...(storageData || {}) }),
          set: (values, cb) => {
            storageData = { ...(storageData || {}), ...(values || {}) };
            cb && cb();
          },
        },
      },
    };

    providerStore = require('../src/lib/providerStore');
  };

  afterEach(() => {
    delete global.qwenSecureStorage;
    delete global.qwenAsyncChrome;
    delete global.chrome;
    jest.resetModules();
  });

  test('loadConfig returns defaults when storage empty', async () => {
    loadModule();
    const cfg = await providerStore.loadConfig();
    expect(cfg).toEqual(expect.objectContaining({ provider: 'qwen', providers: {}, endpoints: {} }));
    expect(asyncChromeMock.storage.sync.get).toHaveBeenCalled();
  });

  test('saveConfig separates secrets and normalizes provider order', async () => {
    loadModule();
    await providerStore.saveConfig({
      provider: 'openai',
      providerOrder: ['openai', 'qwen', 'openai'],
      providers: {
        openai: { apiKey: 'sk-test', model: 'gpt-4', apiEndpoint: 'https://api.openai.com' },
        qwen: { apiKey: 'dashscope', model: 'qwen-max', apiEndpoint: 'https://dashscope-intl.aliyuncs.com' },
      },
    });

    // secure storage invoked for each provider
    expect(global.qwenSecureStorage.setSecure).toHaveBeenCalledWith(PROVIDER_KEY, 'sk-test');
    expect(global.qwenSecureStorage.setSecure).toHaveBeenCalledWith('provider:qwen', 'dashscope');

    // Stored config should have secrets stripped
    expect(storageData.providers.openai.apiKey).toBe('');
    expect(storageData.providers.qwen.apiKey).toBe('');
    expect(storageData.endpoints).toEqual(expect.objectContaining({
      openai: 'https://api.openai.com',
      qwen: 'https://dashscope-intl.aliyuncs.com',
    }));

    // Loading with secrets should rehydrate from secure storage and normalize order
    const hydrated = await providerStore.loadConfig({ includeSecrets: true, force: true });
    expect(hydrated.providers.openai.apiKey).toBe('sk-test');
    expect(hydrated.provider).toBe('openai');
    expect(hydrated.providerOrder).toEqual(['openai', 'qwen']);
    expect(hydrated.endpoints).toEqual(expect.objectContaining({
      openai: 'https://api.openai.com',
      qwen: 'https://dashscope-intl.aliyuncs.com',
    }));
  });

  test('loadConfig with includeSecrets=false strips apiKeys', async () => {
    loadModule();
    storageData = {
      provider: 'openai',
      providers: {
        openai: { apiKey: 'should-strip', model: 'gpt-4' },
      },
    };

    const cfg = await providerStore.loadConfig({ includeSecrets: false, force: true });
    expect(cfg.providers.openai.apiKey).toBeUndefined();
  });

  test('fallback storage used when secure storage unavailable', async () => {
    loadModule();
    global.qwenSecureStorage.setSecure.mockRejectedValueOnce(new Error('boom'));
    await providerStore.saveConfig({
      providers: {
        openai: { apiKey: 'sk-alt', model: 'gpt-mini' },
      },
    });

    // setSecure failure should still persist in chrome storage
    expect(storageData.providers.openai.apiKey).toBe('sk-alt');

    // getProviderSecret should read fallback value
    const secret = await providerStore.getProviderSecret('openai');
    expect(secret).toBe('sk-alt');
  });
});
