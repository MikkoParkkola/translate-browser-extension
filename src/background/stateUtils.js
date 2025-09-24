(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  }
  if (root) {
    root.qwenStateUtils = mod;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  const WINDOW_MS = 60 * 1000;

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function buildProvidersUsageSnapshot(map, options = {}) {
    const {
      now = Date.now(),
      windowMs = WINDOW_MS,
      prune = false,
    } = options || {};

    const snapshot = {};
    if (!map || typeof map.forEach !== 'function') {
      return snapshot;
    }

    map.forEach((entry, name) => {
      if (!name || !entry) return;
      const reqTimes = safeArray(entry.reqTimes).filter(ts => typeof ts === 'number' && now - ts < windowMs);
      const tokTimes = safeArray(entry.tokTimes).filter(t => t && typeof t.time === 'number' && now - t.time < windowMs);
      const tokensWindow = tokTimes.reduce((sum, t) => sum + (Number.isFinite(t.tokens) ? t.tokens : 0), 0);

      if (prune) {
        entry.reqTimes = reqTimes;
        entry.tokTimes = tokTimes;
      }

      snapshot[name] = {
        requests: reqTimes.length,
        tokens: tokensWindow,
        totalRequests: Number.isFinite(entry.totalReq) ? entry.totalReq : 0,
        totalTokens: Number.isFinite(entry.totalTok) ? entry.totalTok : 0,
        avoidedRequests: Number.isFinite(entry.avoidedReq) ? entry.avoidedReq : 0,
        avoidedTokens: Number.isFinite(entry.avoidedTok) ? entry.avoidedTok : 0,
      };
    });

    return snapshot;
  }

  function computeUsageHistoryCosts(history, now = Date.now()) {
    const costs = { total: { '24h': 0, '7d': 0 } };
    if (!Array.isArray(history)) {
      return costs;
    }

    history.forEach(record => {
      if (!record) return;
      const age = now - (record.ts || 0);
      const cost = Number.isFinite(record.cost) ? record.cost : 0;
      const model = record.model || 'unknown';
      if (!costs[model]) {
        costs[model] = { '24h': 0, '7d': 0 };
      }
      if (age <= DAY_MS) {
        costs[model]['24h'] += cost;
        costs.total['24h'] += cost;
      }
      if (age <= WEEK_MS) {
        costs[model]['7d'] += cost;
        costs.total['7d'] += cost;
      }
    });

    return costs;
  }

  function normalizeCacheStats(stats, fallback = {}) {
    const base = Object.assign({ size: 0, max: 0, hits: 0, misses: 0, hitRate: 0 }, fallback || {});
    if (!stats) return base;
    return {
      size: Number.isFinite(stats.size) ? stats.size : base.size,
      max: Number.isFinite(stats.max) ? stats.max : base.max,
      hits: Number.isFinite(stats.hits) ? stats.hits : base.hits,
      misses: Number.isFinite(stats.misses) ? stats.misses : base.misses,
      hitRate: Number.isFinite(stats.hitRate) ? stats.hitRate : base.hitRate,
    };
  }

  return {
    buildProvidersUsageSnapshot,
    computeUsageHistoryCosts,
    normalizeCacheStats,
  };
}));
