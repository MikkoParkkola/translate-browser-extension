/**
 * Error handling utilities unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTranslationError,
  calculateRetryDelay,
  withRetry,
  validateInput,
  isNetworkError,
  isMemoryError,
  isModelError,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
  MAX_TEXT_LENGTH,
  MAX_BATCH_SIZE,
  type RetryConfig,
} from './errors';

describe('createTranslationError', () => {
  describe('error categorization', () => {
    it('categorizes network errors', () => {
      const error = createTranslationError(new Error('fetch failed: ERR_NETWORK'));
      expect(error.category).toBe('network');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Unable to connect to translation service');
      expect(error.suggestion).toContain('internet connection');
    });

    it('categorizes memory errors', () => {
      const error = createTranslationError(new Error('out of memory'));
      expect(error.category).toBe('memory');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Not enough memory to complete translation');
    });

    it('categorizes model errors', () => {
      const error = createTranslationError(new Error('model download failed'));
      expect(error.category).toBe('model');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Translation model failed to load');
    });

    it('categorizes language errors', () => {
      const error = createTranslationError(new Error('unsupported language pair'));
      expect(error.category).toBe('language');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('source to target translation not available');
    });

    it('categorizes timeout errors', () => {
      const error = createTranslationError(new Error('operation timed out'));
      expect(error.category).toBe('timeout');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Translation took too long');
    });

    it('categorizes input errors', () => {
      const error = createTranslationError(new Error('invalid input detected'));
      expect(error.category).toBe('input');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Invalid text for translation');
    });

    it('defaults to internal for unknown errors', () => {
      const error = createTranslationError(new Error('something weird happened'));
      expect(error.category).toBe('internal');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Translation failed unexpectedly');
    });
  });

  describe('error pattern matching', () => {
    it('matches various network error patterns', () => {
      const patterns = [
        'Failed to fetch',
        'net::ERR_CONNECTION_REFUSED',
        'offline',
        'CORS error',
        'Connection refused',
        'ERR_INTERNET_DISCONNECTED',
      ];
      for (const pattern of patterns) {
        expect(createTranslationError(new Error(pattern)).category).toBe('network');
      }
    });

    it('matches various memory error patterns', () => {
      const patterns = [
        'OOM',
        'allocation failed',
        'memory limit exceeded',
        'heap limit reached',
        'RangeError: Maximum call stack',
        'WebAssembly memory',
        'wasm memory exhausted',
      ];
      for (const pattern of patterns) {
        expect(createTranslationError(new Error(pattern)).category).toBe('memory');
      }
    });

    it('matches various model error patterns', () => {
      const patterns = [
        'model load failed',
        'HuggingFace error',
        'pipeline initialization',
        'transformers error',
        'ONNX runtime',
        'wasm load failed',
        'WebGPU not supported',
      ];
      for (const pattern of patterns) {
        expect(createTranslationError(new Error(pattern)).category).toBe('model');
      }
    });
  });

  describe('non-Error input handling', () => {
    it('handles string errors', () => {
      const error = createTranslationError('simple string error');
      expect(error.technicalDetails).toBe('simple string error');
    });

    it('handles null', () => {
      const error = createTranslationError(null);
      expect(error.technicalDetails).toBe('null');
    });

    it('handles undefined', () => {
      const error = createTranslationError(undefined);
      expect(error.technicalDetails).toBe('undefined');
    });

    it('handles objects', () => {
      const error = createTranslationError({ code: 123, message: 'test' });
      // String() is used, not JSON.stringify, so we get [object Object]
      expect(error.technicalDetails).toBe('[object Object]');
    });
  });
});

describe('calculateRetryDelay', () => {
  it('returns base delay for first attempt', () => {
    const delay = calculateRetryDelay(0, {
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      maxRetries: 3,
      jitterFactor: 0,
    });
    expect(delay).toBe(1000);
  });

  it('applies exponential backoff', () => {
    const config: RetryConfig = {
      baseDelayMs: 1000,
      maxDelayMs: 100000,
      maxRetries: 5,
      jitterFactor: 0,
    };

    expect(calculateRetryDelay(0, config)).toBe(1000);
    expect(calculateRetryDelay(1, config)).toBe(2000);
    expect(calculateRetryDelay(2, config)).toBe(4000);
    expect(calculateRetryDelay(3, config)).toBe(8000);
  });

  it('caps at maxDelayMs', () => {
    const config: RetryConfig = {
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      maxRetries: 10,
      jitterFactor: 0,
    };

    expect(calculateRetryDelay(10, config)).toBe(5000);
  });

  it('applies jitter within expected range', () => {
    const config: RetryConfig = {
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      maxRetries: 3,
      jitterFactor: 0.3,
    };

    // Run multiple times to test jitter randomness
    for (let i = 0; i < 10; i++) {
      const delay = calculateRetryDelay(0, config);
      // With 30% jitter, delay should be between 700 and 1300
      expect(delay).toBeGreaterThanOrEqual(700);
      expect(delay).toBeLessThanOrEqual(1300);
    }
  });

  it('uses default config when not provided', () => {
    const delay = calculateRetryDelay(0);
    // Default base is 1000ms, jitter up to 30%
    expect(delay).toBeGreaterThanOrEqual(700);
    expect(delay).toBeLessThanOrEqual(1300);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds eventually', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed again'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network error'));

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 10,
      })
    ).rejects.toThrow('network error');

    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('unsupported language pair'));

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses custom shouldRetry function', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('custom error'));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, { maxRetries: 3 }, shouldRetry)
    ).rejects.toThrow('custom error');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalled();
  });

  it('respects custom retry decision', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('retry this'))
      .mockResolvedValue('success');

    const shouldRetry = vi.fn().mockReturnValue(true);

    const result = await withRetry(
      fn,
      { maxRetries: 3, baseDelayMs: 1 },
      shouldRetry
    );

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('validateInput', () => {
  describe('empty input handling', () => {
    it('rejects null input', () => {
      const result = validateInput(null as unknown as string, 'en', 'fi');
      expect(result.valid).toBe(false);
      expect(result.error?.category).toBe('input');
    });

    it('rejects undefined input', () => {
      const result = validateInput(undefined as unknown as string, 'en', 'fi');
      expect(result.valid).toBe(false);
    });

    it('rejects empty string', () => {
      const result = validateInput('', 'en', 'fi');
      expect(result.valid).toBe(false);
    });

    it('rejects whitespace-only string', () => {
      const result = validateInput('   \n\t  ', 'en', 'fi');
      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('no translatable content');
    });

    it('rejects empty array', () => {
      const result = validateInput([], 'en', 'fi');
      expect(result.valid).toBe(false);
    });
  });

  describe('length limits', () => {
    it('accepts text within length limit', () => {
      const text = 'a'.repeat(1000);
      const result = validateInput(text, 'en', 'fi');
      expect(result.valid).toBe(true);
    });

    it('rejects text exceeding length limit', () => {
      const text = 'a'.repeat(MAX_TEXT_LENGTH + 1);
      const result = validateInput(text, 'en', 'fi');
      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('too long');
    });

    it('accepts batch within size limit', () => {
      const texts = Array(50).fill('test');
      const result = validateInput(texts, 'en', 'fi');
      expect(result.valid).toBe(true);
    });

    it('rejects batch exceeding size limit', () => {
      const texts = Array(MAX_BATCH_SIZE + 1).fill('test');
      const result = validateInput(texts, 'en', 'fi');
      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('Too many texts');
    });

    it('rejects batch with total length exceeding limit', () => {
      const longText = 'a'.repeat(MAX_TEXT_LENGTH);
      const texts = [longText, longText, longText];
      const result = validateInput(texts, 'en', 'fi');
      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('Total text length');
    });
  });

  describe('language validation', () => {
    it('accepts valid 2-letter language codes', () => {
      const result = validateInput('Hello', 'en', 'fi');
      expect(result.valid).toBe(true);
    });

    it('accepts valid 3-letter language codes', () => {
      const result = validateInput('Hello', 'eng', 'fin');
      expect(result.valid).toBe(true);
    });

    it('accepts "auto" as source language', () => {
      const result = validateInput('Hello', 'auto', 'fi');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid source language code', () => {
      const result = validateInput('Hello', 'invalid', 'fi');
      expect(result.valid).toBe(false);
      expect(result.error?.category).toBe('language');
      expect(result.error?.message).toContain('Invalid source');
    });

    it('rejects invalid target language code', () => {
      const result = validateInput('Hello', 'en', 'toolong');
      expect(result.valid).toBe(false);
      expect(result.error?.category).toBe('language');
      expect(result.error?.message).toContain('Invalid target');
    });
  });

  describe('text sanitization', () => {
    it('returns sanitized text', () => {
      const result = validateInput('  Hello  World  ', 'en', 'fi');
      expect(result.valid).toBe(true);
      expect(result.sanitizedText).toBe('Hello World');
    });

    it('removes control characters', () => {
      const result = validateInput('Hello\x00\x01\x02World', 'en', 'fi');
      expect(result.valid).toBe(true);
      expect(result.sanitizedText).toBe('HelloWorld');
    });

    it('preserves newlines', () => {
      const result = validateInput('Hello\nWorld', 'en', 'fi');
      expect(result.valid).toBe(true);
      expect(result.sanitizedText).toBe('Hello\nWorld');
    });

    it('sanitizes array elements', () => {
      const result = validateInput(['  Hello  ', '  World  '], 'en', 'fi');
      expect(result.valid).toBe(true);
      expect(result.sanitizedText).toEqual(['Hello', 'World']);
    });
  });
});

describe('error type checkers', () => {
  describe('isNetworkError', () => {
    it('returns true for network errors', () => {
      expect(isNetworkError(new Error('fetch failed'))).toBe(true);
      expect(isNetworkError(new Error('network timeout'))).toBe(true);
      expect(isNetworkError('ERR_CONNECTION_REFUSED')).toBe(true);
    });

    it('returns false for non-network errors', () => {
      expect(isNetworkError(new Error('model failed'))).toBe(false);
      expect(isNetworkError(new Error('out of memory'))).toBe(false);
    });
  });

  describe('isMemoryError', () => {
    it('returns true for memory errors', () => {
      expect(isMemoryError(new Error('out of memory'))).toBe(true);
      expect(isMemoryError(new Error('heap limit exceeded'))).toBe(true);
    });

    it('returns false for non-memory errors', () => {
      expect(isMemoryError(new Error('network failed'))).toBe(false);
    });
  });

  describe('isModelError', () => {
    it('returns true for model errors', () => {
      expect(isModelError(new Error('model load failed'))).toBe(true);
      expect(isModelError(new Error('ONNX runtime error'))).toBe(true);
    });

    it('returns false for non-model errors', () => {
      expect(isModelError(new Error('network failed'))).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('returns true for retryable errors', () => {
      expect(isRetryableError(new Error('network failed'))).toBe(true);
      expect(isRetryableError(new Error('model load failed'))).toBe(true);
      expect(isRetryableError(new Error('timeout'))).toBe(true);
    });

    it('returns false for non-retryable errors', () => {
      expect(isRetryableError(new Error('unsupported language'))).toBe(false);
      expect(isRetryableError(new Error('invalid input'))).toBe(false);
    });
  });
});

describe('DEFAULT_RETRY_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
    expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.3);
  });
});

describe('MAX_TEXT_LENGTH and MAX_BATCH_SIZE', () => {
  it('exports expected limits', () => {
    expect(MAX_TEXT_LENGTH).toBe(10000);
    expect(MAX_BATCH_SIZE).toBe(100);
  });
});
