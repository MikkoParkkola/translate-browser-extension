// WASM engine loader and interface (MuPDF/PDFium + HarfBuzz + ICU4X + Noto)
// Looks for vendor assets under src/wasm/vendor/ and loads the selected engine.

export const WASM_ASSETS = [
  { path: 'mupdf.wasm', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.wasm' },
  { path: 'mupdf-wasm.js', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.js' },
  { path: 'mupdf.engine.js', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf.js' },
  { path: 'pdfium.wasm', url: 'https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.wasm' },
  { path: 'pdfium.js', url: 'https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.js' },
  { path: 'hb.wasm', url: 'https://unpkg.com/harfbuzzjs@0.4.8/hb.wasm' },
  { path: 'hb.js', url: 'https://unpkg.com/harfbuzzjs@0.4.8/hb.js' },
  { path: 'pdf-lib.js', url: 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js' },
];

let available = false;
let _impl = null;
let _lastChoice = 'auto';

async function check(base, path) {
  const url = base + path;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) return true;
  } catch {}
  try {
    // Fallback for environments where HEAD is disallowed
    const get = await fetch(url);
    return get.ok;
  } catch {
    return false;
  }
}

export async function chooseEngine(base, requested) {
  const wants = (requested || 'auto').toLowerCase();
  const hbOk = await check(base, 'hb.wasm');
  const icuOk = (await check(base, 'icu4x_segmenter.wasm')) || (await check(base, 'icu4x_segmenter_wasm_bg.wasm'));
  const pdfiumOk =
    (await check(base, 'pdfium.engine.js')) &&
    (await check(base, 'pdfium.js')) &&
    (await check(base, 'pdfium.wasm'));
  const mupdfOk =
    (await check(base, 'mupdf.engine.js')) &&
    (await check(base, 'mupdf-wasm.js')) &&
    ((await check(base, 'mupdf.wasm')) || (await check(base, 'mupdf-wasm.wasm')));
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
  return { choice, hbOk, icuOk, pdfiumOk, mupdfOk, overlayOk };
}

export async function downloadWasmAssets(dir, downloader) {
  const fs = require('fs');
  const path = require('path');
  const dl =
    downloader ||
    (async (url, dest) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to download ' + url);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, buf);
    });
  for (const a of WASM_ASSETS) {
    await dl(a.url, path.join(dir, a.path));
  }
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

if (typeof module !== 'undefined') {
  module.exports = {
    chooseEngine,
    isWasmAvailable,
    rewritePdf,
    WASM_ASSETS,
    downloadWasmAssets,
  };
}
