(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenBackgroundStorage = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  function getNativeChrome() {
    if (typeof chrome !== 'undefined') return chrome;
    return null;
  }

  function areaFromAsync(asyncChrome, area) {
    if (!asyncChrome || !asyncChrome.storage) return null;
    return asyncChrome.storage[area] || null;
  }

  function areaFromNative(nativeChrome, area) {
    if (!nativeChrome || !nativeChrome.storage) return null;
    return nativeChrome.storage[area] || null;
  }

  function createStorage(asyncChrome) {
    const nativeChrome = getNativeChrome();

    async function get(area, defaults) {
      const fallback = { ...(defaults || {}) };
      const asyncArea = areaFromAsync(asyncChrome, area);
      if (asyncArea && typeof asyncArea.get === 'function') {
        try {
          const result = await asyncArea.get(defaults || {});
          return result || fallback;
        } catch {
          return fallback;
        }
      }

      const nativeArea = areaFromNative(nativeChrome, area);
      if (nativeArea && typeof nativeArea.get === 'function') {
        return new Promise(resolve => {
          try {
            nativeArea.get(defaults || {}, value => {
              if (nativeChrome?.runtime?.lastError) {
                resolve(fallback);
              } else {
                resolve(value || fallback);
              }
            });
          } catch {
            resolve(fallback);
          }
        });
      }

      return Promise.resolve(fallback);
    }

    async function set(area, values) {
      const payload = values || {};
      const asyncArea = areaFromAsync(asyncChrome, area);
      if (asyncArea && typeof asyncArea.set === 'function') {
        try {
          await asyncArea.set(payload);
          return;
        } catch {
          // fall through to native attempt
        }
      }

      const nativeArea = areaFromNative(nativeChrome, area);
      if (nativeArea && typeof nativeArea.set === 'function') {
        return new Promise(resolve => {
          try {
            nativeArea.set(payload, () => {
              resolve();
            });
          } catch {
            resolve();
          }
        });
      }

      return Promise.resolve();
    }

    async function remove(area, keys) {
      const asyncArea = areaFromAsync(asyncChrome, area);
      if (asyncArea && typeof asyncArea.remove === 'function') {
        try {
          await asyncArea.remove(keys);
          return;
        } catch {
          // fall through
        }
      }

      const nativeArea = areaFromNative(nativeChrome, area);
      if (nativeArea && typeof nativeArea.remove === 'function') {
        return new Promise(resolve => {
          try {
            nativeArea.remove(keys, () => resolve());
          } catch {
            resolve();
          }
        });
      }

      return Promise.resolve();
    }

    async function merge(area, defaults, updates) {
      const current = await get(area, defaults || {});
      const next = { ...(current || {}), ...(updates || {}) };
      await set(area, next);
      return next;
    }

    return { get, set, remove, merge };
  }

  return { createStorage };
}));
