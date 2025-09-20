(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenPopupStorage = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  // Resolve env both in browser and tests without assuming require exists
  let createChromeBridge;
  try {
    if (typeof window !== 'undefined' && window.qwenPopupEnv) {
      createChromeBridge = window.qwenPopupEnv.createChromeBridge;
    } else if (typeof self !== 'undefined' && self.qwenPopupEnv) {
      createChromeBridge = self.qwenPopupEnv.createChromeBridge;
    } else if (typeof require === 'function') {
      createChromeBridge = require('./env').createChromeBridge;
    }
  } catch (_) {}
  if (typeof createChromeBridge !== 'function') {
    createChromeBridge = () => ({
      async sendMessage() { return null; },
      storage: { sync: { get: async d => ({ ...(d||{}) }), set: async () => {}, }, local: { get: async () => ({}), set: async () => {} } },
      tabs: { query: async () => [], sendMessage: async () => null },
      runtime: { getURL: p => p },
    });
  }

  const bridge = createChromeBridge();

  async function loadPreferences(defaults) {
    const base = defaults || {};
    const syncValues = await bridge.storage.sync.get(base);
    let merged = { ...base, ...syncValues };

    if (bridge.storage.local && bridge.storage.local.get) {
      const localValues = await bridge.storage.local.get({});
      if (localValues && Object.keys(localValues).length) {
        merged = { ...merged, ...localValues };
      }
    }

    return merged;
  }

  function persistPreferences(partial) {
    if (!partial || typeof partial !== 'object') return Promise.resolve();

    const syncPromise = Promise.resolve(bridge.storage.sync.set(partial)).catch(() => {});
    // Best-effort direct call for tests/environments where bridge is a no-op
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync && typeof chrome.storage.sync.set === 'function') {
        chrome.storage.sync.set(partial, () => {});
      }
    } catch {}
    const localPromise = bridge.storage.local && bridge.storage.local.set
      ? Promise.resolve(bridge.storage.local.set(partial)).catch(() => {})
      : Promise.resolve();

    return Promise.all([syncPromise, localPromise]).then(() => undefined);
  }

  function savePreferences(partial) {
    return persistPreferences(partial);
  }

  async function saveAutoTranslate({ enabled, sourceLanguage, targetLanguage }) {
    const updates = {
      autoTranslate: !!enabled,
    };
    if (sourceLanguage) updates.sourceLanguage = sourceLanguage;
    if (targetLanguage) updates.targetLanguage = targetLanguage;

    await persistPreferences(updates);

    const message = {
      enabled: !!enabled,
      sourceLanguage: updates.sourceLanguage || 'auto',
      targetLanguage: updates.targetLanguage || 'en',
    };

    return bridge.sendMessage('home:auto-translate', message);
  }

  return { bridge, loadPreferences, savePreferences, saveAutoTranslate };
}));
