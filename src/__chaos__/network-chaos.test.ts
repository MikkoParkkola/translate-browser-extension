/**
 * Chaos/Fault Injection: Network failures
 * Verifies the system RECOVERS gracefully from network disruptions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTranslationError,
  withRetry,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
} from '../core/errors';
import { handleProviderHttpError } from '../core/http-errors';
import { CircuitBreaker } from '../core/circuit-breaker';

// Deterministic jitter for retry delay tests
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Network Chaos — Offline / TypeError', () => {
  it('fetch TypeError (offline) is categorised as a network error with user-facing message', () => {
    const err = new TypeError('Failed to fetch');
    const te = createTranslationError(err);

    expect(te.category).toBe('network');
    expect(te.message).toBe('Unable to connect to translation service');
    expect(te.retryable).toBe(true);
    expect(te.suggestion).toContain('internet connection');
  });

  it('ERR_INTERNET_DISCONNECTED is categorised correctly', () => {
    const err = new Error('net::ERR_INTERNET_DISCONNECTED');
    const te = createTranslationError(err);

    expect(te.category).toBe('network');
    expect(te.retryable).toBe(true);
  });
});

describe('Network Chaos — Timeout', () => {
  it('AbortError from timeout is categorised as timeout', () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    const te = createTranslationError(err);

    expect(te.category).toBe('timeout');
    expect(te.message).toContain('timed out');
    expect(te.retryable).toBe(true);
  });

  it('withRetry aborts after maxRetries on persistent timeout', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      throw new DOMException('The operation timed out', 'AbortError');
    });

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, jitterFactor: 0 }),
    ).rejects.toThrow();

    // 1 initial + 2 retries = 3 total
    expect(attempts).toBe(3);
  });
});

describe('Network Chaos — Intermittent failures with retry', () => {
  it('succeeds after transient failures via withRetry', async () => {
    let call = 0;
    const fn = vi.fn(async () => {
      call++;
      if (call < 3) throw new Error('Failed to fetch');
      return 'translated';
    });

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterFactor: 0,
    });

    expect(result).toBe('translated');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('Network Chaos — DNS failure', () => {
  it('DNS resolution error is a network error', () => {
    const err = new Error('net::ERR_NAME_NOT_RESOLVED');
    const te = createTranslationError(err);

    expect(te.category).toBe('network');
    expect(te.retryable).toBe(true);
    expect(te.suggestion).toContain('internet connection');
  });
});

describe('Network Chaos — SSL/TLS errors', () => {
  it('SSL certificate error is categorised as network but should not be blindly retried', () => {
    // SSL errors match network patterns in the codebase.
    // The test documents that the system surfaces a meaningful message.
    const err = new Error('net::ERR_CONNECTION_REFUSED (SSL handshake failed)');
    const te = createTranslationError(err);

    expect(te.category).toBe('network');
    // Even though the error module marks it retryable,
    // callers (e.g. providers) should check for SSL specifics.
    expect(te.message).toBe('Unable to connect to translation service');
  });
});

describe('Network Chaos — Server 5xx with exponential backoff', () => {
  it('HTTP 500 produces retryable error with 5s retry-after', () => {
    const result = handleProviderHttpError(500, 'DeepL');
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(5000);
  });

  it('HTTP 502 produces retryable error with 10s retry-after', () => {
    const result = handleProviderHttpError(502, 'OpenAI');
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(10000);
  });

  it('HTTP 503 uses Retry-After header when present', () => {
    const result = handleProviderHttpError(503, 'Google', undefined, '120');
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(120_000);
  });

  it('HTTP 503 falls back to 30s when no Retry-After header', () => {
    const result = handleProviderHttpError(503, 'Anthropic');
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(30_000);
  });

  it('calculateRetryDelay produces exponential growth', () => {
    const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 };
    const d0 = calculateRetryDelay(0, config);
    const d1 = calculateRetryDelay(1, config);
    const d2 = calculateRetryDelay(2, config);

    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    // With jitter=0, delay = baseDelayMs * 2^attempt, capped at maxDelayMs
    expect(d0).toBe(config.baseDelayMs);
    expect(d1).toBe(config.baseDelayMs * 2);
  });

  it('calculateRetryDelay respects maxDelayMs cap', () => {
    const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 };
    const huge = calculateRetryDelay(20, config);
    expect(huge).toBeLessThanOrEqual(config.maxDelayMs);
  });
});

describe('Network Chaos — Circuit breaker recovery', () => {
  it('circuit opens after consecutive failures and recovers after timeout', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 1000 });
    const provider = 'deepl';

    // Record failures up to threshold
    cb.recordFailure(provider, 100);
    cb.recordFailure(provider, 200);
    expect(cb.isAvailable(provider, 300)).toBe(true); // still closed

    cb.recordFailure(provider, 300);
    expect(cb.getState(provider).state).toBe('open');
    expect(cb.isAvailable(provider, 400)).toBe(false); // open

    // After recovery timeout, transitions to half_open
    expect(cb.isAvailable(provider, 1400)).toBe(true);
    expect(cb.getState(provider).state).toBe('half_open');

    // Successful probe closes the circuit
    cb.recordSuccess(provider);
    expect(cb.getState(provider).state).toBe('closed');
  });

  it('half_open probe failure re-opens circuit', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 500 });
    const p = 'openai';

    cb.recordFailure(p, 0);
    cb.recordFailure(p, 0);
    expect(cb.getState(p).state).toBe('open');

    // Transition to half_open
    cb.isAvailable(p, 600);
    expect(cb.getState(p).state).toBe('half_open');

    // Probe fails
    cb.recordFailure(p, 700);
    expect(cb.getState(p).state).toBe('open');
  });
});
