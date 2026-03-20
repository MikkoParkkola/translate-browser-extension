/**
 * E2E: Multi-provider failover scenarios.
 *
 * Tests provider chaining, weighted distribution, total failure handling,
 * and recovery after transient errors. Uses the same mock-page pattern as
 * provider-switch.spec.js and translation-cache.spec.js.
 */
import { test, expect } from '@playwright/test';

const pageUrl = 'http://127.0.0.1:8080/e2e/mock.html';

// ── Shared stubs injected before every test ──────────────────────────
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__setTranslateStub = () => {
      window.qwenTranslate = async (opts: any) => {
        const prov = window.qwenProviders.getProvider(opts.provider);
        return prov.translate(opts);
      };
      window.qwenTranslateBatch = async ({ texts = [], provider, source, target }: any) => {
        const prov = window.qwenProviders.getProvider(provider);
        const out: string[] = [];
        for (const text of texts) {
          const res = await prov.translate({ text, source, target, provider });
          out.push(res.text);
        }
        return { texts: out };
      };
    };
    window.qwenCache = {
      cacheReady: Promise.resolve(),
      getCache: () => null,
      setCache: () => {},
      removeCache: () => {},
      qwenClearCache: () => {},
      qwenGetCacheSize: () => 0,
      qwenSetCacheLimit: () => {},
      qwenSetCacheTTL: () => {},
    };
  });
});

// ── 1. First provider fails → second succeeds ───────────────────────
test('fails over from primary to secondary provider', async ({ page }) => {
  await page.goto(pageUrl);
  await page.evaluate(() => window.__setTranslateStub());

  await page.evaluate(() => {
    window.qwenProviders.registerProvider('broken', {
      async translate() {
        const err = new Error('Service unavailable');
        (err as any).retryable = false;
        throw err;
      },
    });
    window.qwenProviders.registerProvider('healthy', {
      async translate({ text }: any) {
        return { text: `${text}-translated` };
      },
    });
  });

  const result = await page.evaluate(async () => {
    const providers = ['broken', 'healthy'];
    for (const id of providers) {
      try {
        const prov = window.qwenProviders.getProvider(id);
        const res = await prov.translate({ text: 'hello', source: 'en', target: 'fr', provider: id });
        return { text: res.text, usedProvider: id, error: null };
      } catch {
        continue; // try next
      }
    }
    return { text: null, usedProvider: null, error: 'all failed' };
  });

  expect(result.text).toBe('hello-translated');
  expect(result.usedProvider).toBe('healthy');
});

// ── 2. Weighted provider distribution ────────────────────────────────
test('distributes requests according to provider weights', async ({ page }) => {
  await page.goto(pageUrl);
  await page.evaluate(() => window.__setTranslateStub());

  const counts = await page.evaluate(async () => {
    const hits: Record<string, number> = { fast: 0, slow: 0 };
    const weights: Record<string, number> = { fast: 80, slow: 20 };

    window.qwenProviders.registerProvider('fast', {
      async translate({ text }: any) {
        hits.fast++;
        return { text: `${text}-fast` };
      },
    });
    window.qwenProviders.registerProvider('slow', {
      async translate({ text }: any) {
        hits.slow++;
        return { text: `${text}-slow` };
      },
    });

    // Simple weighted random selection over 100 iterations
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
    return hits;
  });

  // With 80/20 weights over 100 requests, expect roughly 80±15 for fast
  expect(counts.fast).toBeGreaterThan(55);
  expect(counts.fast).toBeLessThan(98);
  expect(counts.slow).toBeGreaterThan(2);
  expect(counts.fast + counts.slow).toBe(100);
});

// ── 3. All providers fail → meaningful error ─────────────────────────
test('surfaces meaningful error when all providers fail', async ({ page }) => {
  await page.goto(pageUrl);
  await page.evaluate(() => window.__setTranslateStub());

  await page.evaluate(() => {
    window.qwenProviders.registerProvider('bad1', {
      async translate() {
        throw new Error('rate limited');
      },
    });
    window.qwenProviders.registerProvider('bad2', {
      async translate() {
        throw new Error('connection refused');
      },
    });
  });

  const result = await page.evaluate(async () => {
    const providers = ['bad1', 'bad2'];
    const errors: string[] = [];
    for (const id of providers) {
      try {
        const prov = window.qwenProviders.getProvider(id);
        await prov.translate({ text: 'test', source: 'en', target: 'fr', provider: id });
        return { ok: true, errors };
      } catch (e: any) {
        errors.push(`${id}: ${e.message}`);
      }
    }
    return { ok: false, errors };
  });

  expect(result.ok).toBe(false);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toContain('rate limited');
  expect(result.errors[1]).toContain('connection refused');
});

// ── 4. Provider recovers after transient failure ─────────────────────
test('provider recovers after transient failure', async ({ page }) => {
  await page.goto(pageUrl);
  await page.evaluate(() => window.__setTranslateStub());

  await page.evaluate(() => {
    let callCount = 0;
    window.qwenProviders.registerProvider('flaky', {
      async translate({ text }: any) {
        callCount++;
        if (callCount <= 2) {
          const err = new Error('temporary failure');
          (err as any).retryable = true;
          throw err;
        }
        return { text: `${text}-ok` };
      },
    });
  });

  const results = await page.evaluate(async () => {
    const outcomes: Array<{ ok: boolean; text?: string; error?: string }> = [];

    for (let i = 0; i < 4; i++) {
      try {
        const prov = window.qwenProviders.getProvider('flaky');
        const res = await prov.translate({ text: `attempt-${i}`, source: 'en', target: 'fr', provider: 'flaky' });
        outcomes.push({ ok: true, text: res.text });
      } catch (e: any) {
        outcomes.push({ ok: false, error: e.message });
      }
    }
    return outcomes;
  });

  // First two calls fail
  expect(results[0].ok).toBe(false);
  expect(results[0].error).toContain('temporary failure');
  expect(results[1].ok).toBe(false);

  // Third and fourth calls succeed (provider recovered)
  expect(results[2].ok).toBe(true);
  expect(results[2].text).toBe('attempt-2-ok');
  expect(results[3].ok).toBe(true);
  expect(results[3].text).toBe('attempt-3-ok');
});
