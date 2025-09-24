(function (root, factory) {
  const provider = factory(root);
  if (typeof window !== 'undefined') window.qwenProviderAnthropic = provider;
  else if (typeof self !== 'undefined') self.qwenProviderAnthropic = provider;
  if (typeof module !== 'undefined') module.exports = provider;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:anthropic') : console;
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
  const errorHandler = (root.qwenProviderErrorHandler) || 
                      (typeof require !== 'undefined' ? require('../core/provider-error-handler') : null);
  function withSlash(u) { return /\/$/.test(u) ? u : (u + '/'); }

  async function translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint || 'https://api.anthropic.com/v1');
    const url = base + 'messages';
    const sys = `You are a professional translator. Translate the user message from ${source} to ${target}. Output only the translation, no explanations.`;
    const body = { model, system: sys, messages: [{ role: 'user', content: text }], stream: !!stream, max_tokens: 4096 };
    const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    const key = (apiKey || '').trim();
    if (key) headers['x-api-key'] = key;

    if (debug) {
      logger.debug('sending translation request to', url);
      logger.debug('request params', { model, source, target });
    }

    let resp;
    try {
      resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (error) {
      if (errorHandler) {
        errorHandler.handleNetworkError(error, { provider: 'anthropic', logger, endpoint });
      }
      throw error;
    }
    if (!resp.ok) {
      if (errorHandler) {
        await errorHandler.handleHttpError(resp, { provider: 'anthropic', logger, endpoint });
      }
      // Fallback error handling
      let msg = resp.statusText;
      try { const err = await resp.json(); msg = err.error?.message || msg; } catch {}
      const error = new Error(`HTTP ${resp.status}: ${msg}`);
      error.status = resp.status;
      if (resp.status === 401 || resp.status === 403) {
        error.retryable = false;
      } else if (resp.status >= 500 || resp.status === 429) {
        error.retryable = true;
        const ra = resp.headers && resp.headers.get && resp.headers.get('retry-after');
        if (ra) {
          let ms = Number(ra) * 1000;
          if (!Number.isFinite(ms)) { const t = Date.parse(ra); if (Number.isFinite(t)) ms = Math.max(0, t - Date.now()); }
          if (Number.isFinite(ms)) error.retryAfter = Math.max(100, Math.min(ms, 60000));
        }
        if (resp.status === 429 && !error.retryAfter) error.retryAfter = 60000;
      }
      throw error;
    }

    if (!stream || !resp.body || typeof resp.body.getReader !== 'function') {
      const data = await resp.json();
      const out = data.content?.[0]?.text;
      if (!out) {
        if (errorHandler) {
          errorHandler.handleResponseError('Invalid API response: missing content', 
            { provider: 'anthropic', logger, response: data });
        }
        throw new Error('Invalid API response');
      }
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
        if (!data) continue;
        if (debug) logger.debug('raw line', data);
        try {
          const obj = JSON.parse(data);
          const chunk = obj.delta?.text || obj.content?.[0]?.text || '';
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

  async function listModels({ endpoint, apiKey, signal } = {}) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint || 'https://api.anthropic.com/v1');
    const url = base + 'models';
    const headers = { 'anthropic-version': '2023-06-01' };
    const key = (apiKey || '').trim();
    if (key) headers['x-api-key'] = key;
    let resp;
    try {
      resp = await fetchFn(url, { headers, signal });
    } catch (error) {
      if (errorHandler) {
        errorHandler.handleNetworkError(error, { provider: 'anthropic', logger, endpoint });
      }
      throw error;
    }
    if (!resp.ok) {
      if (errorHandler) {
        await errorHandler.handleHttpError(resp, { provider: 'anthropic', logger, endpoint });
      }
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const data = await resp.json();
    const arr = data.data || data.models || [];
    return arr.map(m => m.id || m).filter(Boolean);
  }

  // Wrap main functions with standardized error handling
  const wrappedTranslate = errorHandler ? 
    errorHandler.wrapProviderOperation(translate, { provider: 'anthropic', logger }) : translate;
  const wrappedListModels = errorHandler ? 
    errorHandler.wrapProviderOperation(listModels, { provider: 'anthropic', logger }) : listModels;

  const provider = { 
    translate: wrappedTranslate, 
    listModels: wrappedListModels, 
    throttle: { requestLimit: 60, windowMs: 60000 } 
  };
  // Register into provider registry if available
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register && !reg.get('anthropic')) reg.register('anthropic', provider);
  } catch {}
  return provider;
}));
