(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenBatchDelim = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  function makeDelimiter() {
    return `<<<QWEN_SPLIT_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}>>>`;
  }

  function splitSentences(text) {
    const s = String(text || '');
    const matches = s.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
    return matches ? matches.map(t => t.trim()) : [s.trim()];
  }

  function joinBatch(sentences) {
    const delimiter = makeDelimiter();
    return { text: sentences.join(delimiter), delimiter };
  }

  function createBatches(texts, maxTokens = 4000, approx = t => Math.ceil(t.length / 4)) {
    const all = [];
    texts.forEach(t => all.push(...splitSentences(t)));
    const batches = [];
    let current = [];
    let tokens = 0;
    all.forEach(sent => {
      const tok = approx(sent);
      if (current.length && tokens + tok > maxTokens) {
        batches.push(joinBatch(current));
        current = [];
        tokens = 0;
      }
      current.push(sent);
      tokens += tok;
    });
    if (current.length) batches.push(joinBatch(current));
    return batches;
  }

  return { makeDelimiter, splitSentences, createBatches };
}));
