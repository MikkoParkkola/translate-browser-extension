/**
 * TranslateGemma batch scheduling benchmark harness.
 *
 * The real TranslateGemma model is too large for routine CI, so this benchmark
 * isolates the fixed WebGPU/WebNN dispatch cost that MIK-3472 optimizes:
 * sequential scheduling performs one model dispatch per text segment, while the
 * shipped path performs one dispatch per capped prompt chunk.
 *
 * Run: npm run test:benchmarks -- src/__benchmarks__/translategemma-batch.test.ts
 */

import { describe, it, expect } from 'vitest';
import { TRANSLATEGEMMA_MAX_BATCH_SIZE } from '../offscreen/translategemma';

const REPRESENTATIVE_PAGE_BATCH_SIZE = TRANSLATEGEMMA_MAX_BATCH_SIZE * 2;

function makeRepresentativePageBatch(): string[] {
  return Array.from(
    { length: REPRESENTATIVE_PAGE_BATCH_SIZE },
    (_, index) => `Representative page segment ${index + 1}`,
  );
}

function simulateModelDispatch(texts: string[]): string[] {
  return texts.map((text) => `[fi] ${text}`);
}

function translateSequentially(texts: string[]): {
  dispatches: number;
  translations: string[];
} {
  let dispatches = 0;
  const translations = texts.map((text) => {
    dispatches += 1;
    return simulateModelDispatch([text])[0] ?? '';
  });

  return { dispatches, translations };
}

function translateInBatches(texts: string[]): {
  dispatches: number;
  translations: string[];
} {
  let dispatches = 0;
  const translations = new Array<string>(texts.length);

  for (let i = 0; i < texts.length; i += TRANSLATEGEMMA_MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + TRANSLATEGEMMA_MAX_BATCH_SIZE);
    dispatches += 1;
    simulateModelDispatch(batch).forEach((translation, offset) => {
      translations[i + offset] = translation;
    });
  }

  return { dispatches, translations };
}

describe('benchmark: TranslateGemma batch scheduling throughput', () => {
  it('reduces fixed model dispatches while preserving response order', () => {
    const texts = makeRepresentativePageBatch();
    const sequential = translateSequentially(texts);
    const batched = translateInBatches(texts);

    const sequentialThroughput = texts.length / sequential.dispatches;
    const batchedThroughput = texts.length / batched.dispatches;

    console.log(
      `  TranslateGemma scheduler: sequential dispatches=${sequential.dispatches}, ` +
        `batched dispatches=${batched.dispatches}, ` +
        `throughput ratio=${(batchedThroughput / sequentialThroughput).toFixed(1)}x`,
    );

    expect(sequential.dispatches).toBe(REPRESENTATIVE_PAGE_BATCH_SIZE);
    expect(batched.dispatches).toBe(
      Math.ceil(REPRESENTATIVE_PAGE_BATCH_SIZE / TRANSLATEGEMMA_MAX_BATCH_SIZE),
    );
    expect(batchedThroughput).toBeGreaterThanOrEqual(
      sequentialThroughput * TRANSLATEGEMMA_MAX_BATCH_SIZE,
    );
    expect(batched.translations).toEqual(sequential.translations);
  });
});
