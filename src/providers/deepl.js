let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}
let FormDataCtor = typeof FormData !== 'undefined' ? FormData : undefined;
if (typeof window === 'undefined' && typeof FormDataCtor === 'undefined' && typeof require !== 'undefined') {
  FormDataCtor = require('form-data');
}

function parseUsage(header) {
  if (!header) return undefined;
  const m = /^(\d+)(?:\/(\d+))?/.exec(header);
  if (!m) return undefined;
  const used = parseInt(m[1], 10);
  const limit = m[2] ? parseInt(m[2], 10) : undefined;
  return { used, limit };
}

async function translateBase({ base, endpoint, apiKey, text, source, target, signal, debug }) {
  const url = `${endpoint || base}/v2/translate`;
  const params = new URLSearchParams();
  params.append('text', text);
  params.append('target_lang', target);
  if (source) params.append('source_lang', source);
  const headers = { Authorization: `DeepL-Auth-Key ${apiKey}` };
  let resp;
  try {
    resp = await fetchFn(url, { method: 'POST', headers, body: params, signal });
    if (debug) console.log('QTDEBUG: DeepL status', resp.status);
  } catch (e) {
    e.retryable = true;
    throw e;
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const usage = parseUsage(resp.headers.get('x-deepl-usage'));
  return { text: data.translations.map(t => t.text).join('\n'), characters: usage };
}

async function translateFree(opts) {
  return translateBase({ ...opts, base: 'https://api-free.deepl.com', endpoint: opts && opts.endpoint });
}

async function translatePro(opts) {
  return translateBase({ ...opts, base: 'https://api.deepl.com', endpoint: opts && opts.endpoint });
}

async function translateDocument({ apiKey, document, filename = 'document', source, target, signal, debug, endpoint }) {
  const base = endpoint || 'https://api.deepl.com';
  const uploadUrl = `${base}/v2/document`;
  const headers = { Authorization: `DeepL-Auth-Key ${apiKey}` };
  const form = new FormDataCtor();
  form.append('target_lang', target);
  if (source) form.append('source_lang', source);
  let file = document;
  if (typeof Blob !== 'undefined' && !(document instanceof Blob)) {
    file = new Blob([document]);
  }
  form.append('file', file, filename);
  let resp;
  try {
    resp = await fetchFn(uploadUrl, { method: 'POST', headers, body: form, signal });
    if (debug) console.log('QTDEBUG: DeepL doc upload status', resp.status);
  } catch (e) {
    e.retryable = true;
    throw e;
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  const { document_id: id, document_key: key } = await resp.json();
  let statusData;
  while (true) {
    const statusResp = await fetchFn(`${base}/v2/document/${id}?document_key=${encodeURIComponent(key)}`, { headers, signal });
    if (!statusResp.ok) {
      const err = await statusResp.json().catch(() => ({ message: statusResp.statusText }));
      throw new Error(err.message || `HTTP ${statusResp.status}`);
    }
    statusData = await statusResp.json();
    if (statusData.status === 'done') break;
    if (statusData.status === 'error') {
      throw new Error(statusData.error_message || 'Document translation failed');
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  const downloadResp = await fetchFn(`${base}/v2/document/${id}/result?document_key=${encodeURIComponent(key)}`, { headers, signal });
  if (!downloadResp.ok) throw new Error(`HTTP ${downloadResp.status}`);
  const buf = await downloadResp.arrayBuffer();
  return { document: new Uint8Array(buf), characters: { billed: statusData.billed_characters } };
}

const { registerProvider } = require('./index');

registerProvider('deepl-free', {
  translate: translateFree,
  label: 'DeepL Free',
  configFields: ['apiKey'],
});

registerProvider('deepl-pro', {
  translate: translatePro,
  translateDocument,
  label: 'DeepL Pro',
  configFields: ['apiKey'],
});

module.exports = { translateFree, translatePro, translateDocument };

