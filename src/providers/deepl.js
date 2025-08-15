(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenProviderDeepL = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:deepl') : console;
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
  function withSlash(u) { return /\/$/.test(u) ? u : (u + '/'); }

  async function translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
    if (!fetchFn) throw new Error('fetch not available');
    // DeepL does not support SSE streaming for /translate; we return once
    const base = withSlash(endpoint || 'https://api.deepl.com/v2');
    const url = base + 'translate';

    const params = new URLSearchParams();
    params.set('text', text);
    if (target) params.set('target_lang', String(target).toUpperCase());
    if (source) params.set('source_lang', String(source).toUpperCase());

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const key = (apiKey || '').trim();
    if (key) headers.Authorization = /^deepl-auth-key\s/i.test(key) ? key : `DeepL-Auth-Key ${key}`;

    if (debug) {
      logger.debug('sending translation request to', url);
      logger.debug('request params', { source, target });
    }

    const resp = await fetchFn(url, { method: 'POST', headers, body: params, signal });
    if (!resp.ok) {
      let msg = resp.statusText;
      try { const err = await resp.json(); msg = err.message || err.message_detail || msg; } catch {}
      const error = new Error(`HTTP ${resp.status}: ${msg}`);
      error.status = resp.status;
      if (resp.status >= 500 || resp.status === 429) {
        error.retryable = true;
        const ra = resp.headers.get('retry-after');
        if (ra) {
          const ms = parseInt(ra, 10) * 1000;
          if (ms > 0) error.retryAfter = ms;
        }
        if (resp.status === 429 && !error.retryAfter) error.retryAfter = 60000;
      }
      throw error;
    }

    const data = await resp.json();
    const out = data && data.translations && data.translations[0] && data.translations[0].text;
    if (!out) throw new Error('Invalid API response');
    return { text: out };
  }

  // Register into provider registry if available
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register) reg.register('deepl', { translate });
  } catch {}
  return { translate };
}));
