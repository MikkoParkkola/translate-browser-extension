let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}
let FormDataCtor = typeof FormData !== 'undefined' ? FormData : undefined;
if (typeof window === 'undefined' && typeof FormDataCtor === 'undefined' && typeof require !== 'undefined') {
  FormDataCtor = require('form-data');
}
function withSlash(url) {
  return url.endsWith('/') ? url : url + '/';
}
function parseUsage(header) {
  const m = /^(\d+)\/(\d+)$/.exec(header || '');
  if (m) return { used: parseInt(m[1], 10), limit: parseInt(m[2], 10) };
}
function makeTranslate(defaultEndpoint) {
  return async function ({ endpoint = defaultEndpoint, apiKey, model, text, source, target, signal, debug }) {
    const url = `${withSlash(endpoint)}v2/translate`;
    const params = new URLSearchParams();
    params.append('text', text);
    if (source) params.append('source_lang', source.toUpperCase());
    if (target) params.append('target_lang', target.toUpperCase());
    if (model) params.append('model', model);
    if (debug) console.log('QTDEBUG: DeepL request', params.toString());
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const key = (apiKey || '').trim();
    if (key) headers.Authorization = /^DeepL-Auth-Key\s/i.test(key) ? key : `DeepL-Auth-Key ${key}`;
    const resp = await fetchFn(url, { method: 'POST', headers, body: params.toString(), signal });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(err.message || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const t = data.translations?.[0]?.text;
    if (!t) throw new Error('Invalid API response');
    const usage = parseUsage(resp.headers.get('x-deepl-usage'));
    return { text: t, characters: usage };
  };
}
async function translateDocument({ endpoint = 'https://api.deepl.com/v2/', apiKey, document, target, signal, debug }) {
  const base = withSlash(endpoint);
  const headers = {};
  const key = (apiKey || '').trim();
  if (key) headers.Authorization = /^DeepL-Auth-Key\s/i.test(key) ? key : `DeepL-Auth-Key ${key}`;
  const form = new FormDataCtor();
  form.append('target_lang', target.toUpperCase());
  const file =
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(document))
      ? document
      : document instanceof Uint8Array
      ? new Blob([document])
      : document;
  form.append('file', file, 'file');
  const start = await fetchFn(`${base}document`, { method: 'POST', headers, body: form, signal });
  if (!start.ok) {
    const err = await start.json().catch(() => ({ message: start.statusText }));
    throw new Error(err.message || `HTTP ${start.status}`);
  }
  const info = await start.json();
  const statusUrl = `${base}document/${info.document_id}?document_key=${info.document_key}`;
  const status = await fetchFn(statusUrl, { headers, signal });
  const statusData = await status.json();
  const resultUrl = `${base}document/${info.document_id}/result?document_key=${info.document_key}`;
  const result = await fetchFn(resultUrl, { headers, signal });
  const buf = await result.arrayBuffer();
  return { document: new Uint8Array(buf), characters: { billed: statusData.billed_characters } };
}
const translate = makeTranslate('https://api-free.deepl.com/');
const free = {
  translate: makeTranslate('https://api-free.deepl.com/'),
  label: 'DeepL Free',
  configFields: ['apiKey', 'apiEndpoint', 'model'],
};
const pro = {
  translate: makeTranslate('https://api.deepl.com/'),
  translateDocument,
  label: 'DeepL Pro',
  configFields: ['apiKey', 'apiEndpoint', 'model'],
};
const basic = { translate, label: 'DeepL', configFields: ['apiKey', 'apiEndpoint', 'model'] };
if (typeof window !== 'undefined' && window.qwenProviders) {
  window.qwenProviders.registerProvider('deepl', basic);
  window.qwenProviders.registerProvider('deepl-free', free);
  window.qwenProviders.registerProvider('deepl-pro', pro);
} else if (typeof self !== 'undefined' && self.qwenProviders) {
  self.qwenProviders.registerProvider('deepl', basic);
  self.qwenProviders.registerProvider('deepl-free', free);
  self.qwenProviders.registerProvider('deepl-pro', pro);
}
module.exports = { translate, free, pro, basic };
