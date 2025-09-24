(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenPopupEnv = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  const storageDefaults = defaults => ({
    async get(fallback = defaults || {}) { return { ...fallback }; },
    async set() { return false; },
    async remove() { return false; },
    async clear() { return false; },
  });

  const fallbackChrome = {
    async sendMessage() { return null; },
    storage: {
      local: storageDefaults({}),
      sync: storageDefaults({}),
      session: storageDefaults({}),
    },
    tabs: {
      async query() { return []; },
      async sendMessage() { return null; },
    },
    runtime: {
      getURL(path) { return path; },
      connect() { return null; },
    },
    isAvailable() { return false; },
  };

  let cachedAsyncChrome = undefined;

  function resolveAsyncChrome() {
    if (cachedAsyncChrome !== undefined) return cachedAsyncChrome;

    try {
      if (typeof window !== 'undefined' && window.qwenAsyncChrome) {
        cachedAsyncChrome = window.qwenAsyncChrome;
      } else if (typeof self !== 'undefined' && self.qwenAsyncChrome) {
        cachedAsyncChrome = self.qwenAsyncChrome;
      } else if (typeof require === 'function') {
        cachedAsyncChrome = require('../lib/asyncChrome');
      } else {
        cachedAsyncChrome = null;
      }
    } catch (error) {
      cachedAsyncChrome = null;
    }

    return cachedAsyncChrome;
  }

  function mergeStorage(baseStorage, overrideStorage) {
    if (!overrideStorage) return baseStorage;
    return {
      ...baseStorage,
      ...overrideStorage,
      local: { ...baseStorage.local, ...(overrideStorage.local || {}) },
      sync: { ...baseStorage.sync, ...(overrideStorage.sync || {}) },
      session: { ...baseStorage.session, ...(overrideStorage.session || {}) },
    };
  }

  function createChromeBridge() {
    const asyncChrome = resolveAsyncChrome();
    if (asyncChrome && typeof asyncChrome === 'object') {
      return {
        ...fallbackChrome,
        ...asyncChrome,
        storage: mergeStorage(fallbackChrome.storage, asyncChrome.storage),
        tabs: { ...fallbackChrome.tabs, ...(asyncChrome.tabs || {}) },
        runtime: { ...fallbackChrome.runtime, ...(asyncChrome.runtime || {}) },
      };
    }
    return fallbackChrome;
  }

  function createPopupLogger(scope) {
    const name = scope || 'popup';
    try {
      if (typeof window !== 'undefined' && window.qwenLogger && typeof window.qwenLogger.create === 'function') {
        return window.qwenLogger.create(name);
      }
      if (typeof self !== 'undefined' && self.qwenLogger && typeof self.qwenLogger.create === 'function') {
        return self.qwenLogger.create(name);
      }
    } catch (error) {
      // fall through to console
    }
    return console;
  }

  return {
    createChromeBridge,
    createPopupLogger,
    resolveAsyncChrome,
    fallbackChrome,
  };
}));
