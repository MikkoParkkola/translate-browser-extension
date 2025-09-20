/**
 * Command Registry - Initialize and register all commands with the dispatcher
 * 
 * This module is responsible for loading all command modules and registering
 * them with the CommandDispatcher, creating a centralized registry.
 */

/**
 * Initialize all commands and register them with the dispatcher
 * @param {CommandDispatcher} dispatcher - The command dispatcher instance
 * @param {Object} dependencies - Dependencies required by commands
 * @returns {Promise<void>}
 */
async function initializeCommands(dispatcher, dependencies) {
  const {
    // Core dependencies
    logger,
    errorHandler,
    
    // Translation dependencies
    handleTranslate,
    
    // System dependencies
    usageLog,
    securityAudit,
    
    // Configuration dependencies
    ensureThrottle,
    config,
    
    // Metrics dependencies
    cacheStats,
    tmStats,
    providersUsage,
    translationStatus,
    getCacheStats,
    getTranslationMemoryStats,
    getAggregatedStats,
    broadcastEta,
    broadcastStats,
    usageStats,
    
    // Language detection dependencies
    googleDetectLanguage,
    localDetectLanguage,
  } = dependencies;

  // Load and register translation commands
  if (self.qwenTranslationCommand) {
    const translationCommand = new self.qwenTranslationCommand(handleTranslate, logger);
    dispatcher.registerCommand('translate', translationCommand);
  }

  // Load and register system commands
  if (self.qwenSystemCommands) {
    const {
      PingCommand,
      DebugCommand,
      GetUsageLogCommand,
      GetSecurityAuditCommand,
    } = self.qwenSystemCommands;

    dispatcher.registerCommands({
      'ping': new PingCommand(logger),
      'debug': new DebugCommand(),
      'get-usage-log': new GetUsageLogCommand(usageLog),
      'get-security-audit': new GetSecurityAuditCommand(securityAudit),
    });
  }

  // Load and register configuration commands
  if (self.qwenConfigCommands) {
    const { SetConfigCommand } = self.qwenConfigCommands;
    dispatcher.registerCommand('set-config', new SetConfigCommand(ensureThrottle, config, logger));
  }

  // Load and register translation memory commands
  if (self.qwenTMCommands) {
    const {
      ClearRemoteTMCommand,
      TMGetAllCommand,
      TMStatsCommand,
      TMClearCommand,
      TMImportCommand,
      TMCacheMetricsCommand,
    } = self.qwenTMCommands;

    dispatcher.registerCommands({
      'clear-remote-tm': new ClearRemoteTMCommand(),
      'tm-get-all': new TMGetAllCommand(),
      'tm-stats': new TMStatsCommand(),
      'tm-clear': new TMClearCommand(),
      'tm-import': new TMImportCommand(),
      'tm-cache-metrics': new TMCacheMetricsCommand(),
    });
  }

  // Load and register metrics commands
  if (self.qwenMetricsCommands) {
    const {
      UsageCommand,
      MetricsCommand,
      MetricsV1Command,
      TranslationStatusCommand,
      GetStatusCommand,
    } = self.qwenMetricsCommands;

    dispatcher.registerCommands({
      'usage': new UsageCommand(ensureThrottle, usageStats),
      'metrics': new MetricsCommand(ensureThrottle, cacheStats, tmStats, providersUsage, translationStatus),
      'metrics-v1': new MetricsV1Command(ensureThrottle, getCacheStats, getTranslationMemoryStats, providersUsage, getAggregatedStats, translationStatus),
      'translation-status': new TranslationStatusCommand(broadcastEta, broadcastStats),
      'get-status': new GetStatusCommand(translationStatus),
    });
  }

  // Load and register provider commands
  if (self.qwenProviderCommands) {
    const {
      GetProvidersCommand,
      QuotaCommand,
      DetectCommand,
    } = self.qwenProviderCommands;

    dispatcher.registerCommands({
      'getProviders': new GetProvidersCommand(),
      'quota': new QuotaCommand(logger),
      'detect': new DetectCommand(googleDetectLanguage, localDetectLanguage),
    });
  }

  // Load and register testing/diagnostic commands
  if (self.qwenTestingCommands) {
    const { TestTranslationCommand } = self.qwenTestingCommands;
    dispatcher.registerCommand('testTranslation', new TestTranslationCommand(handleTranslate, logger));
  }

  // Bridge high-level actions to existing fallback handlers if available
  try {
    const { Command } = self.qwenCommandDispatcher || {};
    const fh = self.fallbackHandlers;
    if (Command && fh) {
      class ProxyCommand extends Command {
        constructor(action) { super(action, {}); this.action = action; }
        async execute(msg, sender) {
          const handler = fh[this.action];
          if (typeof handler !== 'function') return { error: `Service not available: ${this.action}` };
          return await handler({ msg, sender, state: (self.ensureTestState ? self.ensureTestState() : {}) });
        }
      }
      ['debug-info','home:init','home:quick-translate','home:auto-translate','permissions-check','permissions-request']
        .forEach(a => { try { dispatcher.registerCommand(a, new ProxyCommand(a)); } catch {} });
    }
  } catch {}

  logger?.info(`Command registry initialized with ${dispatcher.getRegisteredCommands().length} commands`);
}

/**
 * Create security validators for the command dispatcher
 * @param {Object} dependencies - Security validation dependencies
 * @returns {Array} - Array of security validator functions
 */
function createSecurityValidators(dependencies) {
  const { validateBasicMessageSecurity, validateTranslationSecurity } = dependencies;
  
  return [
    // Basic message security validation
    (sender, raw) => {
      if (validateBasicMessageSecurity) {
        return validateBasicMessageSecurity(sender, raw);
      }
      return { ok: true };
    },
    
    // Translation-specific security validation
    (sender, raw) => {
      if (validateTranslationSecurity) {
        return validateTranslationSecurity(raw, sender);
      }
      return { ok: true };
    },
    
    // Message structure validation
    (sender, raw) => {
      if (self.qwenMessaging && self.qwenMessaging.validateMessage) {
        return self.qwenMessaging.validateMessage(raw);
      }
      return { ok: true };
    },
  ];
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializeCommands, createSecurityValidators };
} else {
  self.qwenCommandRegistry = { initializeCommands, createSecurityValidators };
}
