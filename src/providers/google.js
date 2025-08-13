let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;

if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(str) {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(str, 'base64'));
  }
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function translate({ apiKey, projectId, location = 'global', model, text, source, target, debug }) {
  const url = `https://translation.googleapis.com/v3/projects/${projectId}/locations/${location}:translateText?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [text],
    targetLanguageCode: target,
  };
  if (source) body.sourceLanguageCode = source;
  if (model) body.model = `projects/${projectId}/locations/${location}/models/${model}`;
  if (debug) {
    console.log('QTDEBUG: Google translate request', { url, body });
  }
  const resp = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (debug) console.log('QTDEBUG: Google translate status', resp.status);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
  }
  const data = await resp.json();
  const translated = data.translations && data.translations[0] && data.translations[0].translatedText;
  if (!translated) throw new Error('Invalid API response');
  return { text: translated, usage: { chars: data.totalCharacters || (text ? text.length : 0) } };
}

async function fileToBase64(file) {
  if (file instanceof Uint8Array) {
    return toBase64(file);
  }
  if (ArrayBuffer.isView(file)) {
    return toBase64(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
  }
  if (file instanceof ArrayBuffer) {
    return toBase64(new Uint8Array(file));
  }
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    const buf = await file.arrayBuffer();
    return toBase64(new Uint8Array(buf));
  }
  throw new Error('Unsupported file type');
}

async function translateDocument({ apiKey, projectId, location = 'global', model, file, mimeType, source, target, debug }) {
  const url = `https://translation.googleapis.com/v3/projects/${projectId}/locations/${location}:translateDocument?key=${encodeURIComponent(apiKey)}`;
  const content = await fileToBase64(file);
  const body = {
    documentInputConfig: { content, mimeType },
  };
  if (target) body.targetLanguageCode = target;
  if (source) body.sourceLanguageCode = source;
  if (model) body.model = `projects/${projectId}/locations/${location}/models/${model}`;
  if (debug) {
    console.log('QTDEBUG: Google translateDocument request', { url, body });
  }
  const resp = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (debug) console.log('QTDEBUG: Google translateDocument status', resp.status);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
  }
  const data = await resp.json();
  const out = data.documentTranslation && data.documentTranslation.byteStreamOutputs && data.documentTranslation.byteStreamOutputs[0];
  const bytes = out ? fromBase64(out) : new Uint8Array();
  return { file: bytes, usage: { chars: data.totalCharacters || 0 } };
}

const { registerProvider } = require('./index');
registerProvider('google', {
  translate,
  translateDocument,
  label: 'Google',
  configFields: ['apiKey', 'projectId', 'location', 'model'],
});

module.exports = { translate, translateDocument };
