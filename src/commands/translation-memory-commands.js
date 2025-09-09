/**
 * Translation Memory Commands - Handle TM operations
 * 
 * Manages translation memory operations including getting entries, clearing,
 * importing data, and statistics.
 */

if (typeof self.qwenCommandDispatcher === 'undefined') {
  throw new Error('Command dispatcher not loaded');
}

const { Command } = self.qwenCommandDispatcher;

class ClearRemoteTMCommand extends Command {
  constructor() {
    super('clear-remote-tm');
  }

  execute() {
    if (self.qwenTM && self.qwenTM.clearRemote) {
      self.qwenTM.clearRemote();
    }
    return { ok: true };
  }
}

class TMGetAllCommand extends Command {
  constructor() {
    super('tm-get-all');
  }

  async execute() {
    const entries = self.qwenTM && self.qwenTM.getAll ? await self.qwenTM.getAll() : [];
    const stats = self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : {};
    return { entries, stats };
  }
}

class TMStatsCommand extends Command {
  constructor() {
    super('tm-stats');
  }

  async execute() {
    const stats = self.qwenTM && self.qwenTM.stats ? self.qwenTM.stats() : {};
    return { stats };
  }
}

class TMClearCommand extends Command {
  constructor() {
    super('tm-clear');
  }

  async execute() {
    if (self.qwenTM && self.qwenTM.clear) {
      await self.qwenTM.clear();
    }
    return { ok: true };
  }
}

class TMImportCommand extends Command {
  constructor() {
    super('tm-import');
  }

  async execute(msg) {
    const list = (msg && msg.entries && Array.isArray(msg.entries)) ? msg.entries : [];
    
    if (self.qwenTM && self.qwenTM.clear && self.qwenTM.set) {
      try {
        await self.qwenTM.clear();
        for (const item of list) {
          if (item && typeof item.k === 'string' && typeof item.text === 'string') {
            await self.qwenTM.set(item.k, item.text);
          }
        }
      } catch (error) {
        // Silently continue - matches original behavior
      }
    }
    return { ok: true };
  }
}

class TMCacheMetricsCommand extends Command {
  constructor() {
    super('tm-cache-metrics');
  }

  execute() {
    const tmMetrics = (self.qwenTM && self.qwenTM.stats) ? self.qwenTM.stats() : {};
    const cacheStats = self.qwenGetCacheStats ? self.qwenGetCacheStats() : {};
    return { tmMetrics, cacheStats };
  }
}

// Export all TM commands
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ClearRemoteTMCommand,
    TMGetAllCommand,
    TMStatsCommand,
    TMClearCommand,
    TMImportCommand,
    TMCacheMetricsCommand,
  };
} else {
  self.qwenTMCommands = {
    ClearRemoteTMCommand,
    TMGetAllCommand,
    TMStatsCommand,
    TMClearCommand,
    TMImportCommand,
    TMCacheMetricsCommand,
  };
}