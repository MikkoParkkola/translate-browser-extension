const fs = require('fs');
const path = require('path');
require('fake-indexeddb/auto');
if (typeof global.structuredClone !== 'function') {
  global.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}

function loadSessionPdf() {
  const code = fs.readFileSync(path.join(__dirname, '../src/sessionPdf.js'), 'utf8').replace(/export\s+/g, '');
  const module = { exports: {} };
  const fn = new Function('require', 'module', 'exports', code + '\nreturn { storePdfInSession, readPdfFromSession };');
  return fn(require, module, module.exports);
}

const { storePdfInSession, readPdfFromSession } = loadSessionPdf();

describe('sessionPdf', () => {
  it('stores and retrieves a PDF via IndexedDB', async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const key = await storePdfInSession(data.buffer);
    const buf = await readPdfFromSession(key);
    expect(new Uint8Array(buf)).toEqual(data);
  });
});
