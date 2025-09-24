/**
 * Metrics Commands - Handle usage statistics, performance metrics, and monitoring
 * 
 * Provides various metrics endpoints for monitoring translation usage, cache performance,
 * provider statistics, and system health.
 */

(function() {
  // Prevent duplicate loading
  if (typeof self.qwenMetricsCommands !== 'undefined') {
    return;
  }

  if (typeof self.qwenCommandDispatcher === 'undefined') {
    throw new Error('Command dispatcher not loaded');
  }

  const { Command } = self.qwenCommandDispatcher;

  let stateUtils;
  try {
    if (self.qwenStateUtils) {
      stateUtils = self.qwenStateUtils;
    } else {
      stateUtils = require('../background/stateUtils');
    }
  } catch (error) {
    stateUtils = null;
  }

  let storageHelpers;
  try {
    if (self.qwenBackgroundStorage && self.qwenBackgroundStorage.createStorage) {
      storageHelpers = self.qwenBackgroundStorage.createStorage(self.qwenAsyncChrome);
    } else {
      storageHelpers = require('../background/storage').createStorage(self.qwenAsyncChrome);
    }
  } catch (error) {
    storageHelpers = {
      get: (_area, defaults) => Promise.resolve({ ...(defaults || {}) }),
      set: () => Promise.resolve(),
    };
  }

  const storageGet = storageHelpers.get;

  const WINDOW_MS = 60000;

  const buildProvidersSnapshot = (providersUsageMap) => {
    if (stateUtils && typeof stateUtils.buildProvidersUsageSnapshot === 'function') {
      return stateUtils.buildProvidersUsageSnapshot(providersUsageMap, { prune: false });
    }
    const snapshot = {};
    if (!providersUsageMap || typeof providersUsageMap.forEach !== 'function') {
      return snapshot;
    }
    const now = Date.now();
    providersUsageMap.forEach((entry, name) => {
      if (!entry) return;
      const reqTimes = Array.isArray(entry.reqTimes) ? entry.reqTimes.filter(t => now - t < WINDOW_MS) : [];
      const tokTimes = Array.isArray(entry.tokTimes) ? entry.tokTimes.filter(t => t && now - t.time < WINDOW_MS) : [];
      const tokens = tokTimes.reduce((sum, t) => sum + (t && t.tokens ? t.tokens : 0), 0);
      entry.reqTimes = reqTimes;
      entry.tokTimes = tokTimes;
      snapshot[name] = {
        requests: reqTimes.length,
        tokens,
        totalRequests: entry.totalReq || 0,
        totalTokens: entry.totalTok || 0,
        avoidedRequests: entry.avoidedReq || 0,
        avoidedTokens: entry.avoidedTok || 0,
      };
    });
    return snapshot;
  };

  const computeHistoryCosts = (history, now = Date.now()) => {
    if (stateUtils && typeof stateUtils.computeUsageHistoryCosts === 'function') {
      return stateUtils.computeUsageHistoryCosts(history, now);
    }
    const costs = { total: { '24h': 0, '7d': 0 } };
    (Array.isArray(history) ? history : []).forEach(rec => {
      if (!rec) return;
      const age = now - (rec.ts || 0);
      const cost = Number.isFinite(rec.cost) ? rec.cost : 0;
      const model = rec.model || 'unknown';
      const entry = costs[model] || { '24h': 0, '7d': 0 };
      if (age <= 86400000) {
        entry['24h'] += cost;
        costs.total['24h'] += cost;
      }
      if (age <= 604800000) {
        entry['7d'] += cost;
        costs.total['7d'] += cost;
      }
      costs[model] = entry;
    });
    return costs;
  };

class UsageCommand extends Command {
  constructor(ensureThrottle, usageStats) {
    super('usage', { ensureThrottle, usageStats });
    this.ensureThrottle = ensureThrottle;
    this.usageStats = usageStats;
  }

  async execute() {
    await this.ensureThrottle();
    const stats = self.qwenThrottle.getUsage();

    const data = await storageGet('local', { usageHistory: [] });
    const costs = computeHistoryCosts(data.usageHistory || [], Date.now());

    return {
      ...stats,
      models: this.usageStats.models,
      costs,
    };
  }
}

class MetricsCommand extends Command {
  constructor(ensureThrottle, cacheStats, tmStats, providersUsage, translationStatus) {
    super('metrics', { ensureThrottle, cacheStats, tmStats, providersUsage, translationStatus });
    this.ensureThrottle = ensureThrottle;
    this.cacheStats = cacheStats;
    this.tmStats = tmStats;
    this.providersUsage = providersUsage;
    this.translationStatus = translationStatus;
  }

  async execute() {
    await this.ensureThrottle();
    const usage = self.qwenThrottle.getUsage();
    
    const baseCache = {
      size: self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0,
      max: (self.qwenConfig && self.qwenConfig.memCacheMax) || 0,
      hits: this.cacheStats.hits || 0,
      misses: this.cacheStats.misses || 0,
      hitRate: this.cacheStats.hitRate || 0,
    };
    const cache = stateUtils && stateUtils.normalizeCacheStats
      ? stateUtils.normalizeCacheStats(this.cacheStats, baseCache)
      : {
          size: this.cacheStats.size != null ? this.cacheStats.size : baseCache.size,
          max: this.cacheStats.max != null ? this.cacheStats.max : baseCache.max,
          hits: baseCache.hits,
          misses: baseCache.misses,
          hitRate: baseCache.hitRate,
        };

    const tm = Object.keys(this.tmStats).length ? this.tmStats : ((self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {});

    const cfg = await storageGet('sync', { providers: {} });
    const providers = {};
    Object.entries(cfg.providers || {}).forEach(([id, p]) => {
      providers[id] = {
        apiKey: !!p.apiKey,
        model: p.model || '',
        endpoint: p.apiEndpoint || '',
      };
    });

    const usageSnapshot = buildProvidersSnapshot(this.providersUsage);
    Object.entries(usageSnapshot).forEach(([name, stats]) => {
      if (!providers[name]) {
        providers[name] = { apiKey: false, model: '', endpoint: '' };
      }
      providers[name] = {
        ...providers[name],
        requests: stats.requests,
        tokens: stats.tokens,
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokens,
        avoidedRequests: stats.avoidedRequests,
        avoidedTokens: stats.avoidedTokens,
      };
    });

    return {
      usage,
      cache,
      tm,
      providers,
      providersUsage: usageSnapshot,
      status: this.translationStatus,
    };
  }
}

class MetricsV1Command extends Command {
  constructor(ensureThrottle, getCacheStats, getTranslationMemoryStats, providersUsage, getAggregatedStats, translationStatus) {
    super('metrics-v1', {
      ensureThrottle,
      getCacheStats,
      getTranslationMemoryStats,
      providersUsage,
      getAggregatedStats,
      translationStatus
    });
    this.ensureThrottle = ensureThrottle;
    this.getCacheStats = getCacheStats;
    this.getTranslationMemoryStats = getTranslationMemoryStats;
    this.providersUsage = providersUsage;
    this.getAggregatedStats = getAggregatedStats;
    this.translationStatus = translationStatus;
  }

  async execute() {
    await this.ensureThrottle();
    const usage = self.qwenThrottle.getUsage();
    const cache = this.getCacheStats();
    const tm = this.getTranslationMemoryStats();

    const usageSnapshot = buildProvidersSnapshot(this.providersUsage);
    const providers = {};
    Object.entries(usageSnapshot).forEach(([name, stats]) => {
      providers[name] = {
        window: { requests: stats.requests, tokens: stats.tokens },
        totals: { requests: stats.totalRequests, tokens: stats.totalTokens },
        saved: { requests: stats.avoidedRequests, tokens: stats.avoidedTokens },
      };
    });

    const agg = this.getAggregatedStats();
    return {
      version: 1,
      usage,
      providers,
      cache,
      tm,
      quality: { 
        last: agg.quality, 
        avgLatencyMs: agg.avgLatency, 
        p50Ms: agg.p50, 
        p95Ms: agg.p95, 
        etaSeconds: Math.round(agg.eta || 0) 
      },
      errors: {},
      status: this.translationStatus,
    };
  }
}

class TranslationStatusCommand extends Command {
  constructor(broadcastEta, broadcastStats) {
    super('translation-status', { broadcastEta, broadcastStats });
    this.broadcastEta = broadcastEta;
    this.broadcastStats = broadcastStats;
    this.translationStatus = {};
    this.etaMs = null;
    this.cacheStats = {};
    this.tmStats = {};
  }

  execute(msg) {
    this.translationStatus = msg.status || { active: false };
    
    if (msg.status && msg.status.summary) {
      const s = msg.status.summary;
      try {
        if (typeof s.tokens === 'number') {
          self.qwenThrottle.recordUsage(s.tokens, s.requests || 1);
        }
      } catch (error) {
        // Silently continue - matches original behavior
      }
      if (s.cache) this.cacheStats = s.cache;
      if (s.tm) this.tmStats = s.tm;
    }

    if (msg.status && typeof msg.status.etaMs === 'number') {
      this.etaMs = msg.status.etaMs;
      this.broadcastEta();
    } else if (!this.translationStatus.active) {
      this.etaMs = null;
      this.broadcastEta();
    }

    this.broadcastStats();
    return { ok: true };
  }
}

class GetStatusCommand extends Command {
  constructor(translationStatus) {
    super('get-status', { translationStatus });
    this.translationStatus = translationStatus;
  }

  execute() {
    return { status: this.translationStatus };
  }
}

// Export all metrics commands
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UsageCommand,
    MetricsCommand,
    MetricsV1Command,
    TranslationStatusCommand,
    GetStatusCommand,
  };
} else {
  self.qwenMetricsCommands = {
    UsageCommand,
    MetricsCommand,
    MetricsV1Command,
    TranslationStatusCommand,
    GetStatusCommand,
  };
}

})(); // End of IIFE
