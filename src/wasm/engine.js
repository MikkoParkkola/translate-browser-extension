// WASM engine loader and interface (MuPDF/PDFium + HarfBuzz + ICU4X + Noto)
// Looks for vendor assets under src/wasm/vendor/ and loads the selected engine.

export const WASM_ASSETS = [
  { path: 'mupdf-wasm.wasm', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.wasm' },
  // Some versions look for mupdf.wasm directly.
  { path: 'mupdf.wasm', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.wasm' },
  { path: 'mupdf-wasm.js', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.js' },
  { path: 'mupdf.engine.js', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf.js' },
  { path: 'pdfium.wasm', url: 'https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.wasm' },
  { path: 'pdfium.js', url: 'https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.js' },
  {
    path: 'pdfium.engine.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/pdfium.engine.js',
  },
  { path: 'hb.wasm', url: 'https://unpkg.com/harfbuzzjs@0.4.8/hb.wasm' },
  { path: 'hb.js', url: 'https://unpkg.com/harfbuzzjs@0.4.8/hb.js' },
  {
    path: 'icu4x_segmenter.wasm',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/icu4x_segmenter.wasm',
  },
  {
    path: 'icu4x_segmenter.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/icu4x_segmenter.js',
  },
  { path: 'pdf-lib.js', url: 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js' },
  {
    path: 'overlay.engine.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/overlay.engine.js',
  },
  {
    path: 'simple.engine.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/simple.engine.js',
  },
  {
    path: 'fonts/NotoSans-Regular.ttf',
    url: 'https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf',
  },
  {
    path: 'fonts/NotoSans-Bold.ttf',
    url: 'https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf',
  },
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
  console.log('DEBUG: chooseEngine requested', wants);
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
  console.log('DEBUG: engine assets', { hbOk, icuOk, pdfiumOk, mupdfOk, overlayOk });

  function pick() {
    if (wants === 'mupdf') return mupdfOk ? 'mupdf' : (pdfiumOk ? 'pdfium' : (overlayOk ? 'overlay' : 'simple'));
    if (wants === 'pdfium') return pdfiumOk ? 'pdfium' : (mupdfOk ? 'mupdf' : (overlayOk ? 'overlay' : 'simple'));
    if (wants === 'overlay') return overlayOk ? 'overlay' : (pdfiumOk ? 'pdfium' : (mupdfOk ? 'mupdf' : 'simple'));
    if (wants === 'simple') return 'simple';
    // auto: prefer PDFium if present; then MuPDF; then Overlay; else Simple
    if (pdfiumOk) return 'pdfium';
    if (mupdfOk) return 'mupdf';
    if (overlayOk) return 'overlay';
    return 'simple';
  }
  const choice = pick();
  console.log('DEBUG: chooseEngine selected', choice);
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
  console.log('DEBUG: loadEngine start', cfg && cfg.wasmEngine);
  try {
    const base = new URL('./vendor/', import.meta.url).href;
    const requested = cfg && cfg.wasmEngine;
    const { choice, hbOk, icuOk, pdfiumOk, mupdfOk } = await chooseEngine(base, requested);
    if (!choice) { _lastChoice = 'auto'; }
    console.log('DEBUG: loadEngine choice', choice);
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
    if (choice === 'mupdf') {
      globalThis.$libmupdf_wasm_Module = {
        locateFile: (p) => base + p,
      };
    }
    let engineMod;
    try {
      console.log(`DEBUG: importing wrapper ${wrapper}`);
      engineMod = await import(/* @vite-ignore */ base + wrapper);
    } catch (e) {
      console.error('DEBUG: wrapper import failed', e);
      available = false;
      _impl = { async rewritePdf() { throw new Error(`WASM ${choice} wrapper not wired. Implement rewrite() in src/wasm/vendor/${wrapper}`); } };
      return _impl;
    }
    const engine = await engineMod.init({ baseURL: base, hasHB: hbOk, hasICU: icuOk, hasPDF: choice === 'pdfium' ? pdfiumOk : mupdfOk });
    console.log('DEBUG: engine module initialized');
    if (!engine || typeof engine.rewrite !== 'function') {
      available = false;
      _impl = { async rewritePdf() { throw new Error(`WASM ${choice} wrapper missing rewrite()`); } };
      return _impl;
    }
    _impl = {
      async rewritePdf(buffer, cfg2, onProgress) {
        console.log(`DEBUG: rewritePdf called size ${buffer.byteLength} bytes`);
        if (onProgress) onProgress({ phase: 'rewrite', page: 0, total: 1 });
        return await engine.rewrite(buffer, cfg2, p => {
          console.log('DEBUG: engine progress', p);
          if (onProgress) onProgress(p);
        });
      },
    };
    available = true;
    console.log('DEBUG: engine loaded', choice);
  } catch (e) {
    available = false;
    console.error('DEBUG: loadEngine failed', e);
    _impl = { async rewritePdf() { throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.'); } };
  }
  return _impl;
}

export async function isWasmAvailable(cfg) {
  console.log('DEBUG: isWasmAvailable check');
  if (_impl && (cfg?.wasmEngine || 'auto') === _lastChoice) return available;
  await loadEngine(cfg);
  return available;
}

export async function rewritePdf(buffer, cfg, onProgress) {
  console.log(`DEBUG: rewritePdf entry size ${buffer.byteLength} bytes`);
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
