/**
 * Translation Command - Handles translation requests
 * 
 * This is the core translation command that processes translation requests
 * from content scripts and popups.
 */

if (typeof self.qwenCommandDispatcher === 'undefined') {
  throw new Error('Command dispatcher not loaded');
}

const { Command } = self.qwenCommandDispatcher;

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

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationCommand;
} else {
  self.qwenTranslationCommand = TranslationCommand;
}