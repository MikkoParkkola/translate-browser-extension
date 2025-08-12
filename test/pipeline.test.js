const fs = require('fs');
const path = require('path');

function loadPipeline() {
  const code = fs.readFileSync(path.join(__dirname, '../src/wasm/pipeline.js'), 'utf8');
  const transformed = code
    .replace("import { isWasmAvailable, rewritePdf, WASM_ASSETS } from './engine.js';", "const { isWasmAvailable, rewritePdf, WASM_ASSETS } = require('../src/wasm/engine.js');")
    .replace("import { safeFetchPdf } from './pdfFetch.js';", "const { safeFetchPdf } = require('../src/wasm/pdfFetch.js');")
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
    global.alert = jest.fn();
  });
  afterEach(() => {
    delete global.chrome;
    delete global.alert;
  });
  it('triggers asset downloads before failing', async () => {
    const { regeneratePdfFromUrl } = loadPipeline();
    await expect(
      regeneratePdfFromUrl('https://example.com/a.pdf', { useWasmEngine: true })
    ).rejects.toThrow('WASM engine not available');
    expect(global.chrome.downloads.download).toHaveBeenCalledWith({
      url: 'https://example.com/engine.wasm',
      filename: 'wasm/vendor/engine.wasm',
    });
    expect(global.alert).toHaveBeenCalled();
  });
});
