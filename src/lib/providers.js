 (function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenProviders = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  function createRegistry() {
    const map = new Map();
    let initialized = false;
    function register(id, impl) { if (id && impl) map.set(String(id), impl); }
    function get(id) { return map.get(String(id)); }
    function init(def = {}) {
      if (initialized) return false;
      initialized = true;
      for (const [id, impl] of Object.entries(def)) {
        if (!map.has(id)) register(id, impl);
      }
      return true;
    }
    function reset() {
      map.clear();
      initialized = false;
    }
    function isInitialized() { return initialized; }
    function choose(opts = {}) {
      if (opts.provider) return String(opts.provider);
      const ep = String(opts.endpoint || '').toLowerCase();
      if (ep.includes('openai')) return 'openai';
      if (ep.includes('deepl')) return 'deepl';
      if (ep.includes('dashscope')) return 'dashscope';
      if (ep.includes('google')) return 'google';
      return 'dashscope';
    }
    function candidates(opts = {}) {
      const first = choose(opts);
      const all = Array.from(map.keys());
      const arr = map.has(first) ? [first, ...all] : all;
      const uniq = new Set(arr);
      return Array.from(uniq).filter(Boolean);
    }
    return { register, get, getProvider: get, choose, candidates, init, initProviders: init, reset, isInitialized };
  }
  const api = createRegistry();
  return Object.assign({ createRegistry }, api);
}));
