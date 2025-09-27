(function (root, factory) {
  const provider = factory(root);
  if (typeof window !== 'undefined') window.qwenProviderMacos = provider;
  else if (typeof self !== 'undefined') self.qwenProviderMacos = provider;
  if (typeof module !== 'undefined') module.exports = provider;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:macos') : console;
  const errorHandler = (root.qwenProviderErrorHandler) || 
                      (typeof require !== 'undefined' ? require('../core/provider-error-handler') : null);

  async function translate({ text, source, target }) {
    const handler = root && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.translate;
    if (!handler || typeof handler.postMessage !== 'function') {
      if (errorHandler) {
        errorHandler.handleResponseError('macOS translate handler not available', 
          { provider: 'macos', logger });
      }
      throw new Error('macOS translate handler not available');
    }
    try {
      return handler.postMessage({ text, source, target });
    } catch (error) {
      if (errorHandler) {
        errorHandler.handleNetworkError(error, { provider: 'macos', logger });
      }
      throw error;
    }
  }
  async function capabilities() {
    const handler = root && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.translate;
    if (handler && typeof handler.postMessage === 'function') {
      return { models: [], status: 'ok' };
    }
    return { models: [], status: 'handler not available' };
  }
  // Wrap main functions with standardized error handling
  const wrappedTranslate = errorHandler ? 
    errorHandler.wrapProviderOperation(translate, { provider: 'macos', logger }) : translate;
  const wrappedCapabilities = errorHandler ? 
    errorHandler.wrapProviderOperation(capabilities, { provider: 'macos', logger }) : capabilities;

  const provider = { 
    translate: wrappedTranslate, 
    capabilities: wrappedCapabilities, 
    configFields: [] 
  };
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register && !reg.get('macos')) reg.register('macos', { ...provider, label: 'macOS' });
  } catch {}
  return provider;
}));
