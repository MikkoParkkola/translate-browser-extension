global.chrome = { runtime: { getURL: () => 'chrome-extension://abc/', onMessage: { addListener: () => {} } } };

window.qwenTranslateBatch = async ({ texts }) => ({ texts: texts.map(t => `X${t}X`) });
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
