/**
 * Testing/Diagnostics Commands
 * Provides explicit commands for validating provider connectivity (e.g., onboarding key test).
 */

(function () {
  if (typeof self.qwenTestingCommands !== 'undefined') return;
  if (typeof self.qwenCommandDispatcher === 'undefined') throw new Error('Command dispatcher not loaded');
  const { Command } = self.qwenCommandDispatcher;

  class TestTranslationCommand extends Command {
    constructor(handleTranslate, logger) {
      super('testTranslation', { handleTranslate, logger });
      this.handleTranslate = handleTranslate;
      this.logger = logger || console;
    }

    async execute(msg) {
      try {
        const { provider, apiKey, endpoint, model, text, source, target } = msg || {};
        if (!apiKey || typeof apiKey !== 'string') return { success: false, error: 'Missing API key' };
        const res = await this.handleTranslate({
          provider: provider || 'dashscope',
          apiKey: apiKey.trim(),
          endpoint,
          model: model || 'qwen-mt-turbo',
          text: text || 'Hello',
          source: source || 'en',
          target: target || 'es',
          stream: false,
          noProxy: true,
          debug: false,
        });
        if (res && !res.error && typeof res.text === 'string') {
          return { success: true, text: res.text, confidence: res.confidence || 0.9 };
        }
        return { success: false, error: res?.error || 'Unknown error' };
      } catch (e) {
        return { success: false, error: e?.message || 'Service not available' };
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TestTranslationCommand };
  } else {
    self.qwenTestingCommands = { TestTranslationCommand };
  }
})();

