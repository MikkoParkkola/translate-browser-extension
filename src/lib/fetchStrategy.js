(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenFetchStrategy = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  function defaultChooser(opts = {}) {
    if (opts.noProxy) return 'direct';
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) return 'direct';
    } catch {}
    return 'proxy';
  }
  let chooser = defaultChooser;
  function choose(opts = {}) { return chooser(opts); }
  function setChooser(fn) {
    chooser = typeof fn === 'function' ? fn : defaultChooser;
  }
  return { choose, setChooser };
}));
