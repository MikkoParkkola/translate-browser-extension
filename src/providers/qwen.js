let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;

if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}

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

async function translate({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
  const url = `${withSlash(endpoint)}services/aigc/text-generation/generation`;
  if (debug) {
    console.log('QTDEBUG: sending translation request to', url);
    console.log('QTDEBUG: request params', { model, source, target, text });
  }
  const body = {
    model,
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
    if (!stream && typeof XMLHttpRequest !== 'undefined') {
      if (debug) console.log('QTDEBUG: fetch failed, falling back to XHR');
      resp = await fetchViaXHR(url, { method: 'POST', headers, body: JSON.stringify(body), signal }, debug);
    } else {
      e.retryable = true;
      throw e;
    }
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    const error = new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
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

async function getQuota({ endpoint, apiKey, model, debug }) {
  const url = `${withSlash(endpoint)}monitor/quota`;
  const key = (apiKey || '').trim();
  const headers = {};
  if (key) headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
  try {
    const resp = await fetchFn(`${url}?model=${encodeURIComponent(model || '')}`, { headers });
    if (debug) console.log('QTDEBUG: quota status', resp.status);
    if (!resp.ok) {
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

const provider = {
  translate,
  getQuota,
  label: 'Qwen',
  configFields: ['apiKey', 'apiEndpoint', 'model'],
  throttle: { requestLimit: 5, windowMs: 1000 },
};

try {
  const reg = (typeof window !== 'undefined' && window.qwenProviders) ||
              (typeof self !== 'undefined' && self.qwenProviders) ||
              (typeof require !== 'undefined' ? require('../lib/providers') : null);
  if (reg && reg.register && !reg.get('qwen')) reg.register('qwen', provider);
} catch {}

module.exports = provider;
