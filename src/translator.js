let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
var runWithRateLimit;
var runWithRetry;
var approxTokens;

if (typeof window === 'undefined') {
  if (typeof self !== 'undefined' && self.qwenThrottle) {
    ({ runWithRateLimit, runWithRetry, approxTokens } = self.qwenThrottle);
  } else {
    // Node 18+ provides a global fetch implementation
    fetchFn = typeof fetch !== 'undefined' ? fetch : require('cross-fetch');
    ({ runWithRateLimit, runWithRetry, approxTokens } = require('./throttle'));
  }
} else {
  if (window.qwenThrottle) {
    ({ runWithRateLimit, runWithRetry, approxTokens } = window.qwenThrottle);
  } else if (typeof require !== 'undefined') {
    ({ runWithRateLimit, runWithRetry, approxTokens } = require('./throttle'));
  } else {
    runWithRateLimit = fn => fn();
    runWithRetry = fn => fn();
    approxTokens = () => 0;
  }
}

const cache = new Map();

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

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function doFetch({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream = true }) {
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
      resp = await fetchViaXHR(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        },
        debug
      );
    } else {
      e.retryable = true;
      throw e;
    }
  }
    if (!resp.ok) {
      const err = await resp
        .json()
        .catch(() => ({ message: resp.statusText }));
      const error = new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
      if (debug) console.log('QTDEBUG: HTTP error response', error.message);
      if (resp.status >= 500 || resp.status === 429) error.retryable = true;
      throw error;
    }
  if (!stream || !resp.body || typeof resp.body.getReader !== 'function') {
    if (debug) console.log('QTDEBUG: received non-streaming response');
    const data = await resp.json();
    const text =
      data.output?.text ||
      data.output?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('Invalid API response');
    }
    return { text };
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
        const chunk =
          obj.output?.text ||
          obj.output?.choices?.[0]?.message?.content || '';
        result += chunk;
        if (onData && chunk) onData(chunk);
        if (debug && chunk) console.log('QTDEBUG: chunk received', chunk);
      } catch {}
    }
  }
  return { text: result };
}

