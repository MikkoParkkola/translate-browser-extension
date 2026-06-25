/**
 * Tests for background/shared/translation-core.ts
 *
 * handleTranslateCore is pure — it takes injectable dependencies (cache, translateFn)
 * which makes it straightforward to unit test all branches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoggerModuleMock } from '../../test-helpers/module-mocks';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../core/logger', () => createLoggerModuleMock());

vi.mock('../../core/errors', () => ({
  createTranslationError: (err: unknown) => ({
    message: err instanceof Error ? err.message : String(err),
    suggestion: undefined,
    technicalDetails: err instanceof Error ? err.message : String(err),
  }),
  validateInput: vi
    .fn()
    .mockReturnValue({ valid: true, sanitizedText: 'hello' }),
  withRetry: vi
    .fn()
    .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
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
  formatUserError: vi
    .fn()
    .mockImplementation(
      (err: { message?: string } | undefined) =>
        err?.message || 'Translation failed',
    ),
}));

vi.mock('../../config', () => ({
  CONFIG: {
    retry: { network: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 } },
    rateLimits: {
      windowMs: 60000,
      requestsPerMinute: 100,
      tokensPerMinute: 10000,
    },
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeCache(overrides: Record<string, unknown> = {}) {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockReturnValue(null),
    recordMiss: vi.fn(),
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
    vi.mocked(validateInput).mockReturnValue({
      valid: true,
      sanitizedText: 'hello',
    });
    vi.mocked(withRetry).mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    const { checkRateLimit, getProvider, estimateTokens, formatUserError } =
      await import('./provider-management');
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(getProvider).mockReturnValue('opus-mt');
    vi.mocked(estimateTokens).mockReturnValue(5);
    vi.mocked(formatUserError).mockImplementation(
      (err: { message?: string } | undefined) =>
        err?.message || 'Translation failed',
    );

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
    expect((result as unknown as Record<string, unknown>).result).toBe(
      'translated text',
    );
    expect(typeof (result as unknown as Record<string, unknown>).duration).toBe(
      'number',
    );
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

  it('returns original text immediately when source and target languages match', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'en' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(true);
    expect((result as unknown as Record<string, unknown>).result).toBe('hello');
    expect(cache.get).not.toHaveBeenCalled();
    expect(translateFn).not.toHaveBeenCalled();
  });

  it('returns original batch immediately when source and target languages match', async () => {
    const { validateInput } = await import('../../core/errors');
    vi.mocked(validateInput).mockReturnValue({
      valid: true,
      sanitizedText: ['hello', 'world'] as never,
    });

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: ['hello', 'world'], sourceLang: 'en', targetLang: 'en' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(true);
    expect((result as unknown as Record<string, unknown>).result).toEqual([
      'hello',
      'world',
    ]);
    expect(cache.get).not.toHaveBeenCalled();
    expect(translateFn).not.toHaveBeenCalled();
  });

  it('returns cached result when cache hit (non-auto source)', async () => {
    cache.get = vi.fn().mockReturnValue({
      result: 'cached translation',
      sourceLang: 'en',
      targetLang: 'fi',
    });

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(true);
    expect((result as unknown as Record<string, unknown>).result).toBe(
      'cached translation',
    );
    expect((result as unknown as Record<string, unknown>).cached).toBe(true);
    expect(translateFn).not.toHaveBeenCalled();
  });

  it('bypasses text-only background cache for contextual TranslateGemma requests', async () => {
    cache.get = vi.fn().mockReturnValue({
      result: 'cached translation without context',
      sourceLang: 'en',
      targetLang: 'fi',
    });

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      {
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'translategemma',
        options: {
          context: {
            before: 'Context before',
            after: 'Context after',
            pageContext: 'Context page',
          },
        },
      },
      cache as never,
      translateFn,
    );

    expect(result.success).toBe(true);
    expect((result as unknown as Record<string, unknown>).result).toBe(
      'translated text',
    );
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(translateFn).toHaveBeenCalledWith(
      'hello',
      'en',
      'fi',
      'translategemma',
      expect.objectContaining({
        context: {
          before: 'Context before',
          after: 'Context after',
          pageContext: 'Context page',
        },
      }),
    );
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
    expect(cache.recordMiss).toHaveBeenCalledTimes(1);
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
    expect((result as unknown as Record<string, unknown>).error).toContain(
      'Too many requests',
    );
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
    expect((result as unknown as Record<string, unknown>).result).toBe(
      'user corrected text',
    );
    expect((result as unknown as Record<string, unknown>).fromCorrection).toBe(
      true,
    );
    expect(translateFn).not.toHaveBeenCalled(); // Should not call translate when correction exists
  });

  it('skips correction lookup for array text input', async () => {
    const { getCorrection } = await import('../../core/corrections');
    const { validateInput } = await import('../../core/errors');
    vi.mocked(validateInput).mockReturnValue({
      valid: true,
      sanitizedText: ['hello', 'world'] as never,
    });
    const batchTranslateFn = vi
      .fn()
      .mockResolvedValue({ result: ['hei', 'maailma'] });

    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: ['hello', 'world'], sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      batchTranslateFn,
    );

    // getCorrection only called for string input — array bypasses it
    expect(vi.mocked(getCorrection)).not.toHaveBeenCalled();
    expect(batchTranslateFn).toHaveBeenCalled();
  });

  it('sets strategy when provided in options', async () => {
    const { setStrategy } = await import('./provider-management');

    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      {
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'fi',
        options: { strategy: 'quality' },
      },
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
      expect.anything(),
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

  it('returns an error and skips caching for invalid batch result arity', async () => {
    const { validateInput } = await import('../../core/errors');
    const { recordUsage } = await import('./provider-management');
    vi.mocked(validateInput).mockReturnValue({
      valid: true,
      sanitizedText: ['hello', 'world'] as never,
    });

    const batchTranslateFn = vi.fn().mockResolvedValue({ result: ['Hei'] });

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: ['hello', 'world'], sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      batchTranslateFn,
    );

    expect(result.success).toBe(false);
    expect(cache.set).not.toHaveBeenCalled();
    expect(vi.mocked(recordUsage)).not.toHaveBeenCalled();
  });

  it('handles translateFn error gracefully', async () => {
    const failingFn = vi
      .fn()
      .mockRejectedValue(new Error('Translation service unavailable'));

    const { handleTranslateCore } = await import('./translation-core');
    const result = await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      failingFn,
    );

    expect(result.success).toBe(false);
    expect((result as unknown as Record<string, unknown>).error).toBeDefined();
  });

  it('logs context debug info when context provided', async () => {
    const { handleTranslateCore } = await import('./translation-core');
    // Should not throw even with context
    await expect(
      handleTranslateCore(
        {
          text: 'hello',
          sourceLang: 'en',
          targetLang: 'fi',
          options: {
            context: {
              before: 'Previous sentence.',
              after: 'Next sentence.',
              pageContext: 'article',
            },
          },
        },
        cache as never,
        translateFn,
      ),
    ).resolves.toBeDefined();
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

  it('calls the retry predicate via withRetry', async () => {
    const { withRetry, isNetworkError } = await import('../../core/errors');

    // Capture the retry predicate
    let capturedPredicate: ((error: unknown) => boolean) | null = null;
    vi.mocked(withRetry).mockImplementation((async (
      fn: () => Promise<unknown>,
      _config: unknown,
      predicate?: (error: unknown) => boolean,
    ) => {
      capturedPredicate = predicate || null;
      return fn();
    }) as any);
    vi.mocked(isNetworkError).mockReturnValue(true);

    const { handleTranslateCore } = await import('./translation-core');
    await handleTranslateCore(
      { text: 'hello', sourceLang: 'en', targetLang: 'fi' },
      cache as never,
      translateFn,
    );

    // Verify the retry predicate was captured
    expect(capturedPredicate).not.toBeNull();

    // Call the predicate to cover line 179
    const result = capturedPredicate!({ technicalDetails: 'network timeout' });
    expect(result).toBe(true);
    expect(vi.mocked(isNetworkError)).toHaveBeenCalledWith('network timeout');
  });
});

// ============================================================================
// MIK-3470 — auto-detect cache-key behavior for the chrome-builtin path
// ============================================================================
//
// AC.3 (CACHE.3): Existing cache behavior is preserved — the implementation does
// NOT write a source-language-keyed cache entry for an auto-detected request
// UNLESS it explicitly stores the validated detected language as the source key.
// CHECK: a unit test asserts cache-key derivation for an `auto` request either
// omits the source-language segment or uses the validated detected language.
describe('MIK-3470: finalizeTranslationExecution auto-detect cache key', () => {
  function makeExecution(sourceLang: string, cacheKey = 'chrome-builtin:auto-en:abc') {
    return {
      startTime: Date.now(),
      message: { text: 'Hallo', sourceLang, targetLang: 'en' },
      text: 'Hallo',
      provider: 'chrome-builtin',
      cacheKey,
      tokenEstimate: 3,
    };
  }

  it('omits the auto source-language cache entry when cacheSourceLang is null for an auto request', async () => {
    const { finalizeTranslationExecution } = await import('./translation-core');
    const cache = makeCache();

    const response = await finalizeTranslationExecution(
      makeExecution('auto') as never,
      cache as never,
      'Hello',
      {
        recordUsage: false,
        // chrome-builtin auto path passes null because the validated detected
        // language is resolved in the page's MAIN world and never returned to
        // the worker, so no concrete source-language key can be stored.
        cacheSourceLang: null,
        responsePatch: { provider: 'chrome-builtin' },
      },
    );

    expect(response.success).toBe(true);
    // No source-language-keyed cache entry is written for the auto request.
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('writes a cache entry keyed by the validated detected language when cacheSourceLang is provided for an auto request', async () => {
    const { finalizeTranslationExecution } = await import('./translation-core');
    const cache = makeCache();

    await finalizeTranslationExecution(
      makeExecution('auto') as never,
      cache as never,
      'Hello',
      {
        recordUsage: false,
        // If a validated detected language were available, it would be stored
        // as the concrete source key — never the literal 'auto'.
        cacheSourceLang: 'de',
        responsePatch: { provider: 'chrome-builtin' },
      },
    );

    expect(cache.set).toHaveBeenCalledTimes(1);
    const [, , storedSourceLang] = vi.mocked(cache.set).mock.calls[0];
    expect(storedSourceLang).toBe('de');
    expect(storedSourceLang).not.toBe('auto');
  });

  it('writes a source-keyed cache entry for a concrete (non-auto) source language', async () => {
    const { finalizeTranslationExecution } = await import('./translation-core');
    const cache = makeCache();

    await finalizeTranslationExecution(
      makeExecution('de', 'chrome-builtin:de-en:abc') as never,
      cache as never,
      'Hello',
      { recordUsage: false, responsePatch: { provider: 'chrome-builtin' } },
    );

    expect(cache.set).toHaveBeenCalledTimes(1);
    const [, , storedSourceLang] = vi.mocked(cache.set).mock.calls[0];
    expect(storedSourceLang).toBe('de');
  });
});
