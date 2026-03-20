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
});

// ============================================================================
// History handlers
// ============================================================================

describe('handleGetHistory', () => {
  it('returns history entries', async () => {
    const { getHistory } = await import('../../core/history');
    vi.mocked(getHistory).mockResolvedValueOnce([
      { original: 'hello', translated: 'hei', sourceLang: 'en', targetLang: 'fi', timestamp: Date.now() },
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
