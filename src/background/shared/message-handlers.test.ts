/**
 * Tests for background/shared/message-handlers.ts
 *
 * All exported handler functions are pure (injected dependencies), making
 * them straightforward to unit test without loading the full background script.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../core/storage', () => ({
  safeStorageGet: vi.fn().mockResolvedValue({}),
  safeStorageSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/corrections', () => ({
  addCorrection: vi.fn().mockResolvedValue(undefined),
  getCorrection: vi.fn().mockResolvedValue(null),
  getAllCorrections: vi.fn().mockResolvedValue([]),
  clearCorrections: vi.fn().mockResolvedValue(undefined),
  deleteCorrection: vi.fn().mockResolvedValue(true),
  getCorrectionStats: vi.fn().mockResolvedValue({ total: 0, totalUses: 0, topCorrections: [] }),
  exportCorrections: vi.fn().mockResolvedValue('{}'),
  importCorrections: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../core/history', () => ({
  addToHistory: vi.fn().mockResolvedValue(undefined),
  getHistory: vi.fn().mockResolvedValue([]),
  clearHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./provider-management', () => ({
  getStrategy: vi.fn().mockReturnValue('smart'),
  getProvider: vi.fn().mockReturnValue('opus-mt'),
  getRateLimitState: vi.fn().mockReturnValue({ requests: 0, tokens: 0, windowStart: Date.now() }),
  CLOUD_PROVIDER_KEYS: {
    deepl: 'deepl_api_key',
    openai: 'openai_api_key',
    anthropic: 'anthropic_api_key',
    'google-cloud': 'google_cloud_key',
  },
  PROVIDER_LIST: ['opus-mt', 'deepl', 'openai', 'anthropic', 'google-cloud'],
}));

vi.mock('../../config', () => ({
  CONFIG: {
    rateLimits: { requestsPerMinute: 100, tokensPerMinute: 10000, windowMs: 60000 },
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeCache(overrides: Partial<{
  load: () => Promise<void>;
  clear: () => Promise<void>;
  size: number;
  getStats: () => object;
}> = {}) {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    size: 0,
    getStats: vi.fn().mockReturnValue({ size: 0, hits: 0, misses: 0 }),
    ...overrides,
  };
}

// ============================================================================
// Cache handlers
// ============================================================================

describe('handleGetCacheStats', () => {
  it('loads cache and returns stats', async () => {
    const { handleGetCacheStats } = await import('./message-handlers');
    const cache = makeCache({ size: 5, getStats: () => ({ size: 5, hits: 10, misses: 2 }) });
    const result = await handleGetCacheStats(cache as never) as Record<string, unknown>;

    expect(cache.load).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect((result.cache as Record<string, unknown>).size).toBe(5);
  });
});

describe('handleClearCache', () => {
  it('clears cache and returns cleared entry count', async () => {
    const { handleClearCache } = await import('./message-handlers');
    const cache = makeCache({ size: 42 });
    const result = await handleClearCache(cache as never) as Record<string, unknown>;

    expect(cache.clear).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.clearedEntries).toBe(42);
  });
});

// ============================================================================
// Usage handler
// ============================================================================

describe('handleGetUsage', () => {
  it('returns throttle and cache stats', async () => {
    const { handleGetUsage } = await import('./message-handlers');
    const cache = makeCache({ getStats: () => ({ size: 3 }) });
    const result = handleGetUsage(cache as never) as Record<string, unknown>;

    expect(result).toHaveProperty('throttle');
    expect(result).toHaveProperty('cache');
    const throttle = result.throttle as Record<string, unknown>;
    expect(throttle.requests).toBe(0);
    expect(throttle.tokens).toBe(0);
  });
});

// ============================================================================
// Cloud provider status
// ============================================================================

describe('handleGetCloudProviderStatus', () => {
  beforeEach(async () => {
    const { safeStorageGet } = await import('../../core/storage');
    vi.mocked(safeStorageGet).mockResolvedValue({});
  });

  it('returns false status for all providers when no keys set', async () => {
    const { handleGetCloudProviderStatus } = await import('./message-handlers');
    const result = await handleGetCloudProviderStatus() as Record<string, unknown>;

    expect(result.success).toBe(true);
    const status = result.status as Record<string, boolean>;
    expect(status.deepl).toBe(false);
    expect(status.openai).toBe(false);
  });

  it('returns true status for providers that have keys', async () => {
    const { safeStorageGet } = await import('../../core/storage');
    vi.mocked(safeStorageGet).mockResolvedValueOnce({ deepl_api_key: 'abc123' });

    const { handleGetCloudProviderStatus } = await import('./message-handlers');
    const result = await handleGetCloudProviderStatus() as Record<string, unknown>;

    const status = result.status as Record<string, boolean>;
    expect(status.deepl).toBe(true);
    expect(status.openai).toBe(false);
  });

  it('handles safeStorageGet error gracefully', async () => {
    const { safeStorageGet } = await import('../../core/storage');
    vi.mocked(safeStorageGet).mockRejectedValueOnce(new Error('Storage error'));

    const { handleGetCloudProviderStatus } = await import('./message-handlers');
    const result = await handleGetCloudProviderStatus() as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// Set cloud API key
// ============================================================================

describe('handleSetCloudApiKey', () => {
  it('stores API key for known provider', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'deepl',
      apiKey: 'test-key',
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.provider).toBe('deepl');
  });

  it('returns error for unknown provider', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'unknown-provider',
      apiKey: 'test-key',
    }) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown provider');
  });

  it('stores deepl-specific options', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const { safeStorageSet } = await import('../../core/storage');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'deepl',
      apiKey: 'dk',
      options: { isPro: true, formality: 'formal' },
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(vi.mocked(safeStorageSet)).toHaveBeenCalledWith(
      expect.objectContaining({ deepl_is_pro: true, deepl_formality: 'formal' })
    );
  });

  it('stores openai-specific options', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const { safeStorageSet } = await import('../../core/storage');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'openai',
      apiKey: 'ok',
      options: { model: 'gpt-4o', formality: 'default' },
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(vi.mocked(safeStorageSet)).toHaveBeenCalledWith(
      expect.objectContaining({ openai_model: 'gpt-4o' })
    );
  });

  it('stores anthropic-specific options', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const { safeStorageSet } = await import('../../core/storage');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'anthropic',
      apiKey: 'ak',
      options: { model: 'claude-3-5-sonnet' },
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(vi.mocked(safeStorageSet)).toHaveBeenCalledWith(
      expect.objectContaining({ anthropic_model: 'claude-3-5-sonnet' })
    );
  });

  it('stores deepl key without optional isPro or formality', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const { safeStorageSet } = await import('../../core/storage');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'deepl',
      apiKey: 'test-key',
      options: {},
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    const callArg = vi.mocked(safeStorageSet).mock.lastCall![0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('deepl_is_pro');
    expect(callArg).not.toHaveProperty('deepl_formality');
  });

  it('stores openai key with model but without formality', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const { safeStorageSet } = await import('../../core/storage');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'openai',
      apiKey: 'test-key',
      options: { model: 'gpt-4o' },
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    const callArg = vi.mocked(safeStorageSet).mock.lastCall![0] as Record<string, unknown>;
    expect(callArg).toHaveProperty('openai_model', 'gpt-4o');
    expect(callArg).not.toHaveProperty('openai_formality');
  });

  it('stores anthropic key with formality but without model', async () => {
    const { handleSetCloudApiKey } = await import('./message-handlers');
    const { safeStorageSet } = await import('../../core/storage');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'anthropic',
      apiKey: 'test-key',
      options: { formality: 'formal' },
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    const callArg = vi.mocked(safeStorageSet).mock.lastCall![0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('anthropic_model');
    expect(callArg).toHaveProperty('anthropic_formality', 'formal');
  });
});

// ============================================================================
// Clear cloud API key
// ============================================================================

describe('handleClearCloudApiKey', () => {
  it('removes storage key for known provider', async () => {
    const { handleClearCloudApiKey } = await import('./message-handlers');
    const mockRemove = vi.fn().mockResolvedValue(undefined);

    const result = await handleClearCloudApiKey(
      { type: 'clearCloudApiKey', provider: 'deepl' },
      mockRemove
    ) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith(
      expect.arrayContaining(['deepl_api_key', 'deepl_is_pro', 'deepl_formality'])
    );
  });

  it('removes extra keys for openai', async () => {
    const { handleClearCloudApiKey } = await import('./message-handlers');
    const mockRemove = vi.fn().mockResolvedValue(undefined);

    await handleClearCloudApiKey(
      { type: 'clearCloudApiKey', provider: 'openai' },
      mockRemove
    );

    expect(mockRemove).toHaveBeenCalledWith(
      expect.arrayContaining(['openai_api_key', 'openai_model', 'openai_formality'])
    );
  });

  it('removes extra keys for google-cloud', async () => {
    const { handleClearCloudApiKey } = await import('./message-handlers');
    const mockRemove = vi.fn().mockResolvedValue(undefined);

    await handleClearCloudApiKey(
      { type: 'clearCloudApiKey', provider: 'google-cloud' },
      mockRemove
    );

    expect(mockRemove).toHaveBeenCalledWith(
      expect.arrayContaining(['google_cloud_key', 'google_cloud_chars_used'])
    );
  });

  it('returns error for unknown provider', async () => {
    const { handleClearCloudApiKey } = await import('./message-handlers');
    const mockRemove = vi.fn();

    const result = await handleClearCloudApiKey(
      { type: 'clearCloudApiKey', provider: 'fake' },
      mockRemove
    ) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('removes only base key for provider without extra cleanup rules', async () => {
    const { CLOUD_PROVIDER_KEYS } = await import('./provider-management');
    const keys = CLOUD_PROVIDER_KEYS as Record<string, string>;
    keys['custom-provider'] = 'custom_api_key';

    try {
      const { handleClearCloudApiKey } = await import('./message-handlers');
      const mockRemove = vi.fn().mockResolvedValue(undefined);

      const result = await handleClearCloudApiKey(
        { type: 'clearCloudApiKey', provider: 'custom-provider' },
        mockRemove
      ) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(mockRemove).toHaveBeenCalledWith(['custom_api_key']);
    } finally {
      delete keys['custom-provider'];
    }
  });
});

// ============================================================================
// History handlers
// ============================================================================

describe('handleGetHistory', () => {
  it('returns history entries', async () => {
    const { getHistory } = await import('../../core/history');
    vi.mocked(getHistory).mockResolvedValueOnce([
      { original: 'hello', translated: 'hei', sourceLang: 'en', targetLang: 'fi', timestamp: Date.now() } as any,
    ]);

    const { handleGetHistory } = await import('./message-handlers');
    const result = await handleGetHistory() as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect((result.history as unknown[]).length).toBe(1);
  });

  it('handles error gracefully', async () => {
    const { getHistory } = await import('../../core/history');
    vi.mocked(getHistory).mockRejectedValueOnce(new Error('DB error'));

    const { handleGetHistory } = await import('./message-handlers');
    const result = await handleGetHistory() as Record<string, unknown>;

    expect(result.success).toBe(false);
  });
});

describe('handleClearHistory', () => {
  it('clears history and returns success', async () => {
    const { handleClearHistory } = await import('./message-handlers');
    const result = await handleClearHistory() as Record<string, unknown>;
    expect(result.success).toBe(true);
  });

  it('handles error gracefully', async () => {
    const { clearHistory } = await import('../../core/history');
    vi.mocked(clearHistory).mockRejectedValueOnce(new Error('DB error'));

    const { handleClearHistory } = await import('./message-handlers');
    const result = await handleClearHistory() as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});

describe('recordTranslationToHistory', () => {
  it('calls addToHistory without throwing', async () => {
    const { recordTranslationToHistory } = await import('./message-handlers');
    const { addToHistory } = await import('../../core/history');

    recordTranslationToHistory('hello', 'hei', 'en', 'fi');
    await new Promise((r) => setTimeout(r, 10)); // allow fire-and-forget

    expect(vi.mocked(addToHistory)).toHaveBeenCalledWith('hello', 'hei', 'en', 'fi');
  });
});

// ============================================================================
// Correction handlers
// ============================================================================

describe('handleAddCorrection', () => {
  it('saves correction and returns success', async () => {
    const { handleAddCorrection } = await import('./message-handlers');
    const result = await handleAddCorrection({
      type: 'addCorrection',
      original: 'hello',
      machineTranslation: 'hei',
      userCorrection: 'heippa',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
  });

  it('handles error gracefully', async () => {
    const { addCorrection } = await import('../../core/corrections');
    vi.mocked(addCorrection).mockRejectedValueOnce(new Error('DB error'));

    const { handleAddCorrection } = await import('./message-handlers');
    const result = await handleAddCorrection({
      type: 'addCorrection',
      original: 'hi',
      machineTranslation: 'hei',
      userCorrection: 'moi',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});

describe('handleGetCorrection', () => {
  it('returns null correction when not found', async () => {
    const { handleGetCorrection } = await import('./message-handlers');
    const result = await handleGetCorrection({
      type: 'getCorrection',
      original: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.correction).toBeNull();
    expect(result.hasCorrection).toBe(false);
  });

  it('returns correction when found', async () => {
    const { getCorrection } = await import('../../core/corrections');
    vi.mocked(getCorrection).mockResolvedValueOnce('heippa');

    const { handleGetCorrection } = await import('./message-handlers');
    const result = await handleGetCorrection({
      type: 'getCorrection',
      original: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.hasCorrection).toBe(true);
    expect(result.correction).toBe('heippa');
  });
});

describe('handleGetAllCorrections', () => {
  it('returns all corrections', async () => {
    const { handleGetAllCorrections } = await import('./message-handlers');
    const result = await handleGetAllCorrections() as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(Array.isArray(result.corrections)).toBe(true);
  });
});

describe('handleGetCorrectionStats', () => {
  it('returns stats', async () => {
    const { handleGetCorrectionStats } = await import('./message-handlers');
    const result = await handleGetCorrectionStats() as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.stats).toBeDefined();
  });
});

describe('handleClearCorrections', () => {
  it('clears and returns success', async () => {
    const { handleClearCorrections } = await import('./message-handlers');
    const result = await handleClearCorrections() as Record<string, unknown>;
    expect(result.success).toBe(true);
  });
});

describe('handleDeleteCorrection', () => {
  it('deletes specific correction', async () => {
    const { handleDeleteCorrection } = await import('./message-handlers');
    const result = await handleDeleteCorrection({
      type: 'deleteCorrection',
      original: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
  });
});

describe('handleExportCorrections', () => {
  it('exports corrections as JSON string', async () => {
    const { handleExportCorrections } = await import('./message-handlers');
    const result = await handleExportCorrections() as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(typeof result.json).toBe('string');
  });
});

describe('handleImportCorrections', () => {
  it('imports corrections and returns count', async () => {
    const { importCorrections } = await import('../../core/corrections');
    vi.mocked(importCorrections).mockResolvedValueOnce(3);

    const { handleImportCorrections } = await import('./message-handlers');
    const result = await handleImportCorrections({
      type: 'importCorrections',
      json: '{}',
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3);
  });

  it('handles import error gracefully', async () => {
    const { importCorrections } = await import('../../core/corrections');
    vi.mocked(importCorrections).mockRejectedValueOnce(new Error('Invalid JSON'));

    const { handleImportCorrections } = await import('./message-handlers');
    const result = await handleImportCorrections({
      type: 'importCorrections',
      json: 'not-json',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Settings handler
// ============================================================================

describe('handleGetSettings', () => {
  it('returns default settings when storage is empty', async () => {
    const storageGet = vi.fn().mockResolvedValue({});
    const { handleGetSettings } = await import('./message-handlers');
    const result = await handleGetSettings(storageGet) as Record<string, unknown>;

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.sourceLanguage).toBe('auto');
    expect(data.targetLanguage).toBe('en');
    expect(data.provider).toBe('opus-mt');
    expect(data.strategy).toBe('smart');
  });

  it('returns stored settings', async () => {
    const storageGet = vi.fn().mockResolvedValue({
      sourceLanguage: 'fi',
      targetLanguage: 'de',
      provider: 'deepl',
      strategy: 'quality',
    });
    const { handleGetSettings } = await import('./message-handlers');
    const result = await handleGetSettings(storageGet) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    expect(data.sourceLanguage).toBe('fi');
    expect(data.targetLanguage).toBe('de');
  });

  it('returns error when storage throws', async () => {
    const storageGet = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    const { handleGetSettings } = await import('./message-handlers');
    const result = await handleGetSettings(storageGet) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// getActionSettings
// ============================================================================

describe('getActionSettings', () => {
  it('returns default settings when storage returns empty', async () => {
    const { safeStorageGet } = await import('../../core/storage');
    vi.mocked(safeStorageGet).mockResolvedValueOnce({});

    const { getActionSettings } = await import('./message-handlers');
    const result = await getActionSettings();

    expect(result.sourceLang).toBe('auto');
    expect(result.targetLang).toBe('en');
    expect(result.strategy).toBe('smart');
    expect(result.provider).toBe('opus-mt');
  });

  it('uses stored values when available', async () => {
    const { safeStorageGet } = await import('../../core/storage');
    vi.mocked(safeStorageGet).mockResolvedValueOnce({
      sourceLang: 'fi',
      targetLang: 'sv',
      strategy: 'quality',
      provider: 'deepl',
    });

    const { getActionSettings } = await import('./message-handlers');
    const result = await getActionSettings();

    expect(result.sourceLang).toBe('fi');
    expect(result.targetLang).toBe('sv');
  });
});

// ============================================================================
// Error branch coverage: correction handlers
// ============================================================================

describe('handleGetCorrection error path', () => {
  it('handles error gracefully', async () => {
    const { getCorrection } = await import('../../core/corrections');
    vi.mocked(getCorrection).mockRejectedValueOnce(new Error('DB error'));

    const { handleGetCorrection } = await import('./message-handlers');
    const result = await handleGetCorrection({
      type: 'getCorrection',
      original: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.correction).toBeNull();
    expect(result.hasCorrection).toBe(false);
  });

  it('handles non-Error thrown', async () => {
    const { getCorrection } = await import('../../core/corrections');
    vi.mocked(getCorrection).mockRejectedValueOnce('string error');

    const { handleGetCorrection } = await import('./message-handlers');
    const result = await handleGetCorrection({
      type: 'getCorrection',
      original: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('string error');
  });
});

describe('handleGetAllCorrections error path', () => {
  it('handles error gracefully', async () => {
    const { getAllCorrections } = await import('../../core/corrections');
    vi.mocked(getAllCorrections).mockRejectedValueOnce(new Error('DB error'));

    const { handleGetAllCorrections } = await import('./message-handlers');
    const result = await handleGetAllCorrections() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.corrections).toEqual([]);
  });

  it('handles non-Error thrown', async () => {
    const { getAllCorrections } = await import('../../core/corrections');
    vi.mocked(getAllCorrections).mockRejectedValueOnce(42);

    const { handleGetAllCorrections } = await import('./message-handlers');
    const result = await handleGetAllCorrections() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('42');
  });
});

describe('handleGetCorrectionStats error path', () => {
  it('handles error gracefully', async () => {
    const { getCorrectionStats } = await import('../../core/corrections');
    vi.mocked(getCorrectionStats).mockRejectedValueOnce(new Error('DB error'));

    const { handleGetCorrectionStats } = await import('./message-handlers');
    const result = await handleGetCorrectionStats() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.stats).toEqual({ total: 0, totalUses: 0, topCorrections: [] });
  });

  it('handles non-Error thrown', async () => {
    const { getCorrectionStats } = await import('../../core/corrections');
    vi.mocked(getCorrectionStats).mockRejectedValueOnce('boom');

    const { handleGetCorrectionStats } = await import('./message-handlers');
    const result = await handleGetCorrectionStats() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });
});

describe('handleClearCorrections error path', () => {
  it('handles error gracefully', async () => {
    const { clearCorrections } = await import('../../core/corrections');
    vi.mocked(clearCorrections).mockRejectedValueOnce(new Error('DB error'));

    const { handleClearCorrections } = await import('./message-handlers');
    const result = await handleClearCorrections() as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('handles non-Error thrown', async () => {
    const { clearCorrections } = await import('../../core/corrections');
    vi.mocked(clearCorrections).mockRejectedValueOnce(null);

    const { handleClearCorrections } = await import('./message-handlers');
    const result = await handleClearCorrections() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('null');
  });
});

describe('handleDeleteCorrection error path', () => {
  it('handles error gracefully', async () => {
    const { deleteCorrection } = await import('../../core/corrections');
    vi.mocked(deleteCorrection).mockRejectedValueOnce(new Error('DB error'));

    const { handleDeleteCorrection } = await import('./message-handlers');
    const result = await handleDeleteCorrection({
      type: 'deleteCorrection',
      original: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);
  });

  it('handles non-Error thrown', async () => {
    const { deleteCorrection } = await import('../../core/corrections');
    vi.mocked(deleteCorrection).mockRejectedValueOnce(undefined);

    const { handleDeleteCorrection } = await import('./message-handlers');
    const result = await handleDeleteCorrection({
      type: 'deleteCorrection',
      original: 'hello',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('undefined');
  });
});

describe('handleExportCorrections error path', () => {
  it('handles error gracefully', async () => {
    const { exportCorrections } = await import('../../core/corrections');
    vi.mocked(exportCorrections).mockRejectedValueOnce(new Error('Export failed'));

    const { handleExportCorrections } = await import('./message-handlers');
    const result = await handleExportCorrections() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Export failed');
  });

  it('handles non-Error thrown', async () => {
    const { exportCorrections } = await import('../../core/corrections');
    vi.mocked(exportCorrections).mockRejectedValueOnce(999);

    const { handleExportCorrections } = await import('./message-handlers');
    const result = await handleExportCorrections() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('999');
  });
});

// ============================================================================
// Additional cloud API key error branches
// ============================================================================

describe('handleSetCloudApiKey error path', () => {
  it('handles safeStorageSet failure', async () => {
    const { safeStorageSet } = await import('../../core/storage');
    vi.mocked(safeStorageSet).mockRejectedValueOnce(new Error('Storage full'));

    const { handleSetCloudApiKey } = await import('./message-handlers');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'deepl',
      apiKey: 'test-key',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Storage full');
  });

  it('handles non-Error storage failure', async () => {
    const { safeStorageSet } = await import('../../core/storage');
    vi.mocked(safeStorageSet).mockRejectedValueOnce('quota exceeded');

    const { handleSetCloudApiKey } = await import('./message-handlers');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'openai',
      apiKey: 'test-key',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('quota exceeded');
  });

  it('stores anthropic-specific formality option', async () => {
    const { safeStorageSet } = await import('../../core/storage');
    vi.mocked(safeStorageSet).mockResolvedValueOnce(false);

    const { handleSetCloudApiKey } = await import('./message-handlers');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'anthropic',
      apiKey: 'ak',
      options: { model: 'claude-3-5-sonnet', formality: 'formal' },
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(vi.mocked(safeStorageSet)).toHaveBeenCalledWith(
      expect.objectContaining({ anthropic_formality: 'formal' })
    );
  });

  it('stores openai-specific formality option', async () => {
    const { safeStorageSet } = await import('../../core/storage');
    vi.mocked(safeStorageSet).mockResolvedValueOnce(false);

    const { handleSetCloudApiKey } = await import('./message-handlers');
    const result = await handleSetCloudApiKey({
      type: 'setCloudApiKey',
      provider: 'openai',
      apiKey: 'ok',
      options: { formality: 'informal' },
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(vi.mocked(safeStorageSet)).toHaveBeenCalledWith(
      expect.objectContaining({ openai_formality: 'informal' })
    );
  });
});

describe('handleClearCloudApiKey error path', () => {
  it('handles storageRemove failure', async () => {
    const { handleClearCloudApiKey } = await import('./message-handlers');
    const mockRemove = vi.fn().mockRejectedValue(new Error('Remove failed'));

    const result = await handleClearCloudApiKey(
      { type: 'clearCloudApiKey', provider: 'deepl' },
      mockRemove
    ) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Remove failed');
  });

  it('handles non-Error storageRemove failure', async () => {
    const { handleClearCloudApiKey } = await import('./message-handlers');
    const mockRemove = vi.fn().mockRejectedValue('unknown error');

    const result = await handleClearCloudApiKey(
      { type: 'clearCloudApiKey', provider: 'openai' },
      mockRemove
    ) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('unknown error');
  });

  it('removes extra keys for anthropic', async () => {
    const { handleClearCloudApiKey } = await import('./message-handlers');
    const mockRemove = vi.fn().mockResolvedValue(undefined);

    await handleClearCloudApiKey(
      { type: 'clearCloudApiKey', provider: 'anthropic' },
      mockRemove
    );

    expect(mockRemove).toHaveBeenCalledWith(
      expect.arrayContaining(['anthropic_api_key', 'anthropic_model', 'anthropic_formality', 'anthropic_tokens_used'])
    );
  });
});

// ============================================================================
// Additional: non-Error branches for all handlers  
// ============================================================================

describe('handleGetCloudProviderStatus non-Error path', () => {
  it('handles non-Error thrown', async () => {
    const { safeStorageGet } = await import('../../core/storage');
    vi.mocked(safeStorageGet).mockRejectedValueOnce('storage boom');

    const { handleGetCloudProviderStatus } = await import('./message-handlers');
    const result = await handleGetCloudProviderStatus() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('storage boom');
  });
});

describe('handleGetHistory non-Error path', () => {
  it('handles non-Error thrown', async () => {
    const { getHistory } = await import('../../core/history');
    vi.mocked(getHistory).mockRejectedValueOnce(123);

    const { handleGetHistory } = await import('./message-handlers');
    const result = await handleGetHistory() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('123');
  });
});

describe('handleClearHistory non-Error path', () => {
  it('handles non-Error thrown', async () => {
    const { clearHistory } = await import('../../core/history');
    vi.mocked(clearHistory).mockRejectedValueOnce(false);

    const { handleClearHistory } = await import('./message-handlers');
    const result = await handleClearHistory() as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('false');
  });
});

describe('handleAddCorrection non-Error path', () => {
  it('handles non-Error thrown', async () => {
    const { addCorrection } = await import('../../core/corrections');
    vi.mocked(addCorrection).mockRejectedValueOnce('add failed');

    const { handleAddCorrection } = await import('./message-handlers');
    const result = await handleAddCorrection({
      type: 'addCorrection',
      original: 'hi',
      machineTranslation: 'hei',
      userCorrection: 'moi',
      sourceLang: 'en',
      targetLang: 'fi',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toBe('add failed');
  });
});

describe('handleImportCorrections non-Error path', () => {
  it('handles non-Error thrown', async () => {
    const { importCorrections } = await import('../../core/corrections');
    vi.mocked(importCorrections).mockRejectedValueOnce({ code: 'PARSE_ERROR' });

    const { handleImportCorrections } = await import('./message-handlers');
    const result = await handleImportCorrections({
      type: 'importCorrections',
      json: 'bad json',
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.importedCount).toBe(0);
  });
});

describe('recordTranslationToHistory error suppression', () => {
  it('swallows addToHistory rejection silently', async () => {
    const { addToHistory } = await import('../../core/history');
    vi.mocked(addToHistory).mockRejectedValueOnce(new Error('History DB locked'));

    const { recordTranslationToHistory } = await import('./message-handlers');
    // Should not throw
    expect(() => recordTranslationToHistory('hello', 'hei', 'en', 'fi')).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
