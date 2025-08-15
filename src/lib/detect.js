(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenDetect = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  function detectLocal(text, { sensitivity = 0, minLength = 0 } = {}) {
    const s = String(text || '');
    const total = s.replace(/\s+/g, '').length;
    if (total < minLength) return { lang: 'en', confidence: 0 };
    const counts = {
      ja: (s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length,
      ko: (s.match(/[\uac00-\ud7af]/g) || []).length,
      ru: (s.match(/[\u0400-\u04FF]/g) || []).length,
      ar: (s.match(/[\u0600-\u06FF]/g) || []).length,
      hi: (s.match(/[\u0900-\u097F]/g) || []).length,
      en: (s.match(/[A-Za-z]/g) || []).length,
    };
    let best = 'en', max = 0;
    for (const [k, v] of Object.entries(counts)) { if (v > max) { max = v; best = k; } }
    const confidence = total ? Math.min(1, max / total) : 0;
    if (confidence < sensitivity) return { lang: 'en', confidence };
    return { lang: best, confidence };
  }
  return { detectLocal };
}));
