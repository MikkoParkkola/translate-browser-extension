/**
 * Tests for shared/index.ts barrel export.
 * Importing from the barrel exercises all re-export paths.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock all downstream dependencies before importing the barrel
vi.mock('../../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../../core/storage', () => ({
  safeStorageGet: vi.fn().mockResolvedValue({}),
  safeStorageSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/corrections', () => ({
  addCorrection: vi.fn(),
  getCorrection: vi.fn(),
  getAllCorrections: vi.fn(),
  clearCorrections: vi.fn(),
  deleteCorrection: vi.fn(),
  getCorrectionStats: vi.fn(),
  exportCorrections: vi.fn(),
  importCorrections: vi.fn(),
}));

vi.mock('../../core/history', () => ({
  addToHistory: vi.fn(),
  getHistory: vi.fn(),
  clearHistory: vi.fn(),
}));

vi.mock('../../config', () => ({
  CONFIG: {
    rateLimits: { windowMs: 60000, requestsPerMinute: 100, tokensPerMinute: 10000 },
    retry: { network: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 } },
    cache: { maxSize: 100, storageKey: 'translationCache', saveDebounceMs: 1000 },
  },
}));

vi.mock('../../core/errors', () => ({
  createTranslationError: vi.fn(),
  validateInput: vi.fn(),
  withRetry: vi.fn(),
  isNetworkError: vi.fn(),
}));

vi.mock('../../core/hash', () => ({
  generateCacheKey: vi.fn(),
}));

describe('shared/index barrel export', () => {
  it('re-exports all expected symbols from storage-ops', async () => {
    const barrel = await import('./index');
    expect(barrel.createTranslationCache).toBeDefined();
  });

  it('re-exports all expected symbols from provider-management', async () => {
    const barrel = await import('./index');
    expect(barrel.getStrategy).toBeDefined();
    expect(barrel.setStrategy).toBeDefined();
    expect(barrel.getProvider).toBeDefined();
    expect(barrel.setProvider).toBeDefined();
    expect(barrel.checkRateLimit).toBeDefined();
    expect(barrel.recordUsage).toBeDefined();
    expect(barrel.estimateTokens).toBeDefined();
    expect(barrel.getRateLimitState).toBeDefined();
    expect(barrel.formatUserError).toBeDefined();
    expect(barrel.CLOUD_PROVIDER_KEYS).toBeDefined();
    expect(barrel.PROVIDER_LIST).toBeDefined();
    expect(barrel.handleSetProvider).toBeDefined();
  });

  it('re-exports all expected symbols from translation-core', async () => {
    const barrel = await import('./index');
    expect(barrel.NETWORK_RETRY_CONFIG).toBeDefined();
    expect(barrel.handleTranslateCore).toBeDefined();
  });

  it('re-exports all expected symbols from message-handlers', async () => {
    const barrel = await import('./index');
    expect(barrel.handleGetCacheStats).toBeDefined();
    expect(barrel.handleClearCache).toBeDefined();
    expect(barrel.handleGetUsage).toBeDefined();
    expect(barrel.handleGetCloudProviderStatus).toBeDefined();
    expect(barrel.handleSetCloudApiKey).toBeDefined();
    expect(barrel.handleClearCloudApiKey).toBeDefined();
    expect(barrel.handleGetHistory).toBeDefined();
    expect(barrel.handleClearHistory).toBeDefined();
    expect(barrel.recordTranslationToHistory).toBeDefined();
    expect(barrel.handleAddCorrection).toBeDefined();
    expect(barrel.handleGetCorrection).toBeDefined();
    expect(barrel.handleGetAllCorrections).toBeDefined();
    expect(barrel.handleGetCorrectionStats).toBeDefined();
    expect(barrel.handleClearCorrections).toBeDefined();
    expect(barrel.handleDeleteCorrection).toBeDefined();
    expect(barrel.handleExportCorrections).toBeDefined();
    expect(barrel.handleImportCorrections).toBeDefined();
    expect(barrel.handleGetSettings).toBeDefined();
    expect(barrel.getActionSettings).toBeDefined();
  });
});
