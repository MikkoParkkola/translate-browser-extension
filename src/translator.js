let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined') {
  fetchFn = require('cross-fetch');
}

const cache = new Map();

async function doFetch({ endpoint, apiKey, model, text, target, signal }) {
  const url = `${endpoint}services/aigc/mt/text-translator/generation`;
  const body = {
    model,
    input: { source_language: 'auto', target_language: target, text },
  };
  const resp = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: resp.statusText }));
    throw new Error(err.message || 'Translation failed');
  }
  const data = await resp.json();
  if (!data.output || !data.output.text) {
    throw new Error('Invalid API response');
  }
  return data.output;
}

async function qwenTranslate({ endpoint, apiKey, model, text, target, signal }) {
  const cacheKey = `${target}:${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'translate', opts: { endpoint, apiKey, model, text, target } }, res => {
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

  const data = await doFetch({ endpoint, apiKey, model, text, target, signal });
  cache.set(cacheKey, data);
  return data;
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
