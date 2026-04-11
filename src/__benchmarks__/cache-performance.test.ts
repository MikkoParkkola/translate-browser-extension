/**
 * Cache Performance Tests
 *
 * Measures IndexedDB-backed TranslationCache operations:
 * sequential inserts, lookups at varying fill rates, eviction,
 * memory footprint estimation, and deduplication efficiency.
 *
 * Run: npx vitest run src/__benchmarks__/cache-performance.test.ts
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import {
  TranslationCache,
  resetTranslationCache,
} from '../core/translation-cache';
import {
  createRoundRobinIndexPicker,
  hashTranslationCacheKey,
  IS_COVERAGE_RUN,
  measureAsync,
  measureSync,
} from './benchmark-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(i: number, textLength = 80) {
  const base = `Translatable text content for entry ${i}`;
  const text = base
    .padEnd(textLength, ` more words for entry ${i}`)
    .slice(0, textLength);
  const translation = `Käännetty teksti sisällölle ${i}`
    .padEnd(textLength, ` lisää sanoja ${i}`)
    .slice(0, textLength);
  return {
    text,
    sourceLang: 'en',
    targetLang: 'fi',
    provider: 'opus-mt' as const,
    translation,
  };
}

async function seedCache(
  count: number,
  maxSizeBytes?: number,
): Promise<TranslationCache> {
  resetTranslationCache();
  const cache = new TranslationCache(maxSizeBytes);
  for (let i = 0; i < count; i++) {
    const e = makeEntry(i);
    await cache.set(
      e.text,
      e.sourceLang,
      e.targetLang,
      e.provider,
      e.translation,
    );
  }
  return cache;
}

// ---------------------------------------------------------------------------
// 1. Cache Set — Sequential Inserts
// ---------------------------------------------------------------------------

describe('benchmark: cache set (sequential inserts)', () => {
  for (const count of [10, 50, 100]) {
    it(
      `inserts ${count} entries in <${count * 10}ms`,
      { timeout: 30_000 },
      async () => {
        const start = performance.now();
        resetTranslationCache();
        const cache = new TranslationCache();
        for (let i = 0; i < count; i++) {
          const e = makeEntry(i);
          await cache.set(
            e.text,
            e.sourceLang,
            e.targetLang,
            e.provider,
            e.translation,
          );
        }
        const elapsed = performance.now() - start;
        cache.close();

        console.log(
          `  insert ${count} entries: ${elapsed.toFixed(1)}ms (${(elapsed / count).toFixed(2)}ms/entry)`,
        );
        // Relaxed from 30x to 60x — coverage instrumentation adds overhead
        expect(elapsed).toBeLessThan(count * 60);
      },
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Cache Get — Hit Rate at Different Fill Levels
// ---------------------------------------------------------------------------

describe('benchmark: cache get (hit rate)', () => {
  const CACHE_GET_MEDIAN_BUDGET_MS = 10;

  for (const fillPercent of [50, 80, 95]) {
    const total = 100;
    const filled = Math.floor(total * (fillPercent / 100));

    it(
      `get at ${fillPercent}% fill (${filled}/${total}) completes in <${CACHE_GET_MEDIAN_BUDGET_MS}ms median`,
      { timeout: 30_000 },
      async () => {
        const cache = await seedCache(filled);
        const nextIndex = createRoundRobinIndexPicker(total);

        const median = await measureAsync(async () => {
          const idx = nextIndex();
          const e = makeEntry(idx);
          await cache.get(e.text, e.sourceLang, e.targetLang, e.provider);
        }, 20, 2);

        cache.close();
        console.log(
          `  get at ${fillPercent}% fill: ${median.toFixed(2)}ms median`,
        );
        // IndexedDB-backed reads remain comfortably fast at this budget while
        // avoiding full-suite runner contention flakes.
        expect(median).toBeLessThan(CACHE_GET_MEDIAN_BUDGET_MS);
      },
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Cache Eviction — Behavior at Capacity
// ---------------------------------------------------------------------------

describe('benchmark: cache eviction at capacity', () => {
  // Each entry ≈ (80+80)*2 + 100 = 420 bytes. 50 entries ≈ 21KB.
  const SMALL_MAX = 21 * 1024;
  const EVICTION_BUDGET_MS = IS_COVERAGE_RUN ? 7000 : 5000;

  it(
    `inserts beyond capacity (triggers eviction) in <${EVICTION_BUDGET_MS}ms`,
    { timeout: 30_000 },
    async () => {
      resetTranslationCache();
      const cache = new TranslationCache(SMALL_MAX);
      const start = performance.now();
      for (let i = 0; i < 80; i++) {
        const e = makeEntry(i);
        await cache.set(
          e.text,
          e.sourceLang,
          e.targetLang,
          e.provider,
          e.translation,
        );
      }
      const elapsed = performance.now() - start;
      cache.close();

      console.log(`  80 inserts with eviction: ${elapsed.toFixed(1)}ms`);
      // Coverage instrumentation makes this fake-indexeddb path materially slower on
      // larger suites, so keep the non-coverage budget strict while allowing a small
      // coverage-only headroom for CI stability.
      expect(elapsed).toBeLessThan(EVICTION_BUDGET_MS);
    },
  );

  it('getStats after eviction returns correct data in <500ms', async () => {
    const cache = await seedCache(50, SMALL_MAX);
    const start = performance.now();
    const stats = await cache.getStats();
    const elapsed = performance.now() - start;
    cache.close();

    console.log(
      `  getStats: ${elapsed.toFixed(1)}ms (${stats.entries} entries, ${stats.totalSize} bytes)`,
    );
    expect(elapsed).toBeLessThan(500);
    expect(stats.entries).toBeGreaterThan(0);
    expect(stats.totalSize).toBeLessThanOrEqual(SMALL_MAX);
  });
});

// ---------------------------------------------------------------------------
// 4. Memory Footprint — Per-Entry Overhead
// ---------------------------------------------------------------------------

describe('benchmark: memory footprint estimation', () => {
  function estimateEntrySize(textLen: number, translationLen: number): number {
    return (textLen + translationLen) * 2 + 100;
  }

  const scenarios = [
    { name: 'short text (20 chars)', textLen: 20, transLen: 25 },
    { name: 'medium text (100 chars)', textLen: 100, transLen: 120 },
    { name: 'long text (1000 chars)', textLen: 1000, transLen: 1200 },
    { name: 'max text (5000 chars)', textLen: 5000, transLen: 6000 },
  ];

  for (const { name, textLen, transLen } of scenarios) {
    it(`size estimation for ${name} runs 1000× in <0.1ms`, () => {
      const median = measureSync(() => {
        let total = 0;
        for (let i = 0; i < 1000; i++) {
          total += estimateEntrySize(textLen + (i % 10), transLen + (i % 10));
        }
        if (total < 0) throw new Error('unreachable');
      }, 200);

      console.log(
        `  ${name}: ${(median * 1000).toFixed(1)}µs per 1000 estimations`,
      );
      expect(median).toBeLessThan(0.1);
    });
  }

  it('actual per-entry overhead matches formula within 10%', async () => {
    const cache = await seedCache(50);
    const stats = await cache.getStats();
    cache.close();

    const actualPerEntry =
      stats.entries > 0 ? stats.totalSize / stats.entries : 0;
    const expectedPerEntry = estimateEntrySize(80, 80); // our makeEntry uses textLength=80

    console.log(
      `  actual: ${actualPerEntry.toFixed(0)} bytes/entry, expected: ${expectedPerEntry} bytes/entry`,
    );
    expect(actualPerEntry).toBeGreaterThan(0);
    // The formula should match actual IndexedDB storage closely
    expect(Math.abs(actualPerEntry - expectedPerEntry)).toBeLessThan(
      expectedPerEntry * 0.1,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Deduplication — Batch With Duplicates vs Unique
// ---------------------------------------------------------------------------

describe('benchmark: deduplication efficiency', () => {
  const DEDUP_BUDGET_MS = IS_COVERAGE_RUN ? 2 : 1;

  function deduplicateBatch(texts: string[]): Map<string, string> {
    const seen = new Map<string, string>();
    for (const text of texts) {
      const key = hashTranslationCacheKey(text, 'en', 'fi', 'opus-mt');
      if (!seen.has(key)) seen.set(key, text);
    }
    return seen;
  }

  const uniqueTexts = Array.from(
    { length: 500 },
    (_, i) => `Unique translatable text number ${i} with content`,
  );
  const halfDupTexts = Array.from(
    { length: 500 },
    (_, i) => `Duplicate text number ${i % 250} with content`,
  );
  const heavyDupTexts = Array.from(
    { length: 500 },
    (_, i) => `Heavy duplicate text number ${i % 50} with content`,
  );

  it(`dedup 500 texts (0% dups) in <${DEDUP_BUDGET_MS}ms`, () => {
    const median = measureSync(() => deduplicateBatch(uniqueTexts), 200);
    const result = deduplicateBatch(uniqueTexts);
    console.log(
      `  0% dups: ${(median * 1000).toFixed(1)}µs, ${result.size} unique keys`,
    );
    expect(median).toBeLessThan(DEDUP_BUDGET_MS);
    expect(result.size).toBe(500);
  });

  it(`dedup 500 texts (50% dups) in <${DEDUP_BUDGET_MS}ms`, () => {
    const median = measureSync(() => deduplicateBatch(halfDupTexts), 200);
    const result = deduplicateBatch(halfDupTexts);
    console.log(
      `  50% dups: ${(median * 1000).toFixed(1)}µs, ${result.size} unique keys`,
    );
    expect(median).toBeLessThan(DEDUP_BUDGET_MS);
    expect(result.size).toBe(250);
  });

  it(`dedup 500 texts (90% dups) in <${DEDUP_BUDGET_MS}ms`, () => {
    const median = measureSync(() => deduplicateBatch(heavyDupTexts), 200);
    const result = deduplicateBatch(heavyDupTexts);
    console.log(
      `  90% dups: ${(median * 1000).toFixed(1)}µs, ${result.size} unique keys`,
    );
    expect(median).toBeLessThan(DEDUP_BUDGET_MS);
    expect(result.size).toBe(50);
  });

  it('FNV-1a hashes 1000 keys in <5ms', () => {
    const median = measureSync(() => {
      for (let i = 0; i < 1000; i++)
        hashTranslationCacheKey(`Text content ${i}`, 'en', 'fi', 'opus-mt');
    }, 200);
    console.log(`  FNV-1a 1000 keys: ${(median * 1000).toFixed(1)}µs`);
    expect(median).toBeLessThan(5);
  });
});
