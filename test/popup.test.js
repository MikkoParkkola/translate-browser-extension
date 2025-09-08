const fs = require('fs');
const path = require('path');
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const { JSDOM } = require('jsdom');

test('popup header displays product name with link', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup.html'), 'utf8');
  const dom = new JSDOM(html);
  const h1 = dom.window.document.querySelector('h1');
  expect(h1?.textContent).toBe('Translator');
});

test('built popup includes product name with link', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'popup.html'), 'utf8');
  const dom = new JSDOM(html);
  const h1 = dom.window.document.querySelector('h1');
  expect(h1?.textContent).toBe('Translate');
});

test('built popup css styles product name', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'dist', 'styles', 'popup.css'), 'utf8');
  expect(css).toMatch(/#productName/);
});
