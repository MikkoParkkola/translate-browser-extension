// MuPDF engine wrapper scaffold. Replace with real integration.
export async function init({ baseURL }) {
  // TODO: load and initialize mupdf.wasm/js + helpers (hb, icu4x)
  async function rewrite(buffer, cfg, onProgress) {
    throw new Error('MuPDF rewrite engine not implemented yet. Provide mupdf wasm + glue.');
  }
  return { rewrite };
}

