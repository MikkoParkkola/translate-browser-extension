let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
var runWithRateLimit;
var runWithRetry;
var approxTokens;

if (typeof window === 'undefined') {
  fetchFn = require('cross-fetch');
  ({ runWithRateLimit, runWithRetry, approxTokens } = require('./throttle'));
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

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function doFetch({ endpoint, apiKey, model, text, source, target, signal, debug }) {
  const url = `${withSlash(endpoint)}services/aigc/text-generation/generation`;
  if (debug) console.log('QTDEBUG: sending translation request to', url);
  const body = {
    model,
    input: { messages: [{ role: 'user', content: text }] },
    parameters: {
      translation_options: { source_lang: source, target_lang: target },
    },
  };
  let resp;
  try {
    resp = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
        ...(typeof window !== 'undefined' ? { 'X-DashScope-SSE': 'enable' } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    e.retryable = true;
    throw e;
  }
  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: resp.statusText }));
    const error = new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
    if (resp.status >= 500) error.retryable = true;
    throw error;
  }
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const data = await resp.json();
    const text =
      data.output?.text ||
      data.output?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('Invalid API response');
    }
    return { text };
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
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
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
      } catch {}
    }
  }
  return { text: result };
}

async function qwenTranslate({ endpoint, apiKey, model, text, source, target, signal, debug = false }) {
  const cacheKey = `${source}:${target}:${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const ep = withSlash(endpoint);
    if (debug) console.log('QTDEBUG: requesting translation via background script');
    const result = await chrome.runtime
      .sendMessage({ action: 'translate', opts: { endpoint: ep, apiKey, model, text, source, target, debug } })
      .catch(err => { throw new Error(err.message || err); });
    if (result && result.error) {
      throw new Error(result.error);
    }
    if (debug) console.log('QTDEBUG: background response received');
    cache.set(cacheKey, result);
    return result;
  }

  try {
    const data = await runWithRetry(
      () => doFetch({ endpoint, apiKey, model, text, source, target, signal, debug }),
      approxTokens(text),
      3,
      debug
    );
    cache.set(cacheKey, data);
    if (debug) console.log('QTDEBUG: translation successful');
    return data;
  } catch (e) {
    console.error('QTERROR: translation request failed', e);
    throw e;
  }
}
function qwenClearCache() {
  cache.clear();
}
if (typeof window !== 'undefined') {
  window.qwenTranslate = qwenTranslate;
  window.qwenClearCache = qwenClearCache;
}
if (typeof module !== 'undefined') {
  module.exports = { qwenTranslate, qwenClearCache };
}
