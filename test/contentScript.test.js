const sendMessage = jest.fn();
global.chrome = { runtime: { getURL: () => 'chrome-extension://abc/', onMessage: { addListener: () => {} }, sendMessage } };

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

test('uses dual models when enabled', async () => {
  const spy = jest.fn().mockResolvedValue({ texts: ['XaX'] });
  window.qwenTranslateBatch = spy;
  document.body.innerHTML = '<p>a</p>';
  setCurrentConfig({
    apiKey: 'k',
    apiEndpoint: 'https://e/',
    model: 'qwen-mt-turbo',
    dualMode: true,
    sourceLanguage: 'en',
    targetLanguage: 'es',
    debug: false,
  });
  const nodes = [];
  collectNodes(document.body, nodes);
  await translateBatch(nodes);
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ models: ['qwen-mt-turbo', 'qwen-mt-plus'] })
  );
});
