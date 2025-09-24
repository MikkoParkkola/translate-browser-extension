(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenStorageHelpers = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  function createStorage(asyncChrome) {
    const nativeChrome = typeof chrome !== 'undefined' ? chrome : null;

    const get = (area, defaults) => {
      const fallback = { ...(defaults || {}) };
      const asyncArea = asyncChrome?.storage?.[area];
      if (asyncArea && typeof asyncArea.get === 'function') {
        return asyncArea.get(defaults || {}).catch(() => fallback);
      }

      const nativeArea = nativeChrome?.storage?.[area];
      if (nativeArea && typeof nativeArea.get === 'function') {
        return new Promise(resolve => {
          try {
            nativeArea.get(defaults || {}, value => {
              if (nativeChrome?.runtime?.lastError) resolve(fallback);
              else resolve(value || fallback);
            });
          } catch {
            resolve(fallback);
          }
        });
      }

      return Promise.resolve(fallback);
    };

    const set = (area, values) => {
      const payload = values || {};
      const asyncArea = asyncChrome?.storage?.[area];
      if (asyncArea && typeof asyncArea.set === 'function') {
        return asyncArea.set(payload).catch(() => {});
      }

      const nativeArea = nativeChrome?.storage?.[area];
      if (nativeArea && typeof nativeArea.set === 'function') {
        return new Promise(resolve => {
          try { nativeArea.set(payload, () => resolve()); } catch { resolve(); }
        });
      }

      return Promise.resolve();
    };

    return { get, set };
  }

  return { createStorage };
}));
