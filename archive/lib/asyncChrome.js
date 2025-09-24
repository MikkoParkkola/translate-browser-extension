(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenAsyncChrome = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function getRuntime() {
    if (typeof chrome === 'undefined') return null;
    return chrome.runtime || null;
  }

  function getStorageArea(area) {
    if (typeof chrome === 'undefined') return null;
    const storage = chrome.storage || {};
    return storage[area] || null;
  }

  function promisify(fn, args = [], fallback) {
    if (typeof fn !== 'function') {
      return typeof fallback === 'function' ? fallback() : fallback;
    }
    return new Promise((resolve) => {
      let resolved = false;
      const done = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };

      const callback = (result) => {
        if (chrome?.runtime?.lastError) {
          console.warn('[asyncChrome] operation lastError', chrome.runtime.lastError.message);
          return done(typeof fallback === 'function' ? fallback(chrome.runtime.lastError) : fallback);
        }
        done(result !== undefined ? result : typeof fallback === 'function' ? fallback() : fallback);
      };

      let returnValue;
      try {
        returnValue = fn(...args, callback);
      } catch (error) {
        console.warn('[asyncChrome] operation failed', error);
        return done(typeof fallback === 'function' ? fallback(error) : fallback);
      }

      if (returnValue && typeof returnValue.then === 'function') {
        returnValue
          .then((result) => {
            if (!resolved) done(result);
          })
          .catch((error) => {
            console.warn('[asyncChrome] operation promise rejected', error);
            if (!resolved) done(typeof fallback === 'function' ? fallback(error) : fallback);
          });
      } else if (fn.length === args.length) {
        queueMicrotask(() => {
          if (!resolved) done(typeof fallback === 'function' ? fallback() : fallback);
        });
      }
    });
  }

  async function sendMessage(action, payload = {}, { expectResponse = true } = {}) {
    const runtime = getRuntime();
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      return expectResponse ? null : undefined;
    }

    const message = typeof action === 'string'
      ? { action, ...payload }
      : action;

    return new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value ?? null);
      };

      const callback = (response) => {
        if (chrome?.runtime?.lastError) {
          console.warn('[asyncChrome] sendMessage lastError', chrome.runtime.lastError.message);
          return finish(null);
        }
        finish(response ?? null);
      };

      let result;
      try {
        result = runtime.sendMessage(message, callback);
      } catch (error) {
        console.warn('[asyncChrome] sendMessage error', error);
        finish(null);
        return;
      }

      if (result && typeof result.then === 'function') {
        result
          .then((response) => {
            if (!resolved) finish(response);
          })
          .catch((error) => {
            console.warn('[asyncChrome] sendMessage promise rejection', error);
            finish(null);
          });
      } else if (!expectResponse) {
        finish(null);
      }
    });
  }

  function makeStorage(area) {
    return {
      async get(defaults = {}) {
        const storageArea = getStorageArea(area);
        if (!storageArea || typeof storageArea.get !== 'function') {
          return { ...defaults };
        }
        const result = await promisify(storageArea.get.bind(storageArea), [defaults], defaults);
        return result || { ...defaults };
      },
      async set(values = {}) {
        const storageArea = getStorageArea(area);
        if (!storageArea || typeof storageArea.set !== 'function') return false;
        await promisify(storageArea.set.bind(storageArea), [values], false);
        return true;
      },
      async remove(keys) {
        const storageArea = getStorageArea(area);
        if (!storageArea || typeof storageArea.remove !== 'function') return false;
        await promisify(storageArea.remove.bind(storageArea), [keys], false);
        return true;
      }
    };
  }

  const api = {
    sendMessage,
    storage: {
      sync: makeStorage('sync'),
      local: makeStorage('local'),
      session: makeStorage('session'),
    },
    runtime: {
      getURL(path) {
        const runtime = getRuntime();
        if (!runtime || typeof runtime.getURL !== 'function') return path;
        try { return runtime.getURL(path); } catch { return path; }
      },
      connect(...args) {
        const runtime = getRuntime();
        if (!runtime || typeof runtime.connect !== 'function') return null;
        try { return runtime.connect(...args); } catch { return null; }
      },
    },
    tabs: {
      async query(queryInfo = {}) {
        if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
          return [];
        }
        return promisify(chrome.tabs.query.bind(chrome.tabs), [queryInfo], []);
      },
      async sendMessage(tabId, message, options) {
        if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
          return null;
        }
        return promisify(chrome.tabs.sendMessage.bind(chrome.tabs), [tabId, message, options || {}], null);
      }
    },
    isAvailable() {
      return typeof chrome !== 'undefined';
    }
  };

  return api;
}));
