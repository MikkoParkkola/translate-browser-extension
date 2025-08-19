;(function(root){
  function normalizeText(t){
    const s = String(t == null ? '' : t);
    const collapsed = s.replace(/\s+/g, ' ').trim();
    try { return collapsed.normalize('NFC'); } catch { return collapsed; }
  }
  function makeCacheKey(source, target, text){
    return `${source}:${target}:${normalizeText(text)}`;
  }
  const api = { normalizeText, makeCacheKey };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') root.qwenCacheKey = Object.assign(root.qwenCacheKey||{}, api);
  else if (typeof self !== 'undefined') self.qwenCacheKey = Object.assign(self.qwenCacheKey||{}, api);
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));

