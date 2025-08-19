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

describe('chooseEngine integration', () => {
  const origFetch = global.fetch;
  let consoleSpy;

  afterEach(() => {
    global.fetch = origFetch;
    if (consoleSpy) consoleSpy.mockRestore();
  });

  function mockAssets(ok) {
    global.fetch = jest.fn(url => {
      if (ok.has(url)) return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: false });
    });
  }

  it('selects pdfium over other engines when pdfium assets are available', async () => {
    const { chooseEngine } = loadEngine();
    const ok = new Set([
      'base/pdfium.engine.js',
      'base/pdfium.js',
      'base/pdfium.wasm',
      'base/pdf-lib.js',
    ]);
    mockAssets(ok);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { choice } = await chooseEngine('base/', 'auto');
    expect(choice).toBe('pdfium');
    expect(consoleSpy).toHaveBeenCalledWith('DEBUG: engine assets', expect.objectContaining({
      pdfiumOk: true,
      mupdfOk: false,
      overlayOk: true,
    }));
    expect(consoleSpy).toHaveBeenCalledWith('DEBUG: chooseEngine selected', 'pdfium');
  });

  it('falls back to mupdf when pdfium assets missing', async () => {
    const { chooseEngine } = loadEngine();
    const ok = new Set([
      'base/mupdf.engine.js',
      'base/mupdf-wasm.js',
      'base/mupdf.wasm',
      'base/pdf-lib.js',
    ]);
    mockAssets(ok);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { choice } = await chooseEngine('base/', 'auto');
    expect(choice).toBe('mupdf');
    expect(consoleSpy).toHaveBeenCalledWith('DEBUG: engine assets', expect.objectContaining({
      pdfiumOk: false,
      mupdfOk: true,
      overlayOk: true,
    }));
    expect(consoleSpy).toHaveBeenCalledWith('DEBUG: chooseEngine selected', 'mupdf');
  });

  it('falls back to overlay when only overlay assets present', async () => {
    const { chooseEngine } = loadEngine();
    const ok = new Set(['base/pdf-lib.js']);
    mockAssets(ok);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { choice } = await chooseEngine('base/', 'auto');
    expect(choice).toBe('overlay');
    expect(consoleSpy).toHaveBeenCalledWith('DEBUG: engine assets', expect.objectContaining({
      pdfiumOk: false,
      mupdfOk: false,
      overlayOk: true,
    }));
    expect(consoleSpy).toHaveBeenCalledWith('DEBUG: chooseEngine selected', 'overlay');
  });
});

