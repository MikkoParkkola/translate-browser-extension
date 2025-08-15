(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenProviderDeepL = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
    function withSlash(u) { return /\/$/.test(u) ? u : u + '/'; }

  async function translate({ endpoint = 'https://api.deepl.com/', apiKey, text, source, target, signal, debug }) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint) + 'v2/';
    const url = base + 'translate';
    const params = new URLSearchParams();
    params.append('text', text);
    if (source) params.append('source_lang', String(source).toUpperCase());
    if (target) params.append('target_lang', String(target).toUpperCase());
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const key = (apiKey || '').trim();
    if (key) headers.Authorization = /^deepl-auth-key\s/i.test(key) ? key : `DeepL-Auth-Key ${key}`;
    const resp = await fetchFn(url, { method: 'POST', headers, body: params.toString(), signal });
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
    const usage = resp.headers.get('x-deepl-usage');
    let characters;
    if (usage) {
      const m = usage.match(/(\d+)\/(\d+)/);
      if (m) characters = { used: parseInt(m[1], 10), limit: parseInt(m[2], 10) };
    }
    return { text: out, characters };
  }

    function makeProvider(ep) {
      return {
        translate: opts => translate({ ...opts, endpoint: ep || opts.endpoint }),
        label: 'DeepL',
        configFields: ['apiKey', 'apiEndpoint', 'model'],
        throttle: { requestLimit: 15, windowMs: 1000 },
      };
    }

    const basic = makeProvider('https://api-free.deepl.com/');
    const free = makeProvider('https://api-free.deepl.com/');
    const pro = makeProvider('https://api.deepl.com/');

    return { translate, basic, free, pro };
  }));

