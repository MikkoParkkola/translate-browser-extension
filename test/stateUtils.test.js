const stateUtils = require('../src/background/stateUtils');

describe('stateUtils', () => {
  describe('buildProvidersUsageSnapshot', () => {
    test('prunes entries outside rolling window and aggregates totals', () => {
      const now = Date.now();
      const old = now - 120000; // 2 minutes ago
      const recent = now - 1000;
      const map = new Map([
        ['primary', {
          reqTimes: [old, recent],
          tokTimes: [{ time: old, tokens: 111 }, { time: recent, tokens: 222 }],
          totalReq: 10,
          totalTok: 1000,
          avoidedReq: 2,
          avoidedTok: 50,
        }],
        ['secondary', {
          reqTimes: [recent, recent - 500],
          tokTimes: [{ time: recent, tokens: 333 }],
          totalReq: 5,
          totalTok: 500,
          avoidedReq: 1,
          avoidedTok: 25,
        }],
      ]);

      const snapshot = stateUtils.buildProvidersUsageSnapshot(map, { now, windowMs: 60000 });

      expect(snapshot.primary).toEqual({
        requests: 1,
        tokens: 222,
        totalRequests: 10,
        totalTokens: 1000,
        avoidedRequests: 2,
        avoidedTokens: 50,
      });
      expect(snapshot.secondary).toEqual({
        requests: 2,
        tokens: 333,
        totalRequests: 5,
        totalTokens: 500,
        avoidedRequests: 1,
        avoidedTokens: 25,
      });
    });

    test('mutates original entries when prune enabled', () => {
      const now = Date.now();
      const map = new Map([
        ['provider', {
          reqTimes: [now - 120000, now - 1000],
          tokTimes: [{ time: now - 120000, tokens: 10 }, { time: now - 2000, tokens: 20 }],
        }],
      ]);

      stateUtils.buildProvidersUsageSnapshot(map, { now, windowMs: 60000, prune: true });

      const entry = map.get('provider');
      expect(entry.reqTimes).toHaveLength(1);
      expect(entry.tokTimes).toHaveLength(1);
    });

    test('returns empty object when map missing', () => {
      expect(stateUtils.buildProvidersUsageSnapshot(null)).toEqual({});
    });
  });

  describe('computeUsageHistoryCosts', () => {
    test('buckets costs by 24h and 7d windows', () => {
      const now = Date.now();
      const history = [
        { ts: now - 1000, model: 'qwen', cost: 1.5 },
        { ts: now - (23 * 60 * 60 * 1000), model: 'qwen', cost: 2.5 },
        { ts: now - (5 * 24 * 60 * 60 * 1000), model: 'openai', cost: 10 },
        { ts: now - (9 * 24 * 60 * 60 * 1000), model: 'stale', cost: 9 },
      ];

      const costs = stateUtils.computeUsageHistoryCosts(history, now);

      expect(costs.total['24h']).toBeCloseTo(4.0);
      expect(costs.qwen['24h']).toBeCloseTo(4.0);
      expect(costs.total['7d']).toBeCloseTo(14.0);
      expect(costs.openai['7d']).toBeCloseTo(10);
      expect(costs.stale['7d']).toBe(0);
    });

    test('handles empty history safely', () => {
      const costs = stateUtils.computeUsageHistoryCosts(undefined, Date.now());
      expect(costs).toEqual({ total: { '24h': 0, '7d': 0 } });
    });
  });

  describe('normalizeCacheStats', () => {
    test('applies defaults and filters invalid numbers', () => {
      const normalized = stateUtils.normalizeCacheStats({
        size: 10,
        max: 'not-a-number',
        hits: 5,
        misses: undefined,
        hitRate: 0.5,
      }, { max: 100, misses: 1 });

      expect(normalized).toEqual({
        size: 10,
        max: 100,
        hits: 5,
        misses: 1,
        hitRate: 0.5,
      });
    });
  });
});
