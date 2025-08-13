let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}
function withSlash(url) {
  return url.endsWith('/') ? url : url + '/';
}
async function translate({ endpoint, apiKey, model, text, source, target, signal, debug }) {
  const url = `${withSlash(endpoint)}v2/translate`;
  const params = new URLSearchParams();
  params.append('text', text);
  if (source) params.append('source_lang', source.toUpperCase());
  if (target) params.append('target_lang', target.toUpperCase());
  if (model) params.append('model', model);
  if (debug) console.log('QTDEBUG: DeepL request', params.toString());
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const key = (apiKey || '').trim();
  if (key)
    headers.Authorization = /^DeepL-Auth-Key\s/i.test(key)
      ? key
      : `DeepL-Auth-Key ${key}`;
  const resp = await fetchFn(url, {
    method: 'POST',
    headers,
    body: params.toString(),
    signal,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const t = data.translations?.[0]?.text;
  if (!t) throw new Error('Invalid API response');
  return { text: t };
}
const { registerProvider } = require('./index');
registerProvider('deepl', { translate, label: 'DeepL', configFields: ['apiKey', 'apiEndpoint', 'model'] });
module.exports = { translate };
