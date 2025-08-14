(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenBatchDelim = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  function makeDelimiter() {
    return `<<<QWEN_SPLIT_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}>>>`;
  }
  return { makeDelimiter };
}));
