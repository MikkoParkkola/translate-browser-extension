/**
 * Translation Command - Handles translation requests
 * 
 * This is the core translation command that processes translation requests
 * from content scripts and popups.
 */

(function() {
  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this);
  if (root.qwenTranslationCommand) {
    return;
  }

  function resolveDispatcher() {
    if (root.qwenCommandDispatcher && root.qwenCommandDispatcher.Command) {
      return root.qwenCommandDispatcher;
    }
    if (typeof require === 'function') {
      try {
        const mod = require('../core/command-dispatcher');
        if (mod && mod.Command) {
          if (!root.qwenCommandDispatcher) {
            root.qwenCommandDispatcher = mod;
          }
          return mod;
        }
      } catch (error) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('translation-command: dispatcher require failed', error);
        }
      }
    }
    return null;
  }

  function register(dispatcherModule) {
    if (!dispatcherModule || !dispatcherModule.Command) {
      return;
    }
    const { Command } = dispatcherModule;

    class TranslationCommand extends Command {
      constructor(handleTranslate, logger) {
        super('translate', { handleTranslate, logger });
        this.handleTranslate = handleTranslate;
        this.logger = logger;
      }

      async execute(msg) {
        if (!this.handleTranslate) {
          throw new Error('Translation handler not available');
        }

        try {
          const result = await this.handleTranslate(msg.opts);
          return result;
        } catch (error) {
          this.logger?.error('Translation command failed:', error);
          throw new Error('Translation request failed');
        }
      }
    }

    if (typeof module !== 'undefined' && module.exports) {
      module.exports = TranslationCommand;
    } else {
      root.qwenTranslationCommand = TranslationCommand;
    }
  }

  const dispatcherModule = resolveDispatcher();
  if (dispatcherModule) {
    register(dispatcherModule);
    return;
  }

  const queueOwner = root;
  queueOwner.__pendingCommandModules = queueOwner.__pendingCommandModules || [];
  queueOwner.__pendingCommandModules.push(register);
})(); // End of IIFE