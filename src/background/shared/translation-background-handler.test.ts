import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLoggerModuleMock } from '../../test-helpers/module-mocks';

vi.mock('../../core/logger', () => createLoggerModuleMock());

vi.mock('../../config', () => ({
  CONFIG: {
    inFlight: { maxRequests: 4 },
  },
}));

vi.mock('../../core/errors', () => ({
  extractErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  withRetry: vi.fn().mockImplementation(async (operation: () => Promise<unknown>) => operation()),
}));

const prepareTranslationExecution = vi.fn();
const finalizeTranslationExecution = vi.fn();
const createTranslateErrorResponse = vi.fn();

vi.mock('./translation-core', () => ({
  NETWORK_RETRY_CONFIG: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 },
  prepareTranslationExecution,
  finalizeTranslationExecution,
  createTranslateErrorResponse,
}));

function createExecution(overrides: Record<string, unknown> = {}) {
  return {
    startTime: Date.now() - 10,
    text: 'hello',
    provider: 'opus-mt',
    tokenEstimate: 5,
    cacheKey: 'cache-key',
    message: {
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
      ...overrides,
    },
    ...overrides,
  };
}

function createCache() {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getKey: vi.fn().mockReturnValue('dedup-key'),
    set: vi.fn(),
  };
}

function createProfiler() {
  return {
    startSession: vi.fn().mockReturnValue('session-1'),
    startTiming: vi.fn(),
    endTiming: vi.fn(),
    importSessionData: vi.fn(),
    getReport: vi.fn().mockReturnValue({ summary: 'profile' }),
    formatReport: vi.fn().mockReturnValue('formatted profile'),
  };
}

function createHandler() {
  const cache = createCache();
  const profiler = createProfiler();
  const acquireKeepAlive = vi.fn();
  const releaseKeepAlive = vi.fn();
  const recordTranslation = vi.fn().mockResolvedValue(undefined);
  const recordTranslationToHistory = vi.fn();
  const offscreenTransport = {
    send: vi.fn(),
  };
  const runChromeBuiltinTranslation = vi.fn();
  const log = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };

  return {
    cache,
    profiler,
    acquireKeepAlive,
    releaseKeepAlive,
    recordTranslation,
    recordTranslationToHistory,
    offscreenTransport,
    runChromeBuiltinTranslation,
    log,
  };
}

