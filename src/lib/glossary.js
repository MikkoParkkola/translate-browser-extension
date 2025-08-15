(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenGlossary = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  let current = {};
  function extract(doc) {
    const map = {};
    if (!doc) return map;
    try {
      const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT, null);
      let node;
      const counts = Object.create(null);
      while ((node = walker.nextNode())) {
        const words = String(node.textContent || '').match(/\b[A-Za-z][A-Za-z0-9-]{2,}\b/g);
        if (!words) continue;
        for (const w of words) {
          const key = w.toLowerCase();
          counts[key] = counts[key] || { term: w, count: 0 };
          counts[key].count++;
        }
      }
      for (const k in counts) {
        if (counts[k].count >= 3) map[counts[k].term] = counts[k].term;
      }
    } catch {}
    return map;
  }
  function parse(doc, user = {}) {
    current = Object.assign({}, extract(doc), user || {});
    return current;
  }
  function set(map) { current = map || {}; }
  function get() { return current; }
  function apply(text, map = current) {
    if (!map || !text) return text;
    let out = String(text);
    for (const src in map) {
      if (!Object.prototype.hasOwnProperty.call(map, src)) continue;
      const dst = map[src];
      if (!src) continue;
      const re = new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      out = out.replace(re, dst);
    }
    return out;
  }
  return { extract, parse, apply, set, get };
}));
