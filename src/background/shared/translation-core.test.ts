/**
 * Tests for background/shared/translation-core.ts
 *
 * handleTranslateCore is pure — it takes injectable dependencies (cache, translateFn)
 * which makes it straightforward to unit test all branches.
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

vi.mock('../../core/errors', () => ({
  createTranslationError: (err: unknown) => ({
    message: err instanceof Error ? err.message : String(err),
    suggestion: undefined,
    technicalDetails: err instanceof Error ? err.message : String(err),
  }),
  validateInput: vi.fn().mockReturnValue({ valid: true, sanitizedText: 'hello' }),
  withRetry: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  isNetworkError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../core/corrections', () => ({
  getCorrection: vi.fn().mockResolvedValue(null),
}));

vi.mock('./provider-management', () => ({
  getStrategy: vi.fn().mockReturnValue('smart'),
  setStrategy: vi.fn(),
  getProvider: vi.fn().mockReturnValue('opus-mt'),
  checkRateLimit: vi.fn().mockReturnValue(true),
  recordUsage: vi.fn(),
  estimateTokens: vi.fn().mockReturnValue(5),
  formatUserError: vi.fn().mockImplementation((err: { message?: string } | undefined) =>
    err?.message || 'Translation failed'
  ),
}));

vi.mock('../../config', () => ({
  CONFIG: {
    retry: { network: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 } },
    rateLimits: { windowMs: 60000, requestsPerMinute: 100, tokensPerMinute: 10000 },
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeCache(overrides: Record<string, unknown> = {}) {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    getKey: vi.fn().mockReturnValue('cache-key-123'),
    size: 0,
    getStats: vi.fn().mockReturnValue({}),
    clear: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeTranslateFn(result = 'translated text') {
  return vi.fn().mockResolvedValue({ result });
}

// ============================================================================
// Tests
// ============================================================================

describe('handleTranslateCore', () => {
  let cache: ReturnType<typeof makeCache>;
  let translateFn: ReturnType<typeof makeTranslateFn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    cache = makeCache();
    translateFn = makeTranslateFn();

    // Re-apply defaults after clearAllMocks
    const { validateInput, withRetry } = await import('../../core/errors');
    vi.mocked(validateInput).mockReturnValue({ valid: true, sanitizedText: 'hello' });
    vi.mocked(withRetry).mockImplementation(async (fn: () => Promise<unknown>) => fn());

    const { checkRateLimit, getProvider, estimateTokens, formatUserError } = await import('./provider-management');
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(getProvider).mockReturnValue('opus-mt');
    vi.mocked(estimateTokens).mockReturnValue(5);
    vi.mocked(formatUserError).mockImplementation((err: { message?: string } | undefined) => err?.message || 'Translation failed');

    const { getCorrection } = await import('../../core/corrections');
    vi.mocked(getCorrection).mockResolvedValue(null);
  });

  it('returns success with translated result', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(true);
    expect((result as Record<string, unknown>).result).toBe('translated text');
    expect(typeof (result as Record<string, unknown>).duration).toBe('number');
  });

  it('returns error when validation fails', async () => {
    const { validateInput } = await import('../../core/errors');
    vi.mocked(validateInput).mockReturnValue({
      valid: false,
      error: { message: 'Text too short' } as never,
    });

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: '', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(false);
    expect(translateFn).not.toHaveBeenCalled();
  });

  it('returns cached result when cache hit (non-auto source)', async () => {
    cache.get = vi.fn().mockReturnValue({ result: 'cached translation', sourceLang: 'en', targetLang: 'fi' });

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(true);
    expect((result as Record<string, unknown>).result).toBe('cached translation');
    expect(translateFn).not.toHaveBeenCalled();
  });

  it('skips cache check when sourceLang is auto', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: 'hello', sourceLang: 'auto', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    // Cache.get should NOT be called for auto source
    expect(cache.get).not.toHaveBeenCalled();
    expect(translateFn).toHaveBeenCalled();
  });

  it('returns error when rate limit exceeded', async () => {
    const { checkRateLimit } = await import('./provider-management');
    vi.mocked(checkRateLimit).mockReturnValue(false);

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(false);
    expect((result as Record<string, unknown>).error).toContain('Too many requests');
    expect(translateFn).not.toHaveBeenCalled();
  });

  it('uses user correction when available', async () => {
    const { getCorrection } = await import('../../core/corrections');
    vi.mocked(getCorrection).mockResolvedValue('user corrected text');

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(true);
    expect((result as Record<string, unknown>).result).toBe('user corrected text');
    expect(translateFn).not.toHaveBeenCalled(); // Should not call translate when correction exists
  });

  it('skips correction lookup for array text input', async () => {
    const { getCorrection } = await import('../../core/corrections');
    const { validateInput } = await import('../../core/errors');
    vi.mocked(validateInput).mockReturnValue({ valid: true, sanitizedText: ['hello', 'world'] as never });

    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: ['hello', 'world'], sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    // getCorrection only called for string input — array bypasses it
    expect(vi.mocked(getCorrection)).not.toHaveBeenCalled();
    expect(translateFn).toHaveBeenCalled();
  });

  it('sets strategy when provided in options', async () => {
    const { setStrategy } = await import('./provider-management');

    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi', options: { strategy: 'quality' } },
      cache as never,
      translateFn,
    );

    expect(vi.mocked(setStrategy)).toHaveBeenCalledWith('quality');
  });

  it('uses provider from message when specified', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi', provider: 'deepl' },
      cache as never,
      translateFn,
    );

    expect(translateFn).toHaveBeenCalledWith(
      expect.anything(),
      'en',
      'fi',
      'deepl',
      expect.anything()
    );
  });

  it('caches result when translation succeeds with non-auto source', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(cache.set).toHaveBeenCalled();
  });

  it('does not cache when sourceLang is auto', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: 'hello', sourceLang: 'auto', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(cache.set).not.toHaveBeenCalled();
  });

  it('handles translateFn error gracefully', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('Translation service unavailable'));

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      failingFn,
    );

    expect(result.success).toBe(false);
    expect((result as Record<string, unknown>).error).toBeDefined();
  });

  it('logs context debug info when context provided', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    // Should not throw even with context
    await expect(handleTranslateCore(
      {
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'fi',
        options: {
          context: { before: 'Previous sentence.', after: 'Next sentence.', pageContext: 'article' },
        },
      },
      cache as never,
      translateFn,
    )).resolves.toBeDefined();
  });

  it('records usage after successful translation', async () => {
    const { recordUsage } = await import('./provider-management');

    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(vi.mocked(recordUsage)).toHaveBeenCalled();
  });
});
