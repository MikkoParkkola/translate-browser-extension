const fs = require('fs');
const path = require('path');

function loadEngine() {
  const code = fs.readFileSync(path.join(__dirname, '../src/wasm/engine.js'), 'utf8');
  const transformed = code
    .replace(/export\s+/g, '')
    .replace(/import\.meta/g, '({url: ""})');
  const module = { exports: {} };
  const fn = new Function('require', 'module', 'exports', transformed + '\nreturn module.exports;');
  return fn(require, module, module.exports);
}

describe('chooseEngine', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('falls back when mupdf loader is missing', async () => {
    const { chooseEngine } = loadEngine();
    const ok = new Set([
      'base/mupdf.engine.js',
      'base/mupdf-wasm.wasm',
      'base/mupdf.wasm',
      'base/pdfium.engine.js',
      'base/pdfium.js',
      'base/pdfium.wasm',
      'base/hb.wasm',
      'base/icu4x_segmenter.wasm',
      'base/pdf-lib.js',
    ]);
    global.fetch = jest.fn((url) => {
      if (ok.has(url)) return Promise.resolve({ ok: true });
      return Promise.reject(new Error('missing'));
    });
    const { choice, mupdfOk, pdfiumOk } = await chooseEngine('base/', 'auto');
    expect(mupdfOk).toBe(false);
    expect(pdfiumOk).toBe(true);
    expect(choice).toBe('pdfium');
  });

  it('downgrades requested mupdf when assets missing', async () => {
    const { chooseEngine } = loadEngine();
    const ok = new Set([
      'base/pdfium.engine.js',
      'base/pdfium.js',
      'base/pdfium.wasm',
      'base/hb.wasm',
      'base/icu4x_segmenter.wasm',
      'base/pdf-lib.js',
    ]);
    global.fetch = jest.fn(url => {
      if (ok.has(url)) return Promise.resolve({ ok: true });
      return Promise.reject(new Error('missing'));
    });
    const { choice, mupdfOk, pdfiumOk } = await chooseEngine('base/', 'mupdf');
    expect(mupdfOk).toBe(false);
    expect(pdfiumOk).toBe(true);
    expect(choice).toBe('pdfium');
  });

  it('loads engines after assets downloaded', async () => {
    const { chooseEngine, WASM_ASSETS, downloadWasmAssets } = loadEngine();
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-'));
  await downloadWasmAssets(tmp, (url, dest) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, '');
  });
  global.fetch = jest.fn(url => {
    const rel = url.replace('base/', '');
    const p = path.join(tmp, rel);
    if (fs.existsSync(p)) return Promise.resolve({ ok: true });
    return Promise.reject(new Error('missing'));
    });
    const { choice, mupdfOk, pdfiumOk } = await chooseEngine('base/', 'auto');
    for (const a of WASM_ASSETS) {
      expect(fs.existsSync(path.join(tmp, a.path))).toBe(true);
    }
    expect(mupdfOk).toBe(true);
    expect(pdfiumOk).toBe(true);
    expect(choice).toBe('pdfium');
  });
});
