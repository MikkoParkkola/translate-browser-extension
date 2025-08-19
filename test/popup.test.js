const fs = require('fs');
const path = require('path');
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const { JSDOM } = require('jsdom');

test('popup header displays product name', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup.html'), 'utf8');
  const dom = new JSDOM(html);
  const text = dom.window.document.getElementById('productName')?.textContent;
  expect(text).toBe('TRANSLATE! by Mikko');
});
