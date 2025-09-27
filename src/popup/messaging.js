(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenPopupMessaging = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  // Resolve env without assuming require exists
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
      tabs: { query: async () => [], sendMessage: async () => null },
    });
  }

  const bridge = createChromeBridge();

  function withLastError(callback) {
    return function handler(result) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        if (typeof callback === 'function') callback(null, chrome.runtime.lastError);
        return;
      }
      if (typeof callback === 'function') callback(result, null);
    };
  }

  function sendMessage(message, options) {
    const payload = typeof message === 'string' ? { action: message, ...(options || {}) } : message;
    // Prefer native chrome.runtime if available for reliability
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      return new Promise(resolve => {
        try {
          chrome.runtime.sendMessage(payload, withLastError((result) => resolve(result ?? null)));
        } catch (e) {
          resolve(null);
        }
      });
    }
    // Fallback to bridge
    return bridge.sendMessage(payload, { expectResponse: true });
  }

  function sendMessageSync(message, callback) {
    const payload = typeof message === 'string' ? { action: message } : message;
    try {
      chrome.runtime.sendMessage(payload, withLastError((result, err) => {
        if (typeof callback === 'function') callback(result, err);
      }));
    } catch (error) {
      if (typeof callback === 'function') callback(null, error);
    }
  }

  async function queryActiveTab() {
    try {
      const tabs = await bridge.tabs.query({ active: true, currentWindow: true });
      return Array.isArray(tabs) ? tabs[0] : null;
    } catch {
      return null;
    }
  }

  async function sendMessageToTab(tabId, message) {
    try {
      return await bridge.tabs.sendMessage(tabId, message);
    } catch {
      return null;
    }
  }

  return {
    bridge,
    withLastError,
    sendMessage,
    sendMessageSync,
    queryActiveTab,
    sendMessageToTab,
  };
}));
