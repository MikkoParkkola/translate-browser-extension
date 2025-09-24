const fs = require('fs');
const path = require('path');
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const { JSDOM } = require('jsdom');

test('popup header displays branded product name', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup.html'), 'utf8');
  const dom = new JSDOM(html);
  const productName = dom.window.document.querySelector('#productName');
  expect(productName?.textContent?.trim()).toBe('TRANSLATE!');

  const productAuthor = dom.window.document.querySelector('#productAuthor');
  expect(productAuthor?.textContent?.trim()).toBe('by Mikko');

  const body = dom.window.document.body;
  expect(body.classList.contains('popup-body')).toBe(true);
  expect(body.dataset.theme).toBe('light');
});

test('popup translate button has structured content and loading state elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup.html'), 'utf8');
  const dom = new JSDOM(html);
  const btn = dom.window.document.querySelector('#translate-button');
  expect(btn).toBeTruthy();
  expect(btn.querySelector('.button-text')?.textContent?.trim()).toBe('Translate Selection');
  expect(btn.querySelector('.button-loading')).not.toBeNull();
  expect(btn.querySelector('.progress-bar-mini')).not.toBeNull();
});

