(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenProviderMacOS = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  async function translate({ text, source, target }) {
    const handler = root && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.translate;
    if (!handler || typeof handler.postMessage !== 'function') {
      throw new Error('macOS translate handler not available');
    }
    return handler.postMessage({ text, source, target });
  }
  async function capabilities() {
    const handler = root && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.translate;
    if (handler && typeof handler.postMessage === 'function') {
      return { models: [], status: 'ok' };
    }
    return { models: [], status: 'handler not available' };
  }
  const provider = { translate, capabilities, configFields: [] };
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register && !reg.get('macos')) reg.register('macos', { ...provider, label: 'macOS' });
  } catch {}
  return provider;
}));
