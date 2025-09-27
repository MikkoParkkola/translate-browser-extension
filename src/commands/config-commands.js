/**
 * Configuration Commands - Handle configuration updates and management
 * 
 * Manages extension configuration including cache limits, quality verification,
 * timeout settings, and translation memory sync.
 */

(function() {
  // Prevent duplicate loading
  if (typeof self.qwenConfigCommands !== 'undefined') {
    return;
  }

  if (typeof self.qwenCommandDispatcher === 'undefined') {
    throw new Error('Command dispatcher not loaded');
  }

  const { Command } = self.qwenCommandDispatcher;

class SetConfigCommand extends Command {
  constructor(ensureThrottle, config, logger) {
    super('set-config', { ensureThrottle, config, logger });
    this.ensureThrottle = ensureThrottle;
    this.config = config;
    this.logger = logger;
  }

  async execute(msg) {
    const c = msg.config || {};
    
    try {
      // Memory cache configuration
      if (typeof c.memCacheMax === 'number' && c.memCacheMax > 0) {
        self.qwenConfig = self.qwenConfig || {};
        self.qwenConfig.memCacheMax = c.memCacheMax;
      }

      // Throttling configuration
      if (typeof c.requestLimit === 'number' || typeof c.tokenLimit === 'number') {
        await this.ensureThrottle();
        const opts = {};
        if (typeof c.requestLimit === 'number') opts.requestLimit = c.requestLimit;
        if (typeof c.tokenLimit === 'number') opts.tokenLimit = c.tokenLimit;
        self.qwenThrottle.configure(opts);
      }

      // Quality verification setting
      if (typeof c.qualityVerify === 'boolean') {
        this.config.qualityVerify = c.qualityVerify;
      }

      // Translation timeout setting
      if (typeof c.translateTimeoutMs === 'number') {
        this.config.translateTimeoutMs = c.translateTimeoutMs;
      }

      // Translation memory sync setting
      if (typeof c.tmSync === 'boolean' && self.qwenTM && self.qwenTM.enableSync) {
        self.qwenTM.enableSync(c.tmSync);
      }

      return { ok: true };
    } catch (error) {
      this.logger?.error('Set config failed:', error);
      throw new Error('Configuration update failed');
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SetConfigCommand };
} else {
  self.qwenConfigCommands = { SetConfigCommand };
}

})(); // End of IIFE