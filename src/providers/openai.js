(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenProviderOpenAI = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:openai') : console;
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
  function withSlash(u) { return /\/$/.test(u) ? u : (u + '/'); }

  async function translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint || 'https://api.openai.com/v1');
    const url = base + 'chat/completions';
    const sys = `You are a professional translator. Translate the user message from ${source} to ${target}. Output only the translation, no explanations.`;
    const body = { model, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], stream: !!stream };
    const headers = { 'Content-Type': 'application/json' };
    const key = (apiKey || '').trim();
    if (key) headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;

    if (debug) {
      logger.debug('sending translation request to', url);
      logger.debug('request params', { model, source, target });
    }

    const resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!resp.ok) {
      let msg = resp.statusText;
      try { const err = await resp.json(); msg = err.error?.message || msg; } catch {}
      const error = new Error(`HTTP ${resp.status}: ${msg}`);
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
      const out = data.choices?.[0]?.message?.content;
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
        if (data === '[DONE]') {
          try { reader.cancel(); } catch {}
          break;
        }
        try {
          const obj = JSON.parse(data);
          const chunk = obj.choices?.[0]?.delta?.content || '';
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

  // Register into provider registry if available
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register) reg.register('openai', { translate });
  } catch {}
  return { translate };
}));
