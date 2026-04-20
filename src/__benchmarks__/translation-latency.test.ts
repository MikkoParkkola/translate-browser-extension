/**
 * Translation Latency Performance Tests
 *
 * Measures cache key hashing, in-memory cache lookup simulation,
 * batch preparation, provider selection scoring, and text deduplication
 * using performance.now() timing with threshold assertions.
 *
 * Run: npx vitest run src/__benchmarks__/translation-latency.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { TranslationCache, resetTranslationCache } from '../core/translation-cache';
import { TranslationRouter } from '../core/translation-router';
import { CircuitBreaker } from '../core/circuit-breaker';
import type { TranslationProvider, LanguagePair, ProviderConfig } from '../types';
import {
  createRoundRobinIndexPicker,
  hashTranslationCacheKey,
  measureAsync,
  measureSync,
} from './benchmark-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(i: number) {
  return {
    text: `This is sentence number ${i} that needs to be translated into another language`,
    sourceLang: 'en',
    targetLang: 'fi',
    provider: 'opus-mt' as const,
    translation: `Tämä on lause numero ${i} joka pitää kääntää toiselle kielelle`,
  };
}

function createMockProvider(overrides: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    id: overrides.id ?? 'mock-provider',
    name: overrides.name ?? 'Mock Provider',
    type: overrides.type ?? 'cloud',
    qualityTier: overrides.qualityTier ?? 'standard',
    costPerMillion: overrides.costPerMillion ?? 10,
    icon: '🧪',
    initialize: async () => {},
    translate: async (text: string | string[]) =>
      Array.isArray(text) ? text.map((t) => `[translated] ${t}`) : `[translated] ${text}`,
    detectLanguage: async () => 'en',
    isAvailable: async () => true,
    getSupportedLanguages: (): LanguagePair[] => [
      { src: 'en', tgt: 'fi' },
      { src: 'fi', tgt: 'en' },
      { src: 'en', tgt: 'de' },
    ],
    test: async () => true,
    getInfo: (): ProviderConfig => ({
      id: 'mock-provider',
      name: 'Mock Provider',
      type: 'cloud',
      qualityTier: 'standard',
      costPerMillion: 10,
      icon: '🧪',
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Cache Key Hashing & In-Memory Lookup
// ---------------------------------------------------------------------------

describe('benchmark: cache lookup latency', () => {
  for (const count of [1, 10, 100, 1000]) {
    const cache = new Map<string, string>();
    for (let i = 0; i < count; i++) {
      const e = makeEntry(i);
      cache.set(
        hashTranslationCacheKey(
          e.text,
          e.sourceLang,
          e.targetLang,
          e.provider,
        ),
        e.translation,
      );
    }

    it(`cache hit with ${count} entries completes in <0.05ms`, () => {
      const nextIndex = createRoundRobinIndexPicker(count);
      const median = measureSync(() => {
        const idx = nextIndex();
        const e = makeEntry(idx);
        cache.get(
          hashTranslationCacheKey(
            e.text,
            e.sourceLang,
            e.targetLang,
            e.provider,
          ),
        );
      }, 1000, 10);

      console.log(`  cache hit (${count} entries): ${(median * 1000).toFixed(1)}µs`);
      // Relaxed from 0.01ms to 0.05ms — coverage instrumentation adds overhead
      expect(median).toBeLessThan(0.05);
    });

    it(`cache miss with ${count} entries completes in <0.05ms`, () => {
      const median = measureSync(() => {
        cache.get(
          hashTranslationCacheKey(
            'nonexistent text xyz',
            'en',
            'fi',
            'opus-mt',
          ),
        );
      }, 1000, 10);

      console.log(`  cache miss (${count} entries): ${(median * 1000).toFixed(1)}µs`);
      // Relaxed from 0.01ms to 0.05ms — coverage instrumentation adds overhead
      expect(median).toBeLessThan(0.05);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. IndexedDB Round-Trip
// ---------------------------------------------------------------------------

describe('benchmark: IndexedDB cache round-trip', () => {
  const IDB_SET_MEDIAN_BUDGET_MS = 15;
  let cache: TranslationCache;

  beforeAll(async () => {
    resetTranslationCache();
    cache = new TranslationCache();
    for (let i = 0; i < 10; i++) {
      const e = makeEntry(i);
      await cache.set(e.text, e.sourceLang, e.targetLang, e.provider, e.translation);
    }
  });

  it('IDB get (hit) completes in <5ms median', async () => {
    const e = makeEntry(0);
    const median = await measureAsync(async () => {
      await cache.get(e.text, e.sourceLang, e.targetLang, e.provider);
    }, 20, 3);

    console.log(`  IDB get hit: ${median.toFixed(2)}ms`);
    expect(median).toBeLessThan(5);
  });

  it('IDB get (miss) completes in <5ms median', async () => {
    const median = await measureAsync(async () => {
      await cache.get('nonexistent text xyz', 'en', 'fi', 'opus-mt');
    }, 20, 3);

    console.log(`  IDB get miss: ${median.toFixed(2)}ms`);
    expect(median).toBeLessThan(5);
  });

  it(`IDB set completes in <${IDB_SET_MEDIAN_BUDGET_MS}ms median`, async () => {
    let idx = 0;
    const median = await measureAsync(async () => {
      await cache.set(`bench text ${idx++}`, 'en', 'fi', 'opus-mt', 'käännetty');
    }, 20, 3);

    console.log(`  IDB set: ${median.toFixed(2)}ms`);
    // fake-indexeddb write timings vary more than reads across local/CI runners,
    // so keep a slightly looser budget while still catching meaningful regressions.
    expect(median).toBeLessThan(IDB_SET_MEDIAN_BUDGET_MS);
  });
});

// ---------------------------------------------------------------------------
// 3. Batch Preparation
// ---------------------------------------------------------------------------

describe('benchmark: batch preparation', () => {
  function prepareBatch(texts: string[], maxSize: number): string[][] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const t of texts) {
      const trimmed = t.trim();
      if (trimmed.length >= 2 && !seen.has(trimmed)) {
        seen.add(trimmed);
        unique.push(trimmed);
      }
    }
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += maxSize) {
      batches.push(unique.slice(i, i + maxSize));
    }
    return batches;
  }

  for (const count of [10, 100, 1000]) {
    const texts = Array.from({ length: count }, (_, i) =>
      `Text node content #${i}: This paragraph contains translatable text`,
    );

    it(`prepare batch of ${count} nodes in <1ms`, () => {
      const median = measureSync(() => {
        prepareBatch(texts, 50);
      }, 500);

      console.log(`  batch prep (${count} nodes): ${(median * 1000).toFixed(1)}µs`);
      expect(median).toBeLessThan(1);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Translation Router Selection
// ---------------------------------------------------------------------------

describe('benchmark: translation router selection', () => {
  let router: TranslationRouter;

  beforeAll(() => {
    const breaker = new CircuitBreaker();
    router = new TranslationRouter(breaker);

    for (const p of [
      createMockProvider({ id: 'local-fast', name: 'Local Fast', type: 'local', qualityTier: 'basic', costPerMillion: 0 }),
      createMockProvider({ id: 'cloud-premium', name: 'Cloud Premium', type: 'cloud', qualityTier: 'premium', costPerMillion: 20 }),
      createMockProvider({ id: 'cloud-standard', name: 'Cloud Standard', type: 'cloud', qualityTier: 'standard', costPerMillion: 10 }),
    ]) {
      router.registerProvider(p);
    }
  });

  for (const strategy of ['balanced', 'quality', 'fast', 'cost'] as const) {
    it(`selectProvider (${strategy}) completes in <5ms`, async () => {
      router.setStrategy(strategy);
      const median = await measureAsync(async () => {
        await router.selectProvider('en', 'fi');
      }, 20, 3);

      console.log(`  selectProvider (${strategy}): ${median.toFixed(2)}ms`);
      expect(median).toBeLessThan(5);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Text Deduplication
// ---------------------------------------------------------------------------

describe('benchmark: text deduplication', () => {
  function deduplicateTexts(texts: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of texts) {
      if (!seen.has(t)) {
        seen.add(t);
        result.push(t);
      }
    }
    return result;
  }

  const uniqueTexts = Array.from({ length: 500 }, (_, i) => `Unique text #${i}`);
  const duplicatedTexts = Array.from({ length: 1000 }, (_, i) => `Repeated text #${i % 100}`);
  const mixedTexts = [...uniqueTexts, ...duplicatedTexts];

  it('dedup 500 unique texts (0% dups) in <0.5ms', () => {
    const median = measureSync(() => deduplicateTexts(uniqueTexts), 500);
    console.log(`  dedup 500 unique: ${(median * 1000).toFixed(1)}µs`);
    // Relaxed from 0.1ms to 0.5ms — coverage instrumentation adds overhead
    expect(median).toBeLessThan(0.5);
  });

  it('dedup 1000 texts (90% dups) in <0.5ms', () => {
    const median = measureSync(() => deduplicateTexts(duplicatedTexts), 500);
    console.log(`  dedup 1000 (90% dups): ${(median * 1000).toFixed(1)}µs`);
    // Relaxed from 0.1ms to 0.5ms — coverage instrumentation adds overhead
    expect(median).toBeLessThan(0.5);
  });

  it('dedup 1500 mixed texts (~33% dups) in <0.5ms', () => {
    const median = measureSync(() => deduplicateTexts(mixedTexts), 500);
    console.log(`  dedup 1500 mixed: ${(median * 1000).toFixed(1)}µs`);
    // Relaxed from 0.1ms to 0.5ms — coverage instrumentation adds overhead
    expect(median).toBeLessThan(0.5);
  });
});
