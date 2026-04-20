import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateStats } from '../../core/profiler';

function createAggregate(
  partial: Partial<AggregateStats> = {},
): AggregateStats {
  return {
    count: 1,
    min: 10,
    max: 10,
    avg: 10,
    p50: 10,
    p95: 10,
    p99: 10,
    total: 10,
    ...partial,
  };
}

function createDependencies() {
  return {
    getProvider: vi.fn(() => 'opus-mt' as const),
    getStrategy: vi.fn(() => 'smart' as const),
    providerList: [
      { id: 'opus-mt', name: 'OPUS-MT' },
      { id: 'chrome-builtin', name: 'Chrome Built-in' },
    ],
    offscreenTransport: {
      send: vi.fn(),
    },
    profiler: {
      clear: vi.fn(),
      formatAggregates: vi.fn(() => 'formatted local aggregates'),
      getAllAggregates: vi.fn(() => ({
        total: createAggregate({ total: 50, avg: 25, max: 40, count: 2 }),
      })),
    },
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    getActiveTabId: vi.fn(),
    probeChromeTranslator: vi.fn(),
  };
}

describe('createRuntimeInfoHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges local and offscreen profiling aggregates while formatting local aggregates', async () => {
    const deps = createDependencies();
    const localAggregates = deps.profiler.getAllAggregates();
    deps.offscreenTransport.send.mockResolvedValue({
      success: true,
      aggregates: {
        offscreen_processing: createAggregate({ total: 80, avg: 80, max: 80 }),
      },
    });

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleGetProfilingStats()).resolves.toEqual({
      success: true,
      aggregates: {
        ...localAggregates,
        offscreen_processing: createAggregate({ total: 80, avg: 80, max: 80 }),
      },
      formatted: 'formatted local aggregates',
    });
    expect(deps.log.debug).not.toHaveBeenCalled();
  });

  it('treats offscreen profiling failures as non-fatal and logs debug intent', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockRejectedValue(
      new Error('offscreen unavailable'),
    );

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleGetProfilingStats()).resolves.toEqual({
      success: true,
      aggregates: deps.profiler.getAllAggregates(),
      formatted: 'formatted local aggregates',
    });
    expect(deps.log.debug).toHaveBeenCalledWith(
      'Offscreen not available for profiling stats merge',
    );
  });

  it('clears profiling stats and logs success', async () => {
    const deps = createDependencies();

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    expect(handlers.handleClearProfilingStats()).toEqual({ success: true });
    expect(deps.profiler.clear).toHaveBeenCalledTimes(1);
    expect(deps.log.info).toHaveBeenCalledWith('Profiling stats cleared');
  });

  it('returns provider metadata and supported languages from offscreen when available', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({
      success: true,
      languages: [{ src: 'en', tgt: 'fi' }],
    });

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);
    const response = await handlers.handleGetProviders();

    expect(response).toEqual({
      providers: [...deps.providerList],
      activeProvider: 'opus-mt',
      strategy: 'smart',
      supportedLanguages: [{ src: 'en', tgt: 'fi' }],
    });
    expect(response.providers).not.toBe(deps.providerList);
  });

  it('returns the existing provider fallback and user-facing error when supported languages throw', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockRejectedValue(new Error('boom'));

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleGetProviders()).resolves.toEqual({
      providers: [...deps.providerList],
      activeProvider: 'opus-mt',
      strategy: 'smart',
      supportedLanguages: [],
      error: 'Could not load language list. Translation may still work.',
    });
    expect(deps.log.warn).toHaveBeenCalledWith(
      'Error getting providers:',
      expect.any(Error),
    );
  });

  it('returns providers without fallback error when offscreen responds with success false', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({ success: false });

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleGetProviders()).resolves.toEqual({
      providers: [...deps.providerList],
      activeProvider: 'opus-mt',
      strategy: 'smart',
      supportedLanguages: [],
    });
  });

  it('returns unavailable for Chrome Translator when no active tab exists', async () => {
    const deps = createDependencies();
    deps.getActiveTabId.mockResolvedValue(undefined);

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleCheckChromeTranslator()).resolves.toEqual({
      success: true,
      available: false,
    });
    expect(deps.probeChromeTranslator).not.toHaveBeenCalled();
  });

  it('probes Chrome Translator availability through injected main-world dependency', async () => {
    const deps = createDependencies();
    deps.getActiveTabId.mockResolvedValue(42);
    deps.probeChromeTranslator.mockResolvedValue({
      success: true,
      available: true,
    });

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleCheckChromeTranslator()).resolves.toEqual({
      success: true,
      available: true,
    });
    expect(deps.probeChromeTranslator).toHaveBeenCalledWith(42);
  });

  it('reuses safe capability fallback for Chrome Translator failures', async () => {
    const deps = createDependencies();
    deps.getActiveTabId.mockResolvedValue(42);
    deps.probeChromeTranslator.mockRejectedValue(new Error('restricted page'));

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleCheckChromeTranslator()).resolves.toEqual({
      success: true,
      available: false,
    });
    expect(deps.log.debug).toHaveBeenCalledWith(
      'Chrome Translator check failed (restricted page?):',
      expect.any(Error),
    );
  });

  it('reuses safe capability fallback for WebGPU and WebNN failures', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send
      .mockResolvedValueOnce({ success: false, error: 'gpu failed' })
      .mockRejectedValueOnce(new Error('webnn blocked'));

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleCheckWebGPU()).resolves.toEqual({
      success: true,
      supported: false,
      fp16: false,
    });
    await expect(handlers.handleCheckWebNN()).resolves.toEqual({
      success: true,
      supported: false,
    });
    expect(deps.log.debug).toHaveBeenCalledWith(
      'WebGPU check failed:',
      expect.any(Error),
    );
    expect(deps.log.debug).toHaveBeenCalledWith(
      'WebNN check failed:',
      expect.any(Error),
    );
  });

  it('returns offscreen WebGPU and WebNN responses when available', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send
      .mockResolvedValueOnce({ success: true, supported: true, fp16: true })
      .mockResolvedValueOnce({ success: true, supported: true });

    const { createRuntimeInfoHandlers } = await import(
      './runtime-info-handlers'
    );
    const handlers = createRuntimeInfoHandlers(deps);

    await expect(handlers.handleCheckWebGPU()).resolves.toEqual({
      success: true,
      supported: true,
      fp16: true,
    });
    await expect(handlers.handleCheckWebNN()).resolves.toEqual({
      success: true,
      supported: true,
    });
  });
});
