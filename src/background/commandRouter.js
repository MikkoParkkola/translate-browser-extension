(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenCommandRouter = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  function createCommandRouter(deps) {
    const {
      commandDispatcher,
      errorHandler,
      validateBasicMessageSecurity,
      validateTranslationSecurity,
      messageRateLimit,
      fallbackHandlers = {},
      ensureTestState = () => ({}),
      logger = console,
    } = deps || {};

    return function commandRouter(raw, sender, sendResponse) {
      if (!raw || typeof raw !== 'object') {
        sendResponse({ error: 'Invalid request' });
        return true;
      }

      const securityResult = errorHandler.safe(() => {
        const basicValidation = validateBasicMessageSecurity(sender, raw);
        if (!basicValidation.ok) return basicValidation;

        const translationValidation = validateTranslationSecurity(raw, sender);
        if (!translationValidation.ok) return translationValidation;

        return { ok: true, msg: raw };
      }, { operation: 'securityValidation', module: 'background' }, { ok: false, error: 'Security validation failed' }, logger)();

      if (!securityResult.ok) {
        sendResponse({ error: securityResult.error });
        return true;
      }

      const validationResult = errorHandler.safe(() => {
        return (self.qwenMessaging && self.qwenMessaging.validateMessage)
          ? self.qwenMessaging.validateMessage(securityResult.msg)
          : { ok: true, msg: securityResult.msg };
      }, { operation: 'validateMessage', module: 'background' }, { ok: false, error: 'Message validation failed' }, logger)();

      if (!validationResult.ok) {
        sendResponse({ error: validationResult.error || 'invalid message' });
        return true;
      }

      const msg = validationResult.msg;

      const rateLimitOk = messageRateLimit(sender?.tab?.url || sender?.id || 'unknown');
      if (!rateLimitOk) {
        sendResponse({ error: 'Rate limit exceeded' });
        return true;
      }

      if (commandDispatcher) {
        commandDispatcher.handleMessage(msg, sender, sendResponse);
        return true;
      }

      const state = ensureTestState();
      const handler = fallbackHandlers[msg.action];
      if (typeof handler !== 'function') {
        logger.error('Command dispatcher not initialized and no fallback for action:', msg.action);
        sendResponse({ error: 'Service not available' });
        return true;
      }

      Promise.resolve(handler({ msg, sender, state }))
        .then(result => {
          if (result === undefined) {
            sendResponse({ ok: true });
          } else {
            sendResponse(result);
          }
        })
        .catch(error => {
          logger.error('Fallback handler failed', error);
          sendResponse({ error: error?.message || 'Service not available' });
        });

      return true;
    };
  }

  return { createCommandRouter };
}));
