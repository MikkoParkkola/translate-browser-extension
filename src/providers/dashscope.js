(function (root, factory) {
  const provider = factory(root);
  if (typeof window !== 'undefined') window.qwenProviderDashScope = provider;
  else if (typeof self !== 'undefined') self.qwenProviderDashScope = provider;
  if (typeof module !== 'undefined') module.exports = provider;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const logger = (root.qwenLogger && root.qwenLogger.create) ? root.qwenLogger.create('provider:dashscope') : console;
  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (root.fetch || null);
  const errorHandler = (root.qwenProviderErrorHandler) || 
                      (typeof require !== 'undefined' ? require('../core/provider-error-handler') : null);
  function withSlash(u) { return /\/$/.test(u) ? u : (u + '/'); }

  async function translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
    if (!fetchFn) throw new Error('fetch not available');
    const base = withSlash(endpoint || 'https://dashscope-intl.aliyuncs.com/api/v1');
    const url = base + 'services/aigc/text-generation/generation';
    if (debug) {
      logger.debug('sending translation request to', url);
      logger.debug('request params', { model, source, target });
    }
    const body = {
      model,
      input: { messages: [{ role: 'user', content: text }] },
      parameters: { translation_options: { source_lang: source, target_lang: target } },
    };
    const headers = { 'Content-Type': 'application/json' };
    const key = (apiKey || '').trim();
    if (key) headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
    if (stream) headers['X-DashScope-SSE'] = 'enable';

    let resp;
    try {
      resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (error) {
      if (errorHandler) {
        return errorHandler.handleNetworkError(error, { provider: 'dashscope', logger, endpoint });
      }
      error.retryable = true;
      throw error;
    }

    if (!resp.ok) {
      if (errorHandler) {
        return await errorHandler.handleHttpError(resp, { provider: 'dashscope', logger, endpoint });
      }
      // Fallback error handling
      let msg = resp.statusText;
      try { const err = await resp.json(); msg = err.message || err.error?.message || msg; } catch {}
      const error = new Error(`HTTP ${resp.status}: ${msg}`);
      error.status = resp.status; error.code = `HTTP_${resp.status}`;
      throw error;
    }

    if (!stream || !resp.body || typeof resp.body.getReader !== 'function') {
      const data = await resp.json();
      const out = data.output?.text || data.output?.choices?.[0]?.message?.content;
      if (!out) {
        if (errorHandler) {
          return errorHandler.handleResponseError('Invalid API response: missing content', 
            { provider: 'dashscope', logger, response: data });
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
        if (debug) logger.debug('raw line', data);
        if (data === '[DONE]') {
          try { reader.cancel(); } catch {}
          break;
        }
        try {
          const obj = JSON.parse(data);
          const chunk = obj.output?.text || obj.output?.choices?.[0]?.message?.content || '';
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
    const base = withSlash(endpoint || 'https://dashscope-intl.aliyuncs.com/api/v1');
    const url = base + 'models';
    const headers = {};
    const key = (apiKey || '').trim();
    if (key) headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
    let resp;
    try {
      resp = await fetchFn(url, { headers, signal });
    } catch (error) {
      if (errorHandler) {
        return errorHandler.handleNetworkError(error, { provider: 'dashscope', logger, endpoint });
      }
      throw error;
    }
    
    if (!resp.ok) {
      if (errorHandler) {
        return await errorHandler.handleHttpError(resp, { provider: 'dashscope', logger, endpoint });
      }
      const e = new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      e.status = resp.status; e.code = `HTTP_${resp.status}`;
      throw e;
    }
    const data = await resp.json();
    const list = data.models || data.data || [];
    return list.map(m => m.model_id || m.modelId || m.id || m).filter(Boolean);
  }

  // Wrap main functions with standardized error handling
  const wrappedTranslate = errorHandler ? 
    errorHandler.wrapProviderOperation(translate, { provider: 'dashscope', logger }) : translate;
  const wrappedListModels = errorHandler ? 
    errorHandler.wrapProviderOperation(listModels, { provider: 'dashscope', logger }) : listModels;

  const provider = { 
    translate: wrappedTranslate, 
    listModels: wrappedListModels, 
    throttle: { requestLimit: 5, windowMs: 1000 } 
  };
  try {
    const reg = root.qwenProviders || (typeof require !== 'undefined' ? require('../lib/providers') : null);
    if (reg && reg.register && !reg.get('dashscope')) reg.register('dashscope', provider);
  } catch {}
  return provider;
}));
