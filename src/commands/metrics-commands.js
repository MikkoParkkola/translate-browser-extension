/**
 * Metrics Commands - Handle usage statistics, performance metrics, and monitoring
 * 
 * Provides various metrics endpoints for monitoring translation usage, cache performance,
 * provider statistics, and system health.
 */

if (typeof self.qwenCommandDispatcher === 'undefined') {
  throw new Error('Command dispatcher not loaded');
}

const { Command } = self.qwenCommandDispatcher;

class UsageCommand extends Command {
  constructor(ensureThrottle, usageStats) {
    super('usage', { ensureThrottle, usageStats });
    this.ensureThrottle = ensureThrottle;
    this.usageStats = usageStats;
  }

  async execute() {
    await this.ensureThrottle();
    const stats = self.qwenThrottle.getUsage();

    return new Promise(resolve => {
      chrome.storage.local.get({ usageHistory: [] }, data => {
        const now = Date.now();
        const costs = { total: { '24h': 0, '7d': 0 } };
        
        (data.usageHistory || []).forEach(rec => {
          const age = now - rec.ts;
          const entry = costs[rec.model] || { '24h': 0, '7d': 0 };
          if (age <= 86400000) { // 24 hours
            entry['24h'] += rec.cost;
            costs.total['24h'] += rec.cost;
          }
          if (age <= 86400000 * 7) { // 7 days
            entry['7d'] += rec.cost;
            costs.total['7d'] += rec.cost;
          }
          costs[rec.model] = entry;
        });

        resolve({ 
          ...stats, 
          models: this.usageStats.models, 
          costs 
        });
      });
    });
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
    
    const cache = {
      size: this.cacheStats.size != null ? this.cacheStats.size : (self.qwenGetCacheSize ? self.qwenGetCacheSize() : 0),
      max: this.cacheStats.max != null ? this.cacheStats.max : ((self.qwenConfig && self.qwenConfig.memCacheMax) || 0),
      hits: this.cacheStats.hits || 0,
      misses: this.cacheStats.misses || 0,
      hitRate: this.cacheStats.hitRate || 0,
    };

    const tm = Object.keys(this.tmStats).length ? this.tmStats : ((self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {});

    return new Promise(resolve => {
      chrome.storage.sync.get({ providers: {} }, cfg => {
        const providers = {};
        Object.entries(cfg.providers || {}).forEach(([id, p]) => {
          providers[id] = {
            apiKey: !!p.apiKey,
            model: p.model || '',
            endpoint: p.apiEndpoint || '',
          };
        });

        // Build providers usage snapshot
        const provUsage = {};
        const now = Date.now();
        for (const [name, pu] of this.providersUsage.entries()) {
          const rt = (pu.reqTimes || []).filter(t => now - t < 60000);
          const tt = (pu.tokTimes || []).filter(t => now - t.time < 60000);
          provUsage[name] = {
            requests: rt.length,
            tokens: tt.reduce((s, t) => s + (t.tokens || 0), 0),
            totalRequests: pu.totalReq || 0,
            totalTokens: pu.totalTok || 0,
            avoidedRequests: pu.avoidedReq || 0,
            avoidedTokens: pu.avoidedTok || 0,
          };
        }

        resolve({ 
          usage, 
          cache, 
          tm, 
          providers, 
          providersUsage: provUsage, 
          status: this.translationStatus 
        });
      });
    });
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

    const providers = {};
    const now = Date.now();
    for (const [name, pu] of this.providersUsage.entries()) {
      const rt = (pu.reqTimes || []).filter(t => now - t < 60000);
      const tt = (pu.tokTimes || []).filter(t => now - t.time < 60000);
      providers[name] = {
        window: { requests: rt.length, tokens: tt.reduce((s, t) => s + (t.tokens || 0), 0) },
        totals: { requests: pu.totalReq || 0, tokens: pu.totalTok || 0 },
        saved: { requests: pu.avoidedReq || 0, tokens: pu.avoidedTok || 0 },
      };
    }

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