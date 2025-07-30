let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined') {
  fetchFn = require('cross-fetch');
}

const cache = new Map();

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function doFetch({ endpoint, apiKey, model, text, source, target, signal }) {
  const url = `${withSlash(endpoint)}services/aigc/text-generation/generation`;
  console.log('Sending translation request to', url);
  const body = {
    model,
    input: { messages: [{ role: 'user', content: text }] },
    parameters: {
      translation_options: { source_lang: source, target_lang: target },
    },
  };
  const resp = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
      ...(typeof window !== 'undefined' ? { 'X-DashScope-SSE': 'enable' } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: resp.statusText }));
    throw new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
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

async function qwenTranslate({ endpoint, apiKey, model, text, source, target, signal }) {
  const cacheKey = `${source}:${target}:${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const ep = withSlash(endpoint);
    const result = await new Promise((resolve, reject) => {
      console.log('Requesting translation via background script');
      chrome.runtime.sendMessage({ action: 'translate', opts: { endpoint: ep, apiKey, model, text, source, target } }, res => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (res && res.error) {
          reject(new Error(res.error));
        } else {
          resolve(res);
        }
      });
    });
    cache.set(cacheKey, result);
    return result;
  }

  try {
    const data = await doFetch({ endpoint, apiKey, model, text, source, target, signal });
    cache.set(cacheKey, data);
    return data;
  } catch (e) {
    console.error('Translation request failed:', e);
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
