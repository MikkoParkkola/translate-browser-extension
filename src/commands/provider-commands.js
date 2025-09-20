/**
 * Provider Commands - Handle provider management and language detection
 * 
 * Manages translation providers, quota checks, and language detection functionality.
 */

(function() {
  // Prevent duplicate loading
  if (typeof self.qwenProviderCommands !== 'undefined') {
    return;
  }

  if (typeof self.qwenCommandDispatcher === 'undefined') {
    throw new Error('Command dispatcher not loaded');
  }

  const { Command } = self.qwenCommandDispatcher;

class GetProvidersCommand extends Command {
  constructor() {
    super('getProviders');
  }

  execute() {
    // Ensure providers are initialized
    if (self.qwenProviders && self.qwenProviders.ensureProviders) {
      self.qwenProviders.ensureProviders();
    }

    // Get list of available providers
    let providers = [];
    if (self.qwenProviders && self.qwenProviders.listProviders) {
      providers = self.qwenProviders.listProviders().map(p => ({
        id: p.name,
        name: p.label || p.name,
      }));
    } else {
      // Fallback to default providers
      providers = [
        { id: 'qwen', name: 'Qwen' },
        { id: 'google', name: 'Google' },
        { id: 'deepl', name: 'DeepL' },
        { id: 'openai', name: 'OpenAI' },
      ];
    }

    return { providers };
  }
}

class QuotaCommand extends Command {
  constructor(logger) {
    super('quota', { logger });
    this.logger = logger;
  }

  async execute(msg) {
    const model = msg.model;
    const cfg = self.qwenConfig || {};
    const prov = self.qwenProviders && self.qwenProviders.getProvider && self.qwenProviders.getProvider('qwen');
    
    if (prov && prov.getQuota) {
      try {
        const result = await prov.getQuota({
          endpoint: (cfg.providers && cfg.providers.qwen && cfg.providers.qwen.apiEndpoint) || cfg.apiEndpoint,
          apiKey: (cfg.providers && cfg.providers.qwen && cfg.providers.qwen.apiKey) || cfg.apiKey,
          model: model || cfg.model,
          debug: cfg.debug,
        });
        return result;
      } catch (err) {
        this.logger?.error('Quota check failed:', err);
        throw new Error(err.message);
      }
    }
    
    throw new Error('provider unavailable');
  }
}

class DetectCommand extends Command {
  constructor(googleDetectLanguage, localDetectLanguage) {
    super('detect', { googleDetectLanguage, localDetectLanguage });
    this.googleDetectLanguage = googleDetectLanguage;
    this.localDetectLanguage = localDetectLanguage;
  }

  async execute(msg) {
    try {
      const opts = msg.opts || {};
      const sample = String(opts.text || '');
      let out;
      
      if (sample.replace(/\s+/g, '').length < (opts.minLength || 0)) {
        out = { lang: undefined, confidence: 0 };
      } else {
        out = opts.detector === 'google'
          ? await this.googleDetectLanguage(opts.text, opts.debug)
          : this.localDetectLanguage(opts.text, opts.minLength);
      }
      
      return out;
    } catch (e) {
      throw new Error(e.message);
    }
  }
}

// Export all provider commands
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GetProvidersCommand,
    QuotaCommand,
    DetectCommand,
  };
} else {
  self.qwenProviderCommands = {
    GetProvidersCommand,
    QuotaCommand,
    DetectCommand,
  };
}

})(); // End of IIFE