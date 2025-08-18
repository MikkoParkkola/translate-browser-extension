// @jest-environment jsdom

test('logs batch translation steps', async () => {
  jest.resetModules();
  const sendMessage = jest.fn();
  global.chrome = {
    runtime: {
      getURL: () => 'chrome-extension://abc/',
      onMessage: { addListener: jest.fn() },
      sendMessage,
    },
  };
  const entries = [];
  window.qwenLogger = {
    create(ns) {
      return {
        info: (...a) => entries.push({ ns, level: 'info', args: a }),
        debug: () => {}, warn: () => {}, error: () => {},
      };
    },
  };
  window.qwenTranslateBatch = async ({ texts }) => ({ texts: texts.map(t => `X${t}X`) });
  window.qwenLoadConfig = async () => ({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', debug: false });
  window.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  Element.prototype.getClientRects = () => [1];
  const { translateBatch, collectNodes, setCurrentConfig } = require('../src/contentScript.js');
  document.body.innerHTML = '<p><span>Hello</span></p>';
  setCurrentConfig({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', debug: false });
  const nodes = [];
  collectNodes(document.body, nodes);
  await translateBatch(nodes);
  expect(entries.some(e => e.ns === 'content' && e.level === 'info' && e.args[0] === 'starting batch translation')).toBe(true);
  expect(entries.some(e => e.ns === 'content' && e.level === 'info' && e.args[0] === 'finished batch translation')).toBe(true);
});

test('clears controllers on unload', async () => {
  jest.resetModules();
  const sendMessage = jest.fn();
  global.chrome = {
    runtime: {
      getURL: () => 'chrome-extension://abc/',
      onMessage: { addListener: jest.fn() },
      sendMessage,
    },
  };
  window.qwenLogger = {
    create() {
      return { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
    },
  };
  window.qwenTranslateBatch = ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  window.qwenLoadConfig = async () => ({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', debug: false });
  window.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  Element.prototype.getClientRects = () => [1];
  delete window.__qwenCSLoaded;
  const { translateBatch, collectNodes, setCurrentConfig, __controllerCount } = require('../src/contentScript.js');
  document.body.innerHTML = '<p><span>Hello</span></p>';
  setCurrentConfig({ apiKey: 'k', apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', debug: false });
  const nodes = [];
  collectNodes(document.body, nodes);
  const p = translateBatch(nodes);
  expect(__controllerCount()).toBe(1);
  window.dispatchEvent(new Event('beforeunload'));
  expect(__controllerCount()).toBe(0);
  await expect(p).rejects.toThrow('aborted');
});
