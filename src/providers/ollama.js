(function (root, factory) {
  const provider = factory(root);
  if (typeof window !== 'undefined') window.qwenProviderOllama = provider;
  else if (typeof self !== 'undefined') self.qwenProviderOllama = provider;
  if (typeof module !== 'undefined') module.exports = provider;
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
      error.status = resp.status; error.code = `HTTP_${resp.status}`;
      const ra = resp.headers && resp.headers.get && resp.headers.get('retry-after');
      if (ra) { let ms = Number(ra) * 1000; if (!Number.isFinite(ms)) { const t = Date.parse(ra); if (Number.isFinite(t)) ms = Math.max(0, t - Date.now()); } if (Number.isFinite(ms)) error.retryAfter = Math.max(100, Math.min(ms, 60000)); }
      if (resp.status === 401 || resp.status === 403) error.retryable = false; else if (resp.status === 429 || resp.status >= 500) error.retryable = true; else error.retryable = false;
      if (resp.status === 429 && !error.retryAfter) error.retryAfter = 60000;
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

  async function listModels({ endpoint, signal } = {}) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint || 'http://localhost:11434');
    const url = base + 'api/tags';
    const resp = await fetchFn(url, { signal });
    if (!resp.ok) { const e = new Error(`HTTP ${resp.status}: ${resp.statusText}`); e.status = resp.status; e.code = `HTTP_${resp.status}`; throw e; }
    const data = await resp.json();
    return (data.models || []).map(m => m.name).filter(Boolean);
  }

  async function capabilities(opts = {}) {
    try {
      const models = await listModels(opts);
      return { models, status: 'ok' };
    } catch (e) {
      return { models: [], status: e.message };
    }
  }

  const provider = { translate, listModels, capabilities, throttle: { requestLimit: 60, windowMs: 60000 } };
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register && !reg.get('ollama')) reg.register('ollama', provider);
  } catch {}
  return provider;
}));
