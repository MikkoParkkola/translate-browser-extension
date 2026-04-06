import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PredictionStats } from '../../types';
import type { TranslationCache } from './storage-ops';

function createPredictionStats(
  partial: Partial<PredictionStats> = {}
): PredictionStats {
  return {
    domainCount: 2,
    totalTranslations: 12,
    recentTranslations: 3,
    preferredTarget: 'fi',
    topDomains: [{ domain: 'example.com', detections: 4 }],
    ...partial,
  };
}

function createCache(initialSize = 3): TranslationCache {
  const cache = {
    size: initialSize,
    clear: vi.fn(async () => {
      cache.size = 0;
    }),
  };

  return cache as unknown as TranslationCache;
}

function createDependencies() {
  return {
    cache: createCache(),
    offscreenTransport: {
      send: vi.fn(),
    },
    predictionEngine: {
      getStats: vi.fn().mockResolvedValue(createPredictionStats()),
      recordDetection: vi.fn().mockResolvedValue(undefined),
    },
    log: {
      warn: vi.fn(),
    },
  };
}

describe('createDiagnosticsHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the local cache first and then best-effort clears the offscreen cache', async () => {
    const deps = createDependencies();
    const callOrder: string[] = [];

    deps.cache.clear = vi.fn(async () => {
      callOrder.push('local');
    }) as unknown as TranslationCache['clear'];
    deps.offscreenTransport.send.mockImplementation(async () => {
      callOrder.push('offscreen');
      return { success: true };
    });

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(handlers.handleClearCacheWithOffscreen()).resolves.toEqual({
      success: true,
      clearedEntries: 3,
    });
    expect(callOrder).toEqual(['local', 'offscreen']);
    expect(deps.offscreenTransport.send).toHaveBeenCalledWith({ type: 'clearCache' });
  });

  it('preserves clear-cache success when offscreen cache clearing fails', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockRejectedValue(new Error('offscreen unavailable'));

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(handlers.handleClearCacheWithOffscreen()).resolves.toEqual({
      success: true,
      clearedEntries: 3,
    });
    expect(deps.log.warn).toHaveBeenCalledWith(
      'Could not clear offscreen translation cache (may not be running)'
    );
  });

  it('returns prediction stats when the prediction engine succeeds', async () => {
    const deps = createDependencies();
    const stats = createPredictionStats({
      domainCount: 5,
      totalTranslations: 42,
    });
    deps.predictionEngine.getStats.mockResolvedValue(stats);

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(handlers.handleGetPredictionStats()).resolves.toEqual({
      success: true,
      prediction: stats,
    });
  });

  it('returns an extracted error when prediction stats lookup fails', async () => {
    const deps = createDependencies();
    deps.predictionEngine.getStats.mockRejectedValue(new Error('Stats DB error'));

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(handlers.handleGetPredictionStats()).resolves.toEqual({
      success: false,
      error: 'Stats DB error',
    });
    expect(deps.log.warn).toHaveBeenCalledWith(
      'Failed to get prediction stats:',
      expect.any(Error)
    );
  });

  it('records language detection and returns success', async () => {
    const deps = createDependencies();

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(
      handlers.handleRecordLanguageDetection({
        type: 'recordLanguageDetection',
        url: 'https://example.com',
        language: 'fi',
      })
    ).resolves.toEqual({ success: true });
    expect(deps.predictionEngine.recordDetection).toHaveBeenCalledWith(
      'https://example.com',
      'fi'
    );
  });

  it('still returns success when recording language detection fails', async () => {
    const deps = createDependencies();
    deps.predictionEngine.recordDetection.mockRejectedValue(
      new Error('DB write failed')
    );

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(
      handlers.handleRecordLanguageDetection({
        type: 'recordLanguageDetection',
        url: 'https://example.com',
        language: 'fr',
      })
    ).resolves.toEqual({ success: true });
    expect(deps.log.warn).toHaveBeenCalledWith(
      'Failed to record language detection:',
      expect.any(Error)
    );
  });

  it('preserves offscreen cloud usage response semantics', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({
      success: true,
      usage: { tokens: 1000, cost: 0.01, limitReached: false },
    });

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(
      handlers.handleGetCloudProviderUsage({
        type: 'getCloudProviderUsage',
        provider: 'openai',
      })
    ).resolves.toEqual({
      success: true,
      usage: { tokens: 1000, cost: 0.01, limitReached: false },
    });
    expect(deps.offscreenTransport.send).toHaveBeenCalledWith({
      type: 'getCloudProviderUsage',
      provider: 'openai',
    });
  });

  it('returns the offscreen error response unchanged for cloud usage failures', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({
      success: false,
      error: 'Provider not configured',
    });

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(
      handlers.handleGetCloudProviderUsage({
        type: 'getCloudProviderUsage',
        provider: 'deepl',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Provider not configured',
    });
  });

  it('returns an explicit error when cloud provider usage lookup throws', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockRejectedValue(new Error('usage unavailable'));

    const { createDiagnosticsHandlers } = await import('./diagnostics-handlers');
    const handlers = createDiagnosticsHandlers(deps);

    await expect(
      handlers.handleGetCloudProviderUsage({
        type: 'getCloudProviderUsage',
        provider: 'openai',
      })
    ).resolves.toEqual({
      success: false,
      error: 'usage unavailable',
    });
    expect(deps.log.warn).toHaveBeenCalledWith(
      'Failed to get cloud provider usage:',
      expect.any(Error)
    );
  });
});
