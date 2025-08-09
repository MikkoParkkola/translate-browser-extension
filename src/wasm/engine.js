// WASM engine loader and interface (MuPDF/PDFium + HarfBuzz + ICU4X + Noto)
// This is a scaffold that looks for vendor assets packaged under src/wasm/vendor/.
// When present, it exposes rewritePdf(buffer, cfg, onProgress), returning a Blob of the rewritten PDF.

let available = false;
let _impl = null;

async function loadVendors() {
  if (_impl) return _impl;
  try {
    const base = new URL('./vendor/', import.meta.url).href;
    async function head(path) {
      try { const r = await fetch(base + path, { method: 'HEAD' }); return r.ok; } catch { return false; }
    }
    const checks = await Promise.all([
      head('hb.wasm'),
      head('pdfium.wasm'),
      head('mupdf.wasm'),
      head('icu4x_segmenter.wasm'),
    ]);
    const [hbOk, pdfOk, mupdfOk, icuOk] = checks;
    if (!(hbOk && pdfOk && mupdfOk && icuOk)) {
      available = false;
      _impl = {
        async rewritePdf() {
          throw new Error('WASM engine not available. Missing vendor assets.');
        },
      };
      return _impl;
    }
    // Load engine wrapper; must implement rewrite()
    const engineMod = await import(/* @vite-ignore */ base + 'mupdf.js');
    const engine = await engineMod.init({ baseURL: base, hasHB: hbOk, hasPDF: pdfOk });
    if (!engine || typeof engine.rewrite !== 'function') {
      available = false;
      _impl = {
        async rewritePdf() {
          throw new Error('WASM engine wrapper not wired. Implement rewrite() in src/wasm/vendor/mupdf.js');
        },
      };
      return _impl;
    }
    _impl = {
      async rewritePdf(buffer, cfg, onProgress) {
        if (onProgress) onProgress({ phase: 'rewrite', page: 0, total: 1 });
        return await engine.rewrite(buffer, cfg, onProgress);
      },
    };
    available = true;
  } catch (e) {
    available = false;
    _impl = {
      async rewritePdf() {
        throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.');
      },
    };
  }
  return _impl;
}

export async function isWasmAvailable() {
  if (_impl) return available;
  await loadVendors();
  return available;
}

export async function rewritePdf(buffer, cfg, onProgress) {
  const impl = await loadVendors();
  return impl.rewritePdf(buffer, cfg, onProgress);
}