async function flushMicrotasks(count = 5) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe('createTranslationBackgroundHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prepareTranslationExecution.mockResolvedValue({
      kind: 'prepared',
      execution: createExecution(),
    });

    finalizeTranslationExecution.mockImplementation(
      async (execution, cache, result, options = {}) => {
        options.onBeforeCacheStore?.();
        if (result) {
          const cacheSourceLang =
            options.cacheSourceLang === undefined
              ? execution.message.sourceLang === 'auto'
                ? null
                : execution.message.sourceLang
              : options.cacheSourceLang;
          if (cacheSourceLang) {
            cache.set(
              execution.cacheKey,
              result,
              cacheSourceLang,
              execution.message.targetLang
            );
          }
        }
        options.onAfterCacheStore?.();

        let response = {
          success: true,
          result,
          duration: Date.now() - execution.startTime,
          ...options.responsePatch,
        };

        const responsePatch = await options.onSuccess?.({
          execution,
          result,
          duration: response.duration,
          response,
        });

        if (responsePatch) {
          response = { ...response, ...responsePatch };
        }

        return response;
      }
    );

    createTranslateErrorResponse.mockImplementation((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: 1,
    }));
  });

  it('deduplicates in-flight offscreen translations and balances keep-alive', async () => {
    let resolveSend!: (value: { success: boolean; result: string }) => void;
    const deps = createHandler();
    deps.offscreenTransport.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'opus-mt',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const first = handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    });
    const second = handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    });

    await flushMicrotasks();
    expect(deps.offscreenTransport.send).toHaveBeenCalledTimes(1);
    expect(resolveSend).toBeTypeOf('function');

    resolveSend({ success: true, result: 'hei' });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(deps.offscreenTransport.send).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
    expect(deps.acquireKeepAlive).toHaveBeenCalledTimes(1);
    expect(deps.releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('rejects and clears in-flight requests on offscreen reset', async () => {
    let resolveSend!: (value: { success: boolean; result: string }) => void;
    const deps = createHandler();
    deps.offscreenTransport.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'opus-mt',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const pending = handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    });

    await flushMicrotasks();
    expect(deps.offscreenTransport.send).toHaveBeenCalledTimes(1);
    expect(resolveSend).toBeTypeOf('function');

    expect(
      handler.rejectInFlightRequests(new Error('Translation engine reset — please retry'))
    ).toBe(1);

    await expect(pending).rejects.toThrow('Translation engine reset — please retry');

    resolveSend({ success: true, result: 'late result' });
    await Promise.resolve();

    expect(deps.releaseKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('preserves profiling and history side effects for offscreen translations', async () => {
    const deps = createHandler();
    prepareTranslationExecution.mockResolvedValue({
      kind: 'prepared',
      execution: createExecution({
        enableProfiling: true,
        message: {
          text: 'hello',
          sourceLang: 'en',
          targetLang: 'fi',
          enableProfiling: true,
        },
      }),
    });
    deps.offscreenTransport.send.mockResolvedValue({
      success: true,
      result: 'hei',
      profilingData: { imported: true },
    });

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'opus-mt',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const response = await handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
      enableProfiling: true,
    });

    expect(response).toMatchObject({
      success: true,
      result: 'hei',
      profilingReport: { summary: 'profile' },
    });
    expect(deps.profiler.importSessionData).toHaveBeenCalledWith({ imported: true });
    expect(deps.recordTranslation).toHaveBeenCalledWith('fi');
    expect(deps.recordTranslationToHistory).toHaveBeenCalledWith(
      'hello',
      'hei',
      'en',
      'fi'
    );
    expect(deps.log.info).toHaveBeenCalledWith('formatted profile');
  });

  it('routes chrome-builtin translations through the injected adapter', async () => {
    const deps = createHandler();
    prepareTranslationExecution.mockResolvedValue({
      kind: 'prepared',
      execution: createExecution({ provider: 'chrome-builtin' }),
    });
    deps.runChromeBuiltinTranslation.mockResolvedValue('Hei maailma');

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'chrome-builtin',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const response = await handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
    });

    expect(deps.runChromeBuiltinTranslation).toHaveBeenCalledWith(
      'hello',
      'en',
      'fi'
    );
    expect(deps.offscreenTransport.send).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      success: true,
      result: 'Hei maailma',
      provider: 'chrome-builtin',
    });
  });

  it('preserves history and usage side effects for chrome-builtin translations', async () => {
    const deps = createHandler();
    prepareTranslationExecution.mockResolvedValue({
      kind: 'prepared',
      execution: createExecution({ provider: 'chrome-builtin' }),
    });
    deps.runChromeBuiltinTranslation.mockResolvedValue('Hei maailma');

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'chrome-builtin',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const response = await handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
    });

    expect(response).toMatchObject({
      success: true,
      result: 'Hei maailma',
      provider: 'chrome-builtin',
    });
    expect(deps.recordTranslation).toHaveBeenCalledWith('fi');
    expect(deps.recordTranslationToHistory).toHaveBeenCalledWith(
      'hello',
      'Hei maailma',
      'en',
      'fi'
    );
  });

  it('does not cache chrome-builtin translations when the source language is auto', async () => {
    const deps = createHandler();
    prepareTranslationExecution.mockResolvedValue({
      kind: 'prepared',
      execution: createExecution({
        provider: 'chrome-builtin',
        message: {
          text: 'hello',
          sourceLang: 'auto',
          targetLang: 'fi',
        },
      }),
    });
    deps.runChromeBuiltinTranslation.mockResolvedValue('Hei maailma');

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'chrome-builtin',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const response = await handler.handleTranslate({
      text: 'hello',
      sourceLang: 'auto',
      targetLang: 'fi',
      provider: 'chrome-builtin',
    });

    expect(response).toMatchObject({
      success: true,
      result: 'Hei maailma',
      provider: 'chrome-builtin',
    });
    expect(deps.cache.set).not.toHaveBeenCalled();
  });

  it('keeps chrome-builtin profiling timings balanced on success', async () => {
    const deps = createHandler();
    prepareTranslationExecution.mockResolvedValue({
      kind: 'prepared',
      execution: createExecution({
        provider: 'chrome-builtin',
        enableProfiling: true,
      }),
    });
    deps.runChromeBuiltinTranslation.mockResolvedValue('Hei maailma');

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'chrome-builtin',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const response = await handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
      enableProfiling: true,
    });

    expect(response).toMatchObject({
      success: true,
      result: 'Hei maailma',
      provider: 'chrome-builtin',
    });
    expect(deps.profiler.startSession).toHaveBeenCalledTimes(1);
    expect(deps.profiler.startTiming).toHaveBeenNthCalledWith(1, 'session-1', 'total');
    expect(deps.profiler.startTiming).toHaveBeenNthCalledWith(
      2,
      'session-1',
      'chrome_builtin_translate'
    );
    expect(deps.profiler.endTiming).toHaveBeenNthCalledWith(
      1,
      'session-1',
      'chrome_builtin_translate'
    );
    expect(deps.profiler.endTiming).toHaveBeenNthCalledWith(2, 'session-1', 'total');
  });

  it('keeps chrome-builtin profiling timings balanced on failure', async () => {
    const deps = createHandler();
    prepareTranslationExecution.mockResolvedValue({
      kind: 'prepared',
      execution: createExecution({
        provider: 'chrome-builtin',
        enableProfiling: true,
      }),
    });
    deps.runChromeBuiltinTranslation.mockRejectedValue(new Error('Script failed'));

    const { createTranslationBackgroundHandler } = await import('./translation-background-handler');
    const handler = createTranslationBackgroundHandler({
      cache: deps.cache as never,
      getProvider: () => 'chrome-builtin',
      offscreenTransport: deps.offscreenTransport as never,
      profiler: deps.profiler,
      acquireKeepAlive: deps.acquireKeepAlive,
      releaseKeepAlive: deps.releaseKeepAlive,
      recordTranslation: deps.recordTranslation,
      recordTranslationToHistory: deps.recordTranslationToHistory,
      runChromeBuiltinTranslation: deps.runChromeBuiltinTranslation,
      log: deps.log,
      maxInFlightRequests: 4,
    });

    const response = await handler.handleTranslate({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'chrome-builtin',
      enableProfiling: true,
    });

    expect(response).toMatchObject({
      success: false,
      error: 'Script failed',
    });
    expect(deps.profiler.startSession).toHaveBeenCalledTimes(1);
    expect(deps.profiler.startTiming).toHaveBeenNthCalledWith(1, 'session-1', 'total');
    expect(deps.profiler.startTiming).toHaveBeenNthCalledWith(
      2,
      'session-1',
      'chrome_builtin_translate'
    );
    expect(deps.profiler.endTiming).toHaveBeenNthCalledWith(
      1,
      'session-1',
      'chrome_builtin_translate'
    );
    expect(deps.profiler.endTiming).toHaveBeenNthCalledWith(2, 'session-1', 'total');
  });
});
