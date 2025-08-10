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
  let resp;
  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    };
    if (stream) headers['X-DashScope-SSE'] = 'enable';
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
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
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
  tokenBudget = 1800,
  maxBatchSize = 40,
  ...opts
}) {
  const results = new Array(texts.length);
  const indexMap = new Map();
  texts.forEach((t, i) => {
    const key = `${opts.source}:${opts.target}:${t}`;
    if (cache.has(key)) {
      results[i] = cache.get(key).text;
    } else {
      if (!indexMap.has(t)) indexMap.set(t, []);
      indexMap.get(t).push(i);
    }
  });
  const unique = Array.from(indexMap.keys());
  let group = [];
  let tokens = 0;
  const groups = [];
  unique.forEach(t => {
    const tk = approxTokens(t) + 1;
    if (
      group.length &&
      (tokens + tk > tokenBudget || group.length >= maxBatchSize)
    ) {
      groups.push(group);
      group = [];
      tokens = 0;
    }
    group.push(t);
    tokens += tk;
  });
  if (group.length) groups.push(group);
  for (const g of groups) {
    const joined = g.join('\n');
    let res;
    try {
      res = await qwenTranslate({ ...opts, text: joined });
    } catch (e) {
      g.forEach(orig => {
        const arr = indexMap.get(orig);
        if (arr && arr.forEach) arr.forEach(i => { results[i] = orig; });
      });
      continue;
    }
    const translated =
      res && typeof res.text === 'string' ? res.text.split('\n') : [];
    const n = Math.min(g.length, translated.length);
    for (let idx = 0; idx < n; idx++) {
      const orig = g[idx];
      const tr = translated[idx] || '';
      const key = `${opts.source}:${opts.target}:${orig}`;
      cache.set(key, { text: tr });
      const arr = indexMap.get(orig);
      if (arr && arr.forEach) arr.forEach(i => { results[i] = tr; });
    }
    for (let idx = n; idx < g.length; idx++) {
      const orig = g[idx];
      const arr = indexMap.get(orig);
      if (arr && arr.forEach) arr.forEach(i => { results[i] = orig; });
    }
  }
  return { texts: results };
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
