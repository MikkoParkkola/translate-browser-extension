;(function () {
let fetchFn = typeof fetch !== 'undefined' ? fetch : undefined;
if (typeof window === 'undefined' && typeof fetchFn === 'undefined' && typeof require !== 'undefined') {
  fetchFn = require('cross-fetch');
}
const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) ? 
              window.qwenLogger.create('provider:google') :
              (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create) ?
              self.qwenLogger.create('provider:google') : console;
const errorHandler = (typeof window !== 'undefined' && window.qwenProviderErrorHandler) ||
                   (typeof self !== 'undefined' && self.qwenProviderErrorHandler) ||
                   (typeof require !== 'undefined' ? require('../core/provider-error-handler') : null);
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
  let resp;
  try {
    resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (errorHandler) {
      errorHandler.handleNetworkError(error, { provider: 'google', logger, endpoint });
    }
    throw error;
  }
  if (!resp.ok) {
    if (errorHandler) {
      await errorHandler.handleHttpError(resp, { provider: 'google', logger, endpoint });
    }
    // Fallback error handling
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    const e = new Error(err.error?.message || err.message || `HTTP ${resp.status}`);
    e.status = resp.status; e.code = `HTTP_${resp.status}`; throw e;
  }
  const data = await resp.json();
  const t = data.translations?.[0]?.translatedText;
  if (!t) {
    if (errorHandler) {
      errorHandler.handleResponseError('Invalid API response: missing translated text', 
        { provider: 'google', logger, response: data });
    }
    throw new Error('Invalid API response');
  }
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
  let resp;
  try {
    resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (errorHandler) {
      errorHandler.handleNetworkError(error, { provider: 'google', logger, endpoint });
    }
    throw error;
  }
  if (!resp.ok) {
    if (errorHandler) {
      await errorHandler.handleHttpError(resp, { provider: 'google', logger, endpoint });
    }
    // Fallback error handling
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    const e = new Error(err.error?.message || err.message || `HTTP ${resp.status}`);
    e.status = resp.status; e.code = `HTTP_${resp.status}`; throw e;
  }
  const data = await resp.json();
  const out = data.documentTranslation?.byteStreamOutputs?.[0];
  return {
    file: Buffer.from(out || '', 'base64'),
    usage: { chars: data.totalCharacters },
  };
}
// Wrap main functions with standardized error handling
const wrappedTranslate = errorHandler ? 
  errorHandler.wrapProviderOperation(translate, { provider: 'google', logger }) : translate;
const wrappedTranslateDocument = errorHandler ? 
  errorHandler.wrapProviderOperation(translateDocument, { provider: 'google', logger }) : translateDocument;

const provider = {
  translate: wrappedTranslate,
  translateDocument: wrappedTranslateDocument,
  label: 'Google',
  configFields: ['apiKey', 'apiEndpoint', 'model'],
};
if (typeof window !== 'undefined') window.qwenProviderGoogle = provider;
else if (typeof self !== 'undefined') self.qwenProviderGoogle = provider;

try {
  const reg = (typeof window !== 'undefined' && window.qwenProviders) ||
              (typeof self !== 'undefined' && self.qwenProviders) ||
              (typeof require !== 'undefined' ? require('../lib/providers') : null);
  if (reg && reg.register && !reg.get('google')) reg.register('google', provider);
} catch {}

if (typeof module !== 'undefined') module.exports = provider;
})();