async function qwenTranslate({ endpoint, apiKey, model, text, source, target, signal, debug = false, stream = false, noProxy = false }) {
  if (debug) {
    console.log('QTDEBUG: qwenTranslate called with', {
      endpoint,
      apiKeySet: Boolean(apiKey),
      model,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
  const cacheKey = `${source}:${target}:${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  if (
    !noProxy &&
    typeof window !== 'undefined' &&
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.sendMessage
  ) {
    const ep = withSlash(endpoint);
    if (debug) console.log('QTDEBUG: requesting translation via background script');
    const result = await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            action: 'translate',
            opts: { endpoint: ep, apiKey, model, text, source, target, debug },
          },
          res => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(res);
            }
          }
        );
      } catch (err) {
        reject(err);
      }
    });
    if (!result) {
      throw new Error('No response from background');
    }
    if (result.error) {
      throw new Error(result.error);
    }
    if (debug) console.log('QTDEBUG: background response received');
    cache.set(cacheKey, result);
    return result;
  }

  try {
    const data = await runWithRetry(
      () => doFetch({ endpoint, apiKey, model, text, source, target, signal, debug, stream }),
      approxTokens(text),
      3,
      debug
    );
    cache.set(cacheKey, data);
    if (debug) {
      console.log('QTDEBUG: translation successful');
      console.log('QTDEBUG: final text', data.text);
    }
    return data;
  } catch (e) {
    console.error('QTERROR: translation request failed', e);
    throw e;
  }
}

async function qwenTranslateStream({ endpoint, apiKey, model, text, source, target, signal, debug = false, stream = true, noProxy = false }, onData) {
  if (debug) {
    console.log('QTDEBUG: qwenTranslateStream called with', {
      endpoint,
      apiKeySet: Boolean(apiKey),
      model,
      source,
      target,
      text: text && text.slice ? text.slice(0, 20) + (text.length > 20 ? '...' : '') : text,
    });
  }
  const cacheKey = `${source}:${target}:${text}`;
  if (cache.has(cacheKey)) {
    const data = cache.get(cacheKey);
    if (onData) onData(data.text);
    return data;
  }
  try {
    const data = await runWithRetry(
      () => doFetch({ endpoint, apiKey, model, text, source, target, signal, debug, onData, stream }),
      approxTokens(text),
      3,
      debug
    );
    cache.set(cacheKey, data);
    if (debug) {
      console.log('QTDEBUG: translation successful');
      console.log('QTDEBUG: final text', data.text);
    }
    return data;
  } catch (e) {
    console.error('QTERROR: translation request failed', e);
    throw e;
  }
}

async function qwenTranslateBatch({
  texts = [],
  tokenBudget = 7000,
  maxBatchSize = 200,
  ...opts
}) {
  const mapping = [];
  texts.forEach((t, i) => {
    const key = `${opts.source}:${opts.target}:${t}`;
    if (cache.has(key)) {
      mapping.push({ index: i, chunk: 0, text: cache.get(key).text, cached: true });
      return;
    }
    const pieces = splitLongText(t, tokenBudget);
    pieces.forEach((p, idx) => mapping.push({ index: i, chunk: idx, text: p }));
  });
  const byIndex = new Map();
  mapping.forEach(m => {
    if (!byIndex.has(m.index)) byIndex.set(m.index, []);
    byIndex.get(m.index).push(m);
  });
  const groups = [];
  let group = [];
  let tokens = 0;
  for (const m of mapping.filter(m => !m.cached)) {
    const tk = approxTokens(m.text) + 1;
    if (group.length && (tokens + tk > tokenBudget || group.length >= maxBatchSize)) {
      groups.push(group);
      group = [];
      tokens = 0;
    }
    group.push(m);
    tokens += tk;
  }
  if (group.length) groups.push(group);
  const SEP = '\uE000';
  for (const g of groups) {
    const joined = g.map(m => m.text.replaceAll(SEP, '')).join(SEP);
    let res;
    try {
      res = await qwenTranslate({ ...opts, text: joined });
    } catch (e) {
      if (/HTTP\s+400/i.test(e.message || '')) throw e;
      g.forEach(m => { m.result = m.text; });
      continue;
    }
    const translated =
      res && typeof res.text === 'string' ? res.text.split(SEP) : [];
    for (let i = 0; i < g.length; i++) {
      g[i].result = translated[i] || g[i].text;
      const key = `${opts.source}:${opts.target}:${g[i].text}`;
      cache.set(key, { text: g[i].result });
    }
  }
  const results = new Array(texts.length).fill('');
  byIndex.forEach((arr, idx) => {
    const parts = arr
      .sort((a, b) => a.chunk - b.chunk)
      .map(m => (m.result !== undefined ? m.result : m.text));
    results[idx] = parts.join(' ').trim();
  });
  for (let i = 0; i < results.length; i++) {
    const orig = (texts[i] || '').trim();
    const out = (results[i] || '').trim();
    if (orig && out === orig && opts.source !== opts.target) {
      try {
        const key = `${opts.source}:${opts.target}:${orig}`;
        cache.delete(key);
        const retr = await qwenTranslate({ ...opts, text: orig, stream: false });
        if (retr && typeof retr.text === 'string') {
          results[i] = retr.text;
          cache.set(key, { text: retr.text });
        }
      } catch (e) {
        if (opts.debug) console.error('QTDEBUG: fallback translation failed', e);
      }
    }
  }
  return { texts: results };
}

function splitLongText(text, maxTokens) {
  const parts = (text || '').split(/(?<=[\.?!])\s+/);
  const chunks = [];
  let cur = '';
  for (const part of parts) {
    const next = cur ? cur + ' ' + part : part;
    if (approxTokens(next) > maxTokens && cur) {
      chunks.push(cur);
      cur = part;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);
  const out = [];
  for (const ch of chunks) {
    if (approxTokens(ch) <= maxTokens) {
      out.push(ch);
    } else {
      let start = 0;
      const step = Math.max(128, Math.floor(maxTokens * 4));
      while (start < ch.length) {
        out.push(ch.slice(start, start + step));
        start += step;
      }
    }
  }
  return out;
}
function qwenClearCache() {
  cache.clear();
}
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
  window.qwenTranslateStream = qwenTranslateStream;
  window.qwenTranslateBatch = qwenTranslateBatch;
  window.qwenClearCache = qwenClearCache;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenTranslate = qwenTranslate;
  self.qwenTranslateStream = qwenTranslateStream;
  self.qwenTranslateBatch = qwenTranslateBatch;
  self.qwenClearCache = qwenClearCache;
}
if (typeof module !== 'undefined') {
  module.exports = { qwenTranslate, qwenTranslateStream, qwenTranslateBatch, qwenClearCache };
}
