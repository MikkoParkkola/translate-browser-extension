let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined') {
  fetchFn = require('cross-fetch');
}

const cache = new Map();

async function qwenTranslate({ endpoint, apiKey, model, text, target, signal }) {
  const cacheKey = `${target}:${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
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
  cache.set(cacheKey, data.output);
  return data.output;
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
