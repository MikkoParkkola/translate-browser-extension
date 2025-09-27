(function (root, factory) {
  const provider = factory(root);
  if (typeof window !== 'undefined') window.qwenProviderDeepL = provider;
  else if (typeof self !== 'undefined') self.qwenProviderDeepL = provider;
  if (typeof module !== 'undefined') module.exports = provider;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:deepl') : console;
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
  const errorHandler = (root.qwenProviderErrorHandler) || 
                      (typeof require !== 'undefined' ? require('../core/provider-error-handler') : null);
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
    let resp;
    try {
      resp = await fetchFn(url, { method: 'POST', headers, body: params.toString(), signal });
    } catch (error) {
      if (errorHandler) {
        errorHandler.handleNetworkError(error, { provider: 'deepl', logger, endpoint });
      }
      throw error;
    }
    if (!resp.ok) {
      if (errorHandler) {
        await errorHandler.handleHttpError(resp, { provider: 'deepl', logger, endpoint });
      }
      // Fallback error handling
      let msg = resp.statusText;
      try { const err = await resp.json(); msg = err.message || err.message_detail || msg; } catch {}
      const error = new Error(`HTTP ${resp.status}: ${msg}`);
      error.status = resp.status; error.code = `HTTP_${resp.status}`;
      const ra = resp.headers && resp.headers.get && resp.headers.get('retry-after');
      if (ra) {
        let ms = Number(ra) * 1000; if (!Number.isFinite(ms)) { const t = Date.parse(ra); if (Number.isFinite(t)) ms = Math.max(0, t - Date.now()); }
        if (Number.isFinite(ms)) error.retryAfter = Math.max(100, Math.min(ms, 60000));
      }
      if (resp.status === 401 || resp.status === 403) error.retryable = false;
      else if (resp.status === 429 || resp.status >= 500) error.retryable = true;
      else error.retryable = false;
      if (resp.status === 429 && !error.retryAfter) error.retryAfter = 60000;
      throw error;
    }
    const data = await resp.json();
    const out = data && data.translations && data.translations[0] && data.translations[0].text;
    if (!out) {
      if (errorHandler) {
        errorHandler.handleResponseError('Invalid API response: missing translation text', 
          { provider: 'deepl', logger, response: data });
      }
      throw new Error('Invalid API response');
    }
    const usage = resp.headers.get('x-deepl-usage');
    let characters;
    if (usage) {
      const m = usage.match(/(\d+)\/(\d+)/);
      if (m) characters = { used: parseInt(m[1], 10), limit: parseInt(m[2], 10) };
    }
    return { text: out, characters };
  }

    function makeProvider(ep) {
      const wrappedTranslate = errorHandler ? 
        errorHandler.wrapProviderOperation(
          opts => translate({ ...opts, endpoint: ep || opts.endpoint }), 
          { provider: 'deepl', logger }
        ) : opts => translate({ ...opts, endpoint: ep || opts.endpoint });

      return {
        translate: wrappedTranslate,
        label: 'DeepL',
        configFields: ['apiKey', 'apiEndpoint'],
        throttle: { requestLimit: 15, windowMs: 1000 },
      };
    }

    const basic = makeProvider('https://api-free.deepl.com/');
    const free = makeProvider('https://api-free.deepl.com/');
    const pro = makeProvider('https://api.deepl.com/');
    const provider = { translate, basic, free, pro };
    try {
      const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
      if (reg && reg.register) {
        if (!reg.get('deepl')) reg.register('deepl', provider.basic);
        if (!reg.get('deepl-free')) reg.register('deepl-free', provider.free);
        if (!reg.get('deepl-pro')) reg.register('deepl-pro', provider.pro);
      }
    } catch {}
    return provider;
  }));
