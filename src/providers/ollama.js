(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenProviderOllama = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:ollama') : console;
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
  function withSlash(u) { return /\/$/.test(u) ? u : (u + '/'); }

  async function translate({ endpoint, model, text, source, target, signal, debug, onData, stream = true }) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint || 'http://localhost:11434');
    const url = base + 'api/generate';
    const prompt = `Translate the following text from ${source} to ${target}. Output only the translation.\n\n${text}`;
    const body = { model, prompt, stream: !!stream };
    const headers = { 'Content-Type': 'application/json' };

    if (debug) {
      logger.debug('sending translation request to', url);
      logger.debug('request params', { model, source, target });
    }

    let resp;
    try {
      resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      e.retryable = true;
      throw e;
    }

    if (!resp.ok) {
      let msg = resp.statusText;
      try { const err = await resp.json(); msg = err.error || err.message || msg; } catch {}
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

    if (!stream || !resp.body || typeof resp.body.getReader !== 'function') {
      const data = await resp.json();
      const out = data.response || '';
      if (!out) throw new Error('Invalid API response');
      return { text: out };
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          const chunk = obj.response || '';
          if (chunk) {
            result += chunk;
            if (onData) onData(chunk);
            if (debug) logger.debug('chunk received', chunk);
          }
          if (obj.done) { try { reader.cancel(); } catch {} break; }
        } catch {}
      }
    }
    return { text: result };
  }

  const provider = { translate, throttle: { requestLimit: 60, windowMs: 60000 } };
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register && !reg.get('ollama')) reg.register('ollama', provider);
  } catch {}
  return provider;
}));
