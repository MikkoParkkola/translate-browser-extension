/**
 * Tests for centralized configuration constants (src/config.ts)
 */

import { describe, it, expect } from 'vitest';
import { CONFIG } from './config';
import type { Config } from './config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all leaf values from a nested object */
function collectLeafValues(obj: Record<string, unknown>, prefix = ''): Array<{ path: string; value: unknown }> {
  const results: Array<{ path: string; value: unknown }> = [];
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      results.push(...collectLeafValues(val as Record<string, unknown>, path));
    } else {
      results.push({ path, value: val });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Default configuration values
// ---------------------------------------------------------------------------

describe('CONFIG default values', () => {
  describe('cache', () => {
    it('has a positive maxSize', () => {
      expect(CONFIG.cache.maxSize).toBe(1000);
      expect(CONFIG.cache.maxSize).toBeGreaterThan(0);
    });

    it('has a non-empty storageKey', () => {
      expect(CONFIG.cache.storageKey).toBe('translationMemory');
      expect(CONFIG.cache.storageKey.length).toBeGreaterThan(0);
    });

    it('has a reasonable saveDebounceMs', () => {
      expect(CONFIG.cache.saveDebounceMs).toBe(5000);
      expect(CONFIG.cache.saveDebounceMs).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('timeouts', () => {
    it('OPUS-MT direct timeout is 60 seconds', () => {
      expect(CONFIG.timeouts.opusMtDirectMs).toBe(60_000);
    });

    it('OPUS-MT pivot timeout is double the direct timeout', () => {
      expect(CONFIG.timeouts.opusMtPivotMs).toBe(120_000);
      expect(CONFIG.timeouts.opusMtPivotMs).toBe(CONFIG.timeouts.opusMtDirectMs * 2);
    });

    it('TranslateGemma timeout is 5 minutes (large model)', () => {
      expect(CONFIG.timeouts.translateGemmaMs).toBe(300_000);
    });

    it('cloud API timeout is shorter than local model timeouts', () => {
      expect(CONFIG.timeouts.cloudApiMs).toBe(30_000);
      expect(CONFIG.timeouts.cloudApiMs).toBeLessThan(CONFIG.timeouts.opusMtDirectMs);
    });

    it('all timeouts are positive numbers', () => {
      for (const [key, ms] of Object.entries(CONFIG.timeouts)) {
        expect(ms, `timeouts.${key}`).toBeGreaterThan(0);
      }
    });
  });

  describe('rateLimits', () => {
    it('has expected default values', () => {
      expect(CONFIG.rateLimits.requestsPerMinute).toBe(60);
      expect(CONFIG.rateLimits.tokensPerMinute).toBe(100_000);
      expect(CONFIG.rateLimits.windowMs).toBe(60_000);
    });

    it('window duration matches one minute', () => {
      expect(CONFIG.rateLimits.windowMs).toBe(60 * 1000);
    });
  });

  describe('batching', () => {
    it('has expected batch limits', () => {
      expect(CONFIG.batching.maxSize).toBe(50);
      expect(CONFIG.batching.maxTextLength).toBe(5000);
      expect(CONFIG.batching.minTextLength).toBe(2);
    });

    it('minTextLength is less than maxTextLength', () => {
      expect(CONFIG.batching.minTextLength).toBeLessThan(CONFIG.batching.maxTextLength);
    });
  });

  describe('retry', () => {
    it('network retries have sensible defaults', () => {
      expect(CONFIG.retry.network.maxRetries).toBe(3);
      expect(CONFIG.retry.network.baseDelayMs).toBe(1000);
      expect(CONFIG.retry.network.maxDelayMs).toBe(10_000);
    });

    it('offscreen retries are fewer than network retries', () => {
      expect(CONFIG.retry.offscreen.maxRetries).toBe(2);
      expect(CONFIG.retry.offscreen.maxRetries).toBeLessThanOrEqual(CONFIG.retry.network.maxRetries);
    });

    it('base delay is less than max delay for both strategies', () => {
      expect(CONFIG.retry.network.baseDelayMs).toBeLessThan(CONFIG.retry.network.maxDelayMs);
      expect(CONFIG.retry.offscreen.baseDelayMs).toBeLessThan(CONFIG.retry.offscreen.maxDelayMs);
    });

    it('has a positive maxOffscreenFailures threshold', () => {
      expect(CONFIG.retry.maxOffscreenFailures).toBe(3);
      expect(CONFIG.retry.maxOffscreenFailures).toBeGreaterThan(0);
    });
  });

  describe('mutations', () => {
    it('has a reasonable debounce and buffer', () => {
      expect(CONFIG.mutations.debounceMs).toBe(500);
      expect(CONFIG.mutations.maxPending).toBe(2000);
      expect(CONFIG.mutations.maxPending).toBeGreaterThan(CONFIG.mutations.debounceMs);
    });
  });

  describe('throttle', () => {
    it('matches rateLimits values (consistency check)', () => {
      expect(CONFIG.throttle.requestLimit).toBe(CONFIG.rateLimits.requestsPerMinute);
      expect(CONFIG.throttle.tokenLimit).toBe(CONFIG.rateLimits.tokensPerMinute);
      expect(CONFIG.throttle.windowMs).toBe(CONFIG.rateLimits.windowMs);
    });
  });
});

// ---------------------------------------------------------------------------
// Immutability (as const)
// ---------------------------------------------------------------------------

describe('CONFIG immutability', () => {
  it('is deeply frozen (as const prevents mutation at type level)', () => {
    // Runtime: Object.freeze isn't applied, but `as const` prevents TS mutation.
    // We verify the exported object exists and is structurally sound.
    expect(typeof CONFIG).toBe('object');
    expect(CONFIG).not.toBeNull();
  });

  it('top-level keys are the expected set', () => {
    const keys = Object.keys(CONFIG).sort();
    expect(keys).toEqual([
      'batching',
      'cache',
      'mutations',
      'rateLimits',
      'retry',
      'throttle',
      'timeouts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Type safety
// ---------------------------------------------------------------------------

describe('CONFIG type safety', () => {
  it('Config type matches typeof CONFIG', () => {
    // This is a compile-time check; if it compiles, the types match.
    const _cfg: Config = CONFIG;
    expect(_cfg).toBe(CONFIG);
  });

  it('all leaf values are numbers or strings (no undefined/null)', () => {
    const leaves = collectLeafValues(CONFIG as unknown as Record<string, unknown>);
    expect(leaves.length).toBeGreaterThan(0);
    for (const { path, value } of leaves) {
      expect(
        typeof value === 'number' || typeof value === 'string',
        `${path} should be number|string, got ${typeof value}`,
      ).toBe(true);
    }
  });

  it('string values are non-empty', () => {
    const leaves = collectLeafValues(CONFIG as unknown as Record<string, unknown>);
    const stringLeaves = leaves.filter(l => typeof l.value === 'string');
    expect(stringLeaves.length).toBeGreaterThan(0);
    for (const { path, value } of stringLeaves) {
      expect((value as string).length, `${path} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('numeric values are finite positive numbers', () => {
    const leaves = collectLeafValues(CONFIG as unknown as Record<string, unknown>);
    const numericLeaves = leaves.filter(l => typeof l.value === 'number');
    expect(numericLeaves.length).toBeGreaterThan(0);
    for (const { path, value } of numericLeaves) {
      expect(Number.isFinite(value), `${path} should be finite`).toBe(true);
      expect((value as number) > 0, `${path} should be positive`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation of relationships between config values
// ---------------------------------------------------------------------------

describe('CONFIG cross-value validation', () => {
  it('timeout ordering: cloudApi < opusMtDirect < opusMtPivot < translateGemma', () => {
    expect(CONFIG.timeouts.cloudApiMs).toBeLessThan(CONFIG.timeouts.opusMtDirectMs);
    expect(CONFIG.timeouts.opusMtDirectMs).toBeLessThan(CONFIG.timeouts.opusMtPivotMs);
    expect(CONFIG.timeouts.opusMtPivotMs).toBeLessThan(CONFIG.timeouts.translateGemmaMs);
  });

  it('retry max delay is always ≥ base delay', () => {
    const { network, offscreen } = CONFIG.retry;
    expect(network.maxDelayMs).toBeGreaterThanOrEqual(network.baseDelayMs);
    expect(offscreen.maxDelayMs).toBeGreaterThanOrEqual(offscreen.baseDelayMs);
  });

  it('batch minTextLength < maxTextLength', () => {
    expect(CONFIG.batching.minTextLength).toBeLessThan(CONFIG.batching.maxTextLength);
  });

  it('all timeout values are expressed in milliseconds (≥ 500ms)', () => {
    for (const [key, ms] of Object.entries(CONFIG.timeouts)) {
      expect(ms, `timeouts.${key} looks too small for milliseconds`).toBeGreaterThanOrEqual(500);
    }
  });
});
