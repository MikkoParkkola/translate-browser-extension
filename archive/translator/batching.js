;(function(root){
  let approxTokens = t => Math.max(1, Math.ceil(String(t||'').length / 4));
  try {
    if (typeof window !== 'undefined' && window.qwenThrottle) approxTokens = window.qwenThrottle.approxTokens;
    else if (typeof self !== 'undefined' && typeof window === 'undefined' && self.qwenThrottle) approxTokens = self.qwenThrottle.approxTokens;
    else if (typeof require !== 'undefined') approxTokens = require('../throttle').approxTokens;
  } catch {}

  function splitLongText(text, maxTokens){
    const parts = (text || '').split(/(?<=[\.?!])\s+/);
    const chunks = [];
    let cur = '';
    for (const part of parts) {
      const next = cur ? cur + ' ' + part : part;
      if (approxTokens(next) > maxTokens && cur) {
        chunks.push(cur);
        cur = part;
      } else {
        cur = next;
      }
    }
    if (cur) chunks.push(cur);
    const out = [];
    for (const ch of chunks) {
      if (approxTokens(ch) <= maxTokens) {
        out.push(ch);
      } else {
        let start = 0;
        const step = Math.max(128, Math.floor(maxTokens * 4));
        while (start < ch.length) {
          out.push(ch.slice(start, start + step));
          start += step;
        }
      }
    }
    return out;
  }

  const api = { splitLongText };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') root.qwenBatching = Object.assign(root.qwenBatching||{}, api);
  else if (typeof self !== 'undefined') self.qwenBatching = Object.assign(self.qwenBatching||{}, api);
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));

