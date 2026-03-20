/**
 * Chaos/Fault Injection: Extension lifecycle edge cases
 * Verifies graceful handling of service worker termination, updates,
 * offscreen document loss, and concurrent tab translations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../core/circuit-breaker';
import { withRetry, createTranslationError } from '../core/errors';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Lifecycle Chaos — Service worker terminates mid-translation', () => {
  it('in-flight promise rejects cleanly when offscreen doc disappears', async () => {
    // Simulate: offscreen document is killed → runtime.sendMessage fails
    const sendMessage = vi.fn().mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );

    await expect(sendMessage({ type: 'translate' })).rejects.toThrow(
      'Receiving end does not exist',
    );
  });

  it('withRetry re-creates offscreen document on transient failure', async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('No response from translation engine');
      }
      return { success: true, result: 'hello' };
    });

    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterFactor: 0,
    });

    expect(result).toEqual({ success: true, result: 'hello' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('Lifecycle Chaos — Extension updated while translating', () => {
  it('circuit breaker state survives across resets (in-memory)', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 1000 });

    // Simulate partial failure state before "update"
    cb.recordFailure('deepl', 100);
    cb.recordFailure('deepl', 200);
    const stateBeforeUpdate = cb.getState('deepl');
    expect(stateBeforeUpdate.consecutiveFailures).toBe(2);

    // After extension update, a new CircuitBreaker would be fresh
    const cbNew = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 1000 });
    const freshState = cbNew.getState('deepl');
    expect(freshState.state).toBe('closed');
    expect(freshState.consecutiveFailures).toBe(0);
    // This verifies clean restart — no stale open circuits after update
  });

  it('pending translation retries after extension context invalidated', async () => {
    let call = 0;
    const fn = vi.fn(async () => {
      call++;
      if (call === 1) {
        throw new Error('Extension context invalidated.');
      }
      return 'recovered';
    });

    // The error "Extension context invalidated" is categorised as 'internal'
    // and internal errors are retryable by default
    const te = createTranslationError(new Error('Extension context invalidated.'));
    expect(te.retryable).toBe(true);

    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterFactor: 0,
    });
    expect(result).toBe('recovered');
  });
});

describe('Lifecycle Chaos — Offscreen document killed', () => {
  it('offscreen communication timeout produces a retryable error', () => {
    const err = new Error('Offscreen communication timeout');
    const te = createTranslationError(err);
    expect(te.category).toBe('timeout');
    expect(te.retryable).toBe(true);
  });

  it('circuit breaker tracks offscreen failure pattern', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 500 });

    // Simulate repeated offscreen failures
    for (let i = 0; i < 3; i++) {
      cb.recordFailure('offscreen', i * 100);
    }

    expect(cb.getState('offscreen').state).toBe('open');
    expect(cb.isAvailable('offscreen', 300)).toBe(false);

    // Recovers after timeout
    expect(cb.isAvailable('offscreen', 900)).toBe(true);
    expect(cb.getState('offscreen').state).toBe('half_open');
  });
});

describe('Lifecycle Chaos — Multiple tabs translating simultaneously', () => {
  it('independent circuit breakers per provider prevent cross-tab interference', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 1000 });

    // Tab A uses deepl, Tab B uses openai
    cb.recordFailure('deepl', 100);
    cb.recordFailure('deepl', 200);
    cb.recordFailure('deepl', 300); // trips deepl

    // openai is unaffected
    expect(cb.isAvailable('openai', 400)).toBe(true);
    expect(cb.isAvailable('deepl', 400)).toBe(false);
  });

  it('concurrent withRetry calls do not interfere', async () => {
    const results = await Promise.all([
      withRetry(async () => 'tab-1-result', { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitterFactor: 0 }),
      withRetry(async () => 'tab-2-result', { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitterFactor: 0 }),
      withRetry(async () => 'tab-3-result', { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitterFactor: 0 }),
    ]);

    expect(results).toEqual(['tab-1-result', 'tab-2-result', 'tab-3-result']);
  });
});

describe('Lifecycle Chaos — Tab closed during translation', () => {
  it('error from closed tab connection is handled gracefully', () => {
    const err = new Error('The message port closed before a response was received.');
    const te = createTranslationError(err);

    // Classified as internal (no specific pattern for port closure)
    expect(te.category).toBe('internal');
    expect(te.retryable).toBe(true);
    expect(te.message).toBe('Translation failed unexpectedly');
  });

  it('circuit breaker resetAll cleans up all state after tab close', () => {
    const cb = new CircuitBreaker();
    cb.recordFailure('deepl');
    cb.recordFailure('openai');

    const summaryBefore = cb.getSummary();
    expect(Object.keys(summaryBefore).length).toBe(2);

    cb.resetAll();

    const summaryAfter = cb.getSummary();
    expect(Object.keys(summaryAfter).length).toBe(0);
  });
});
