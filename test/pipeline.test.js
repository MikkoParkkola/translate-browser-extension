const fs = require('fs');
const path = require('path');

function loadPipeline() {
  const code = fs.readFileSync(path.join(__dirname, '../src/wasm/pipeline.js'), 'utf8');
  const transformed = code
    .replace(/import[^\n]+engine\.js';/, "const { isWasmAvailable, rewritePdf } = require('../src/wasm/engine.js');")
    .replace(/import[^\n]+pdfFetch\.js';/, "const { safeFetchPdf } = require('../src/wasm/pdfFetch.js');")
    .replace(/export\s+/g, '');
  const module = { exports: {} };
  const fn = new Function('require', 'module', 'exports', transformed + '\nreturn { regeneratePdfFromUrl };');
  return fn(require, module, module.exports);
}

jest.mock('../src/wasm/engine.js', () => ({
  isWasmAvailable: jest.fn().mockResolvedValue(false),
  rewritePdf: jest.fn(),
  WASM_ASSETS: [
    { path: 'engine.wasm', url: 'https://example.com/engine.wasm' },
  ],
}));

jest.mock('../src/wasm/pdfFetch.js', () => ({
  safeFetchPdf: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
}));

describe('regeneratePdfFromUrl when engine missing', () => {
  beforeEach(() => {
    global.chrome = { downloads: { download: jest.fn() } };
  });
  afterEach(() => {
    delete global.chrome;
  });
  it('fails without triggering downloads', async () => {
    const { regeneratePdfFromUrl } = loadPipeline();
    await expect(
      regeneratePdfFromUrl('https://example.com/a.pdf', { useWasmEngine: true })
    ).rejects.toThrow('WASM engine not available');
    expect(global.chrome.downloads.download).not.toHaveBeenCalled();
  });
});
