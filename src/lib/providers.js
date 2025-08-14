(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenProviders = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const map = new Map();
  function register(id, impl) { if (id && impl) map.set(String(id), impl); }
  function get(id) { return map.get(String(id)); }
  function choose(opts = {}) {
    if (opts.provider) return String(opts.provider);
    const ep = String(opts.endpoint || '').toLowerCase();
    if (ep.includes('dashscope')) return 'dashscope';
    return 'dashscope';
  }
  return { register, get, choose };
}));
