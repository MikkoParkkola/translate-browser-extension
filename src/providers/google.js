let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}
function withSlash(url) {
  return url.endsWith('/') ? url : url + '/';
}
async function translate({ endpoint = 'https://translation.googleapis.com/v3/', apiKey, projectId, location, model, text, source, target, signal }) {
  const base = withSlash(endpoint);
  const url = `${base}projects/${projectId}/locations/${location}:translateText`;
  const body = {
    contents: [text],
    mimeType: 'text/plain',
    sourceLanguageCode: source,
    targetLanguageCode: target,
  };
  if (model) body.model = model;
  const headers = { 'Content-Type': 'application/json' };
  const key = (apiKey || '').trim();
  if (key) headers.Authorization = /^Bearer\s/i.test(key) ? key : `Bearer ${key}`;
  const resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(err.error?.message || err.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const t = data.translations?.[0]?.translatedText;
  if (!t) throw new Error('Invalid API response');
  return { text: t, usage: { chars: data.totalCharacters } };
}
async function translateDocument({ endpoint = 'https://translation.googleapis.com/v3/', apiKey, projectId, location, file, mimeType, source, target, signal }) {
  const base = withSlash(endpoint);
  const url = `${base}projects/${projectId}/locations/${location}:translateDocument`;
  const body = {
    documentInputConfig: { content: Buffer.from(file).toString('base64'), mimeType },
    sourceLanguageCode: source,
    targetLanguageCode: target,
  };
  const headers = { 'Content-Type': 'application/json' };
  const key = (apiKey || '').trim();
  if (key) headers.Authorization = /^Bearer\s/i.test(key) ? key : `Bearer ${key}`;
  const resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(err.error?.message || err.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const out = data.documentTranslation?.byteStreamOutputs?.[0];
  return {
    file: Buffer.from(out || '', 'base64'),
    usage: { chars: data.totalCharacters },
  };
}
const provider = {
  translate,
  translateDocument,
  label: 'Google',
  configFields: ['apiKey', 'apiEndpoint', 'model'],
};

if (typeof window !== 'undefined' && window.qwenProviders) {
  window.qwenProviders.registerProvider('google', provider);
} else if (typeof self !== 'undefined' && self.qwenProviders) {
  self.qwenProviders.registerProvider('google', provider);
}

module.exports = provider;
