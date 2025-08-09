// WASM engine loader and interface (MuPDF/PDFium + HarfBuzz + ICU4X + Noto)
// Looks for vendor assets under src/wasm/vendor/ and loads the selected engine.

let available = false;
let _impl = null;
let _lastChoice = 'auto';

async function check(base, path) {
  try { const r = await fetch(base + path, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

async function chooseEngine(base, requested) {
  const wants = (requested || 'auto').toLowerCase();
  const hbOk = await check(base, 'hb.wasm');
  const icuOk = (await check(base, 'icu4x_segmenter.wasm')) || (await check(base, 'icu4x_segmenter_wasm_bg.wasm'));
  const pdfiumOk = await check(base, 'pdfium.wasm');
  const mupdfOk = await check(base, 'mupdf.wasm');
  const overlayOk = await check(base, 'pdf-lib.js');

  function pick() {
    if (wants === 'mupdf') return 'mupdf';
    if (wants === 'pdfium') return 'pdfium';
    if (wants === 'overlay') return 'overlay';
    if (wants === 'simple') return 'simple';
    // auto: prefer MuPDF if present; else PDFium; else Overlay; else Simple
    if (mupdfOk) return 'mupdf';
    if (pdfiumOk) return 'pdfium';
    if (overlayOk) return 'overlay';
    return 'simple';
  }
  const choice = pick();
  return { choice, hbOk, icuOk, pdfiumOk, mupdfOk };
}

async function loadEngine(cfg) {
  if (_impl && cfg && (cfg.wasmEngine || 'auto') === _lastChoice) return _impl;
  try {
    const base = new URL('./vendor/', import.meta.url).href;
    const requested = cfg && cfg.wasmEngine;
    const { choice, hbOk, icuOk, pdfiumOk, mupdfOk } = await chooseEngine(base, requested);
    if (!choice) { _lastChoice = 'auto'; }
    // Strict mode: if requested engine assets missing, do not fallback
    const strict = !!(cfg && cfg.wasmStrict);
    if (strict) {
      const need = requested || 'auto';
      if (need === 'mupdf' && !mupdfOk) throw new Error('MuPDF assets missing in strict mode');
      if (need === 'pdfium' && !pdfiumOk) throw new Error('PDFium assets missing in strict mode');
    }
    _lastChoice = choice;
    let wrapper = 'simple.engine.js';
    if (choice === 'mupdf') wrapper = 'mupdf.engine.js';
    else if (choice === 'pdfium') wrapper = 'pdfium.engine.js';
    else if (choice === 'simple') wrapper = 'simple.engine.js';
    else if (choice === 'overlay') wrapper = 'overlay.engine.js';
    let engineMod;
    try {
      engineMod = await import(/* @vite-ignore */ base + wrapper);
    } catch (e) {
      available = false;
      _impl = { async rewritePdf() { throw new Error(`WASM ${choice} wrapper not wired. Implement rewrite() in src/wasm/vendor/${wrapper}`); } };
      return _impl;
    }
    const engine = await engineMod.init({ baseURL: base, hasHB: hbOk, hasICU: icuOk, hasPDF: choice === 'pdfium' ? pdfiumOk : mupdfOk });
    if (!engine || typeof engine.rewrite !== 'function') {
      available = false;
      _impl = { async rewritePdf() { throw new Error(`WASM ${choice} wrapper missing rewrite()`); } };
      return _impl;
    }
    _impl = {
      async rewritePdf(buffer, cfg2, onProgress) {
        if (onProgress) onProgress({ phase: 'rewrite', page: 0, total: 1 });
        return await engine.rewrite(buffer, cfg2, onProgress);
      },
    };
    available = true;
  } catch (e) {
    available = false;
    _impl = { async rewritePdf() { throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.'); } };
  }
  return _impl;
}

export async function isWasmAvailable(cfg) {
  if (_impl && (cfg?.wasmEngine || 'auto') === _lastChoice) return available;
  await loadEngine(cfg);
  return available;
}

export async function rewritePdf(buffer, cfg, onProgress) {
  const impl = await loadEngine(cfg);
  return impl.rewritePdf(buffer, cfg, onProgress);
}
