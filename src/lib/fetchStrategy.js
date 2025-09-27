(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenFetchStrategy = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  function isOffline() {
    try {
      return typeof navigator !== 'undefined' && navigator.onLine === false;
    } catch {
      return false;
    }
  }

  function isLocalProvider(provider) {
    if (!provider) return false;
    const name = String(provider).toLowerCase();
    return name.includes('local') || name.includes('offline') || name.includes('wasm');
  }

  function defaultChooser(opts = {}) {
    if (opts.noProxy) return 'direct';
    if (isOffline() || isLocalProvider(opts.provider)) return 'local';
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        return 'direct';
      }
    } catch {
      return 'direct';
    }
    return 'proxy';
  }

  let chooser = defaultChooser;

  function choose(opts = {}) {
    try {
      return chooser(opts) || 'proxy';
    } catch {
      return defaultChooser(opts);
    }
  }

  function setChooser(fn) {
    if (typeof fn === 'function') {
      chooser = fn;
    }
  }

  return { choose, setChooser };
}));
