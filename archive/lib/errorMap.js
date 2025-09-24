(function(root){
  function classify(err){
    const code = (err && (err.code || err.status)) || 0;
    const msg = (err && err.message) || '';
    if (code === 401 || code === 403) return { key:'auth', text:'Authentication issue. Check your API key.' };
    if (code === 429) return { key:'rate', text:'Rate limited. Please retry in a moment.' };
    if (code >= 500 && code < 600) return { key:'provider', text:'Provider unavailable. Try again shortly.' };
    if (/(timeout|timed\s*out|abort)/i.test(msg)) return { key:'timeout', text:'Request timed out. Retry or switch provider.' };
    if (/offline|network/i.test(msg)) return { key:'offline', text:'You appear offline. Check your connection.' };
    return { key:'generic', text:'Translation failed. Please try again.' };
  }
  const api = { classify };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.qwenErrorMap = api;
  else if (typeof self !== 'undefined') self.qwenErrorMap = api;
})(typeof self !== 'undefined' ? self : this);
