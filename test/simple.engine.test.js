const fs = require('fs');
const path = require('path');
const { TextEncoder } = require('util');

global.TextEncoder = TextEncoder;
if (typeof global.structuredClone !== 'function') {
  global.structuredClone = obj => JSON.parse(JSON.stringify(obj));
}
class FakeBlob {
  constructor(parts) { this.data = parts[0]; }
  text() { return Promise.resolve(Buffer.from(this.data).toString()); }
  arrayBuffer() { return Promise.resolve(this.data.buffer); }
}
global.Blob = FakeBlob;

function loadBuilder() {
  const code = fs.readFileSync(path.join(__dirname, '../src/wasm/vendor/simple.engine.js'), 'utf8');
  const transformed = code.replace(/export\s+/g, '');
  const fn = new Function(transformed + '\nreturn { buildSimplePdf };');
  return fn().buildSimplePdf;
}

describe('buildSimplePdf', () => {
  it('creates a PDF that can be parsed', async () => {
    const buildSimplePdf = loadBuilder();
    const blob = buildSimplePdf([{ width: 200, height: 200, lines: ['hello world'] }]);
    const text = await blob.text();
    expect(text.startsWith('%PDF-')).toBe(true);
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    expect(pdf.numPages).toBe(1);
  });
});
