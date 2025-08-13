const sendMessage = jest.fn();
let messageListener;
global.chrome = {
  runtime: {
    getURL: () => 'chrome-extension://abc/',
    onMessage: { addListener: cb => { messageListener = cb; } },
    sendMessage,
  },
};

window.qwenTranslateBatch = async ({ texts, onProgress }) => {
  if (onProgress) onProgress({ phase: 'translate', request: 1, requests: 2, sample: texts[0] });
  return { texts: texts.map(t => `X${t}X`) };
};
window.qwenLoadConfig = async () => ({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'nl', targetLanguage: 'en', debug: false });
window.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
Element.prototype.getClientRects = () => [1];

const { translateBatch, collectNodes, setCurrentConfig } = require('../src/contentScript.js');

test('translates text nodes without altering structure', async () => {
  document.body.innerHTML = '<p class="bm-message-body"><span>Beste klant,</span><br><span>Bedankt dat u contact met ons opneemt.</span></p>';
  setCurrentConfig({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'nl', targetLanguage: 'en', debug: false });
  const nodes = [];
  collectNodes(document.body, nodes);
  await translateBatch(nodes);
  const p = document.querySelector('p');
  expect(p.querySelectorAll('span').length).toBe(2);
  expect(p.querySelector('br')).not.toBeNull();
  expect(p.querySelectorAll('span')[0].textContent).toBe('XBeste klant,X');
  expect(p.querySelectorAll('span')[1].textContent).toBe('XBedankt dat u contact met ons opneemt.X');
});

test('emits progress updates during batch translation', async () => {
  document.body.innerHTML = '<p><span>Hallo</span></p>';
  setCurrentConfig({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'nl', targetLanguage: 'en', debug: false });
  const nodes = [];
  collectNodes(document.body, nodes);
  await translateBatch(nodes, { requests: 0, tokens: 0, words: 0, start: Date.now(), totalRequests: 0 });
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    action: 'translation-status',
    status: expect.objectContaining({ active: true, phase: 'translate', request: 1, requests: 2, progress: expect.any(Object) })
  }));
});

test('skips reference superscripts', () => {
  document.body.innerHTML = '<p>Hi<sup class="reference">[1]</sup></p>';
  const nodes = [];
  collectNodes(document.body, nodes);
  expect(nodes.map(n => n.textContent)).toEqual(['Hi']);
});

test('reuses cached translations for repeated text nodes', async () => {
  const stub = window.qwenTranslateBatch;
  const network = jest.fn(async texts => texts.map(t => `X${t}X`));
  const cache = new Map();
  window.qwenTranslateBatch = async ({ texts }) => {
    const out = [];
    const uncached = [];
    texts.forEach(t => {
      if (cache.has(t)) {
        out.push(cache.get(t));
      } else {
        uncached.push(t);
      }
    });
    if (uncached.length) {
      const res = await network(uncached);
      uncached.forEach((t, i) => cache.set(t, res[i]));
      out.push(...res);
    }
    return { texts: texts.map(t => cache.get(t)) };
  };

  setCurrentConfig({
    apiKey: 'k',
    apiEndpoint: 'https://e/',
    model: 'm',
    sourceLanguage: 'en',
    targetLanguage: 'es',
    debug: false,
  });

  document.body.innerHTML = '<p><span>Hello</span><span>World</span><span>Hello</span></p>';
  let nodes = [];
  collectNodes(document.body, nodes);
  await translateBatch(nodes);
  expect(network).toHaveBeenCalledTimes(1);
  expect(nodes.map(n => n.textContent)).toEqual(['XHelloX', 'XWorldX', 'XHelloX']);

  document.body.innerHTML = '<p><span>Hello</span><span>Hello</span></p>';
  nodes = [];
  collectNodes(document.body, nodes);
  await translateBatch(nodes);
  expect(network).toHaveBeenCalledTimes(1);
  expect(nodes.map(n => n.textContent)).toEqual(['XHelloX', 'XHelloX']);

  window.qwenTranslateBatch = stub;
});

test('batches DOM nodes respecting token limit', async () => {
  sendMessage.mockClear();
  window.qwenTranslateBatch = jest.fn(async ({ texts }) => ({ texts }));
  window.qwenLoadConfig = async () => ({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', debug: false });
  window.qwenThrottle = { approxTokens: jest.fn(() => 4000), getUsage: () => ({}) };
  document.body.innerHTML = '<p><span>A</span><span>A</span><span>B</span></p>';
  messageListener({ action: 'start' });
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const calls = window.qwenTranslateBatch.mock.calls.map(c => c[0].texts);
  expect(calls).toContainEqual(['A', 'A']);
  expect(calls).toContainEqual(['B']);
  delete window.qwenThrottle;
});

test('passes force flag to batch translator', async () => {
  const batch = jest.fn(async ({ texts }) => ({ texts }));
  window.qwenTranslateBatch = batch;
  document.body.innerHTML = '';
  window.qwenLoadConfig = async () => ({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', debug: false });
  messageListener({ action: 'start', force: true });
  await Promise.resolve();
  window.qwenThrottle = { approxTokens: jest.fn(() => 1), getUsage: () => ({}) };
  const node = document.createTextNode('Hi');
  await translateBatch([node]);
  expect(batch).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
});

test('clears cache on clear-cache message', () => {
  const clear = jest.fn();
  window.qwenClearCache = clear;
  messageListener({ action: 'clear-cache' });
  expect(clear).toHaveBeenCalled();
});
