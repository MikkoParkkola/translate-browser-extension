import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extractErrorMessage: vi.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
  handleSetProvider: vi.fn(),
  handleClearCloudApiKey: vi.fn(),
  handleGetCacheStats: vi.fn(),
  handleGetCloudProviderStatus: vi.fn(),
  handleGetUsage: vi.fn(),
  handleSetCloudApiKey: vi.fn(),
  handleSetCloudProviderEnabled: vi.fn(),
}));

vi.mock('../../core/errors', () => ({
  extractErrorMessage: mocks.extractErrorMessage,
}));

vi.mock('./provider-management', () => ({
  handleSetProvider: mocks.handleSetProvider,
}));

vi.mock('./message-handlers', () => ({
  handleClearCloudApiKey: mocks.handleClearCloudApiKey,
  handleGetCacheStats: mocks.handleGetCacheStats,
  handleGetCloudProviderStatus: mocks.handleGetCloudProviderStatus,
  handleGetUsage: mocks.handleGetUsage,
  handleSetCloudApiKey: mocks.handleSetCloudApiKey,
  handleSetCloudProviderEnabled: mocks.handleSetCloudProviderEnabled,
}));

describe('common-background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates background message guards for configured types', async () => {
    const {
      COMMON_BACKGROUND_MESSAGE_TYPES,
      createBackgroundMessageGuard,
    } = await import('./common-background');

    const guard = createBackgroundMessageGuard(COMMON_BACKGROUND_MESSAGE_TYPES);

    expect(guard({ type: 'ping' } as never)).toBe(true);
    expect(guard({ type: 'getHistory' } as never)).toBe(false);
  });

  it('dispatches common messages through shared and injected handlers', async () => {
    mocks.handleGetUsage.mockReturnValue({
      throttle: { requests: 0, tokens: 0, requestLimit: 100, tokenLimit: 1000 },
      cache: { hits: 0, misses: 0 },
      providers: {},
    });
    mocks.handleSetProvider.mockResolvedValue({ success: true, provider: 'translategemma' });

    const { createCommonBackgroundMessageDispatcher } = await import('./common-background');

    const translationCache = { id: 'cache' } as never;
    const handleTranslate = vi.fn().mockResolvedValue({ success: true, result: 'translated' });
    const handleGetProviders = vi.fn().mockReturnValue({
      providers: ['opus-mt'],
      activeProvider: 'opus-mt',
      strategy: 'smart',
      supportedLanguages: [],
    });
    const handlePreloadModel = vi.fn().mockResolvedValue({
      success: true,
      preloaded: true,
      available: true,
    });
    const handleClearCache = vi.fn().mockResolvedValue({ success: true, clearedEntries: 3 });
    const handleCheckChromeTranslator = vi.fn().mockResolvedValue({ success: true, available: false });
    const handleCheckWebGPU = vi.fn().mockResolvedValue({ success: true, supported: true, fp16: true });
    const handleCheckWebNN = vi.fn().mockResolvedValue({ success: true, supported: false });

    const dispatch = createCommonBackgroundMessageDispatcher({
      translationCache,
      getProvider: () => 'translategemma',
      handleTranslate,
      handleGetProviders,
      handlePreloadModel,
      handleClearCache,
      handleCheckChromeTranslator,
      handleCheckWebGPU,
      handleCheckWebNN,
    });

    await expect(dispatch({ type: 'ping' } as never)).resolves.toEqual({
      success: true,
      status: 'ready',
      provider: 'translategemma',
    });

    await dispatch({ type: 'translate', text: 'hello', sourceLang: 'en', targetLang: 'fi' } as never);
    await dispatch({ type: 'getUsage' } as never);
    await dispatch({ type: 'getProviders' } as never);
    await dispatch({ type: 'preloadModel', sourceLang: 'en', targetLang: 'fi' } as never);
    await dispatch({ type: 'setProvider', provider: 'translategemma' } as never);
    await dispatch({ type: 'getCacheStats' } as never);
    await dispatch({ type: 'clearCache' } as never);
    await dispatch({ type: 'checkChromeTranslator' } as never);
    await dispatch({ type: 'checkWebGPU' } as never);
    await dispatch({ type: 'checkWebNN' } as never);

    expect(handleTranslate).toHaveBeenCalledWith({
      type: 'translate',
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    });
    expect(mocks.handleGetUsage).toHaveBeenCalledWith(translationCache);
    expect(handleGetProviders).toHaveBeenCalledOnce();
    expect(handlePreloadModel).toHaveBeenCalledWith({
      type: 'preloadModel',
      sourceLang: 'en',
      targetLang: 'fi',
    });
    expect(mocks.handleSetProvider).toHaveBeenCalledWith({
      type: 'setProvider',
      provider: 'translategemma',
    });
    expect(mocks.handleGetCacheStats).toHaveBeenCalledWith(translationCache);
    expect(handleClearCache).toHaveBeenCalledOnce();
    expect(handleCheckChromeTranslator).toHaveBeenCalledOnce();
    expect(handleCheckWebGPU).toHaveBeenCalledOnce();
    expect(handleCheckWebNN).toHaveBeenCalledOnce();
  });

  it('wraps preload handlers with provider resolution and error mapping', async () => {
    const { createPreloadModelHandler } = await import('./common-background');

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const preloadModel = vi.fn().mockResolvedValue({
      success: true,
      preloaded: false,
      available: false,
    });

    const handlePreloadModel = createPreloadModelHandler({
      log,
      getProvider: () => 'chrome-builtin',
      preloadModel,
      logPrefix: ' ',
    });

    await expect(
      handlePreloadModel({
        type: 'preloadModel',
        sourceLang: 'en',
        targetLang: 'fi',
      } as never)
    ).resolves.toEqual({
      success: true,
      preloaded: false,
      available: false,
    });

    expect(preloadModel).toHaveBeenCalledWith({
      type: 'preloadModel',
      sourceLang: 'en',
      targetLang: 'fi',
    }, 'chrome-builtin');
    expect(log.info).toHaveBeenCalledWith(' Preloading chrome-builtin model: en -> fi');
  });

  it('returns the exact preload error shape on failures', async () => {
    const { createPreloadModelHandler } = await import('./common-background');

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const handlePreloadModel = createPreloadModelHandler({
      log,
      getProvider: () => 'opus-mt',
      preloadModel: vi.fn().mockRejectedValue(new Error('Preload failed')),
    });

    await expect(
      handlePreloadModel({
        type: 'preloadModel',
        sourceLang: 'en',
        targetLang: 'fi',
      } as never)
    ).resolves.toEqual({
      success: false,
      error: 'Preload failed',
    });

    expect(log.warn).toHaveBeenCalledWith('Preload failed:', expect.any(Error));
    expect(mocks.extractErrorMessage).toHaveBeenCalledWith(expect.any(Error));
  });

  it('returns capability fallbacks when checks throw', async () => {
    const { createSafeCapabilityHandler } = await import('./common-background');

    const log = {
      debug: vi.fn(),
    };

    const handleCapability = createSafeCapabilityHandler({
      run: vi.fn().mockRejectedValue(new Error('blocked')),
      fallback: { success: true, supported: false },
      log,
      debugMessage: 'Capability check failed:',
    });

    await expect(handleCapability()).resolves.toEqual({
      success: true,
      supported: false,
    });
    expect(log.debug).toHaveBeenCalledWith('Capability check failed:', expect.any(Error));
  });
});
