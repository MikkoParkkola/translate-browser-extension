(function (root, factory) {
  const provider = factory(root);
  if (typeof window !== 'undefined') window.qwenProviderGemini = provider;
  else if (typeof self !== 'undefined') self.qwenProviderGemini = provider;
  if (typeof module !== 'undefined') module.exports = provider;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:gemini') : console;
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
  function withSlash(u) { return /\/$/.test(u) ? u : (u + '/'); }

  async function translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint || 'https://generativelanguage.googleapis.com/v1beta');
    const path = `models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;
    const key = (apiKey || '').trim();
    const url = `${base}${path}?${key ? `key=${encodeURIComponent(key)}&` : ''}${stream ? 'alt=sse' : ''}`.replace(/[?&]$/, '');

    const sys = `You are a professional translator. Translate the user message from ${source} to ${target}. Output only the translation, no explanations.`;
    const body = {
      contents: [{ role: 'user', parts: [{ text }]}],
      systemInstruction: { parts: [{ text: sys }] },
    };
    const headers = { 'Content-Type': 'application/json' };

    if (debug) {
      logger.debug('sending translation request to', url);
      logger.debug('request params', { model, source, target });
    }

    const resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!resp.ok) {
      let msg = resp.statusText;
      try { const err = await resp.json(); msg = err.error?.message || msg; } catch {}
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
      const out = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!out) throw new Error('Invalid API response');
      return { text: out };
    }

    // streaming SSE
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
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (debug) logger.debug('raw line', data);
        if (data === '[DONE]') { try { reader.cancel(); } catch {} break; }
        try {
          const obj = JSON.parse(data);
          const chunk = obj.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (chunk) {
            result += chunk;
            if (onData) onData(chunk);
            if (debug) logger.debug('chunk received', chunk);
          }
        } catch {}
      }
    }
    return { text: result };
  }

  const provider = { translate, throttle: { requestLimit: 60, windowMs: 60000 } };
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register && !reg.get('gemini')) reg.register('gemini', provider);
  } catch {}
  return provider;
}));
