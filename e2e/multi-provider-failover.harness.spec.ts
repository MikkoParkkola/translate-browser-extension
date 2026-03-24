/**
 * E2E: Multi-provider failover scenarios.
 *
 * These are explicit mock-harness tests, not extension-backed E2E flows.
 * They keep the higher-level failover heuristics covered while using the
 * shared synthetic harness helpers instead of repeated inline setup.
 */
import { test, expect } from '@playwright/test';
import { gotoMockHarness, installNoopCache, registerMockProviders, translate } from './mock-harness';

test.beforeEach(async ({ page }) => {
  await gotoMockHarness(page);
  await installNoopCache(page);
});

test('fails over from primary to secondary provider', async ({ page }) => {
  await registerMockProviders(page, [
    { id: 'broken', type: 'error', message: 'Service unavailable', retryable: false },
    { id: 'healthy', type: 'suffix', suffix: '-translated' },
  ]);

  const response = await translate(page, {
    text: 'hello',
    source: 'en',
    target: 'fr',
    provider: 'broken',
    providerOrder: ['broken', 'healthy'],
  });

  expect(response.text).toBe('hello-translated');
});

test('distributes requests according to provider weights', async ({ page }) => {
  await registerMockProviders(page, [
    { id: 'fast', type: 'suffix', suffix: '-fast' },
    { id: 'slow', type: 'suffix', suffix: '-slow' },
  ]);

  const counts = await page.evaluate(async (): Promise<Record<string, number>> => {
    const hits: Record<string, number> = { fast: 0, slow: 0 };
    const weights: Record<string, number> = { fast: 80, slow: 20 };
    const fastProvider = window.qwenProviders.getProvider('fast');
    const slowProvider = window.qwenProviders.getProvider('slow');
    const originalFastTranslate = fastProvider.translate;
    const originalSlowTranslate = slowProvider.translate;

    fastProvider.translate = async (options: unknown) => {
      hits.fast += 1;
      return originalFastTranslate.call(fastProvider, options);
    };
    slowProvider.translate = async (options: unknown) => {
      hits.slow += 1;
      return originalSlowTranslate.call(slowProvider, options);
    };

    const ids = Object.keys(weights);
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

    for (let i = 0; i < 100; i++) {
      let rand = Math.random() * totalWeight;
      let chosen = ids[0];
      for (const id of ids) {
        rand -= weights[id];
        if (rand <= 0) { chosen = id; break; }
      }
      const prov = window.qwenProviders.getProvider(chosen);
      await prov.translate({ text: `req-${i}`, source: 'en', target: 'fr', provider: chosen });
    }

    fastProvider.translate = originalFastTranslate;
    slowProvider.translate = originalSlowTranslate;
    return hits;
  });

  expect(counts.fast).toBeGreaterThan(55);
  expect(counts.fast).toBeLessThan(98);
  expect(counts.slow).toBeGreaterThan(2);
  expect(counts.fast + counts.slow).toBe(100);
});

test('surfaces meaningful error when all providers fail', async ({ page }) => {
  await registerMockProviders(page, [
    { id: 'bad1', type: 'error', message: 'rate limited' },
    { id: 'bad2', type: 'error', message: 'connection refused' },
  ]);

  await expect(
    translate(page, {
      text: 'test',
      source: 'en',
      target: 'fr',
      provider: 'bad1',
      providerOrder: ['bad1', 'bad2'],
    }),
  ).rejects.toThrow(/connection refused/i);
});

test('provider recovers after transient failure', async ({ page }) => {
  await registerMockProviders(page, [
    {
      id: 'flaky',
      type: 'flaky',
      suffix: '-ok',
      failCount: 2,
      message: 'temporary failure',
      retryable: true,
    },
  ]);

  const outcomes: Array<{ ok: boolean; text?: string; error?: string }> = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await translate(page, {
        text: `attempt-${attempt}`,
        source: 'en',
        target: 'fr',
        provider: 'flaky',
      });
      outcomes.push({ ok: true, text: response.text });
    } catch (error) {
      outcomes.push({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  expect(outcomes[0].ok).toBe(false);
  expect(outcomes[0].error).toContain('temporary failure');
  expect(outcomes[1].ok).toBe(false);
  expect(outcomes[2].ok).toBe(true);
  expect(outcomes[2].text).toBe('attempt-2-ok');
  expect(outcomes[3].ok).toBe(true);
  expect(outcomes[3].text).toBe('attempt-3-ok');
});
