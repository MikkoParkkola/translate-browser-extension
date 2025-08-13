let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}
function withSlash(url) {
  return url.endsWith('/') ? url : url + '/';
}
async function translate({ endpoint, apiKey, model, text, source, target, signal, debug }) {
  const url = `${withSlash(endpoint)}language/translate/v2`;
  if (debug) console.log('QTDEBUG: Google request', { model, text, source, target });
  const body = { q: text, source, target, format: 'text' };
  if (model) body.model = model;
  const headers = { 'Content-Type': 'application/json' };
  const key = (apiKey || '').trim();
  if (key) headers.Authorization = /^Bearer\s/i.test(key) ? key : `Bearer ${key}`;
  const resp = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(err.error?.message || err.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const t = data.data?.translations?.[0]?.translatedText;
  if (!t) throw new Error('Invalid API response');
  return { text: t };
}
const { registerProvider } = require('./index');
registerProvider('google', { translate, label: 'Google', configFields: ['apiKey', 'apiEndpoint', 'model'] });
module.exports = { translate };
