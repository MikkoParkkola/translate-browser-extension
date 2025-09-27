(function (root, factory) {
  const provider = factory(root);
  if (typeof window !== 'undefined') window.qwenProviderGoogleFree = provider;
  else if (typeof self !== 'undefined') self.qwenProviderGoogleFree = provider;
  if (typeof module !== 'undefined') module.exports = provider;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create)
    ? root.qwenLogger.create('provider:google-free')
    : console;

  function getFetch() {
    if (typeof fetch !== 'undefined') return fetch;
    if (root && typeof root.fetch === 'function') return root.fetch;
    if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
      return globalThis.fetch;
    }
    return null;
  }

  async function translate({ text, source, target, debug }) {
    const fetchFn = getFetch();
    if (!fetchFn) {
      throw new Error('Fetch not available');
    }

    const src = source && source !== 'auto' ? source : 'auto';
    const tgt = target || 'en';

    const params = new URLSearchParams({
      client: 'gtx',
      sl: src,
      tl: tgt,
      dt: 't',
      q: text,
    });

    const url = `https://translate.googleapis.com/translate_a/single?${params}`;
    if (debug) logger.debug('Requesting google-free translation', { url });

    let resp;
    try {
      resp = await fetchFn(url, {
        method: 'GET',
        credentials: 'omit',
        headers: { 'Accept': 'application/json, text/plain, */*' },
      });
    } catch (error) {
      error.retryable = true;
      throw error;
    }

    if (!resp.ok) {
      const error = new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      error.status = resp.status;
      error.code = `HTTP_${resp.status}`;
      if (resp.status >= 500 || resp.status === 429) error.retryable = true;
      throw error;
    }

    const data = await resp.json();
    // Response format: [[["translated text","original",null,null,1]],null,"en",...]
    const translated = Array.isArray(data)
      ? data[0]?.map(row => row[0]).join('')
      : '';

    if (!translated) {
      throw new Error('Empty translation result');
    }

    return { text: translated, detectedLanguage: data[2] };
  }

  return {
    label: 'Google (public)',
    translate,
    throttle: { requestLimit: 5, windowMs: 1000 },
  };
}));
