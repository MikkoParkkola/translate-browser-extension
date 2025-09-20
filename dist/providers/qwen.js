;(function () {
let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;

if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}

const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) ? 
              window.qwenLogger.create('provider:qwen') :
              (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create) ?
              self.qwenLogger.create('provider:qwen') : console;
const errorHandler = (typeof window !== 'undefined' && window.qwenProviderErrorHandler) ||
                   (typeof self !== 'undefined' && self.qwenProviderErrorHandler) ||
                   (typeof require !== 'undefined' ? require('../core/provider-error-handler') : null);

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function fetchViaXHR(url, { method = 'GET', headers = {}, body, signal }, debug) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.responseType = 'text';
    if (signal) {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const onAbort = () => {
        xhr.abort();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      xhr.addEventListener('loadend', () => signal.removeEventListener('abort', onAbort));
    }
    xhr.onload = () => {
      const resp = {
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => JSON.parse(xhr.responseText || 'null'),
        text: async () => xhr.responseText,
        headers: new Headers(),
      };
      if (debug) console.log('QTDEBUG: XHR status', xhr.status);
      resolve(resp);
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body);
  });
}

async function translate({ endpoint, apiKey, model, secondaryModel, text, source, target, signal, debug, onData, stream = true }) {
  async function attempt(m) {
    const url = `${withSlash(endpoint)}services/aigc/text-generation/generation`;
    if (debug) {
      console.log('QTDEBUG: sending translation request to', url);
      console.log('QTDEBUG: request params', { model: m, source, target, text });
    }
    const body = {
      model: m,
      input: { messages: [{ role: 'user', content: text }] },
      parameters: {
        translation_options: { source_lang: source, target_lang: target },
      },
    };
    if (debug) console.log('QTDEBUG: request body', body);
    const key = (apiKey || '').trim();
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
    if (stream) headers['X-DashScope-SSE'] = 'enable';
    let resp;
    try {
      resp = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
      if (debug) {
        console.log('QTDEBUG: response status', resp.status);
        console.log('QTDEBUG: response headers', Object.fromEntries(resp.headers.entries()));
      }
    } catch (e) {
      if (errorHandler) {
        errorHandler.handleNetworkError(e, { provider: 'qwen', logger, endpoint });
      }
      // Fallback to XHR for non-stream requests
      if (!stream && typeof XMLHttpRequest !== 'undefined') {
        if (debug) console.log('QTDEBUG: fetch failed, falling back to XHR');
        resp = await fetchViaXHR(url, { method: 'POST', headers, body: JSON.stringify(body), signal }, debug);
      } else {
        e.retryable = true;
        throw e;
      }
    }
    if (!resp.ok) {
      if (errorHandler) {
        await errorHandler.handleHttpError(resp, { provider: 'qwen', logger, endpoint });
      }
      // Fallback error handling
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      const error = new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
      error.status = resp.status;
      if (debug) console.log('QTDEBUG: HTTP error response', error.message);
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
      if (debug) console.log('QTDEBUG: received non-streaming response');
      const data = await resp.json();
      const t = data.output?.text || data.output?.choices?.[0]?.message?.content;
      if (!t) {
        if (errorHandler) {
          errorHandler.handleResponseError('Invalid API response: missing content', 
            { provider: 'qwen', logger, response: data });
        }
        throw new Error('Invalid API response');
      }
      return { text: t };
    }
    if (debug) console.log('QTDEBUG: reading streaming response');
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
        if (debug) console.log('QTDEBUG: raw line', data);
        if (data === '[DONE]') {
          reader.cancel();
          break;
        }
        try {
          const obj = JSON.parse(data);
          const chunk = obj.output?.text || obj.output?.choices?.[0]?.message?.content || '';
          result += chunk;
          if (onData && chunk) onData(chunk);
          if (debug && chunk) console.log('QTDEBUG: chunk received', chunk);
        } catch {}
      }
    }
    return { text: result };
  }

  try {
    return await attempt(model);
  } catch (err) {
    const limited = err && (err.status === 429 || /quota|limit/i.test(err.message || ''));
    if (secondaryModel && limited) {
      if (debug) console.log('QTDEBUG: falling back to', secondaryModel);
      return await attempt(secondaryModel);
    }
    throw err;
  }
}

async function getQuota({ endpoint, apiKey, model, debug }) {
  const url = `${withSlash(endpoint)}monitor/quota`;
  const key = (apiKey || '').trim();
  const headers = {};
  if (key) headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
  try {
    let resp;
    try {
      resp = await fetchFn(`${url}?model=${encodeURIComponent(model || '')}`, { headers });
    } catch (error) {
      if (errorHandler) {
        errorHandler.handleNetworkError(error, { provider: 'qwen', logger, endpoint });
      }
      throw error;
    }
    if (debug) console.log('QTDEBUG: quota status', resp.status);
    if (!resp.ok) {
      if (errorHandler) {
        await errorHandler.handleHttpError(resp, { provider: 'qwen', logger, endpoint });
      }
      // Fallback error handling for quota check
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      return { error: err.message || `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    const used = {
      requests: data.usage?.requests ?? data.used?.requests ?? 0,
      tokens: data.usage?.tokens ?? data.used?.tokens ?? 0,
    };
    const remaining = {
      requests: data.remaining?.requests ?? data.quota?.remaining?.requests ?? 0,
      tokens: data.remaining?.tokens ?? data.quota?.remaining?.tokens ?? 0,
    };
    return { used, remaining };
  } catch (e) {
    if (debug) console.log('QTDEBUG: quota fetch failed', e);
    return { error: e.message };
  }
}

// Wrap main functions with standardized error handling
const wrappedTranslate = errorHandler ? 
  errorHandler.wrapProviderOperation(translate, { provider: 'qwen', logger }) : translate;
const wrappedGetQuota = errorHandler ? 
  errorHandler.wrapProviderOperation(getQuota, { provider: 'qwen', logger }) : getQuota;

const provider = {
  translate: wrappedTranslate,
  getQuota: wrappedGetQuota,
  label: 'Qwen',
  configFields: ['apiKey', 'apiEndpoint', 'model', 'secondaryModel', 'secondaryModelWarning'],
  throttle: { requestLimit: 5, windowMs: 1000 },
};
if (typeof window !== 'undefined') window.qwenProviderQwen = provider;
else if (typeof self !== 'undefined') self.qwenProviderQwen = provider;

try {
  const reg = (typeof window !== 'undefined' && window.qwenProviders) ||
              (typeof self !== 'undefined' && self.qwenProviders) ||
              (typeof require !== 'undefined' ? require('../lib/providers') : null);
  if (reg && reg.register && !reg.get('qwen')) reg.register('qwen', provider);
} catch {}

if (typeof module !== 'undefined') module.exports = provider;
})();
