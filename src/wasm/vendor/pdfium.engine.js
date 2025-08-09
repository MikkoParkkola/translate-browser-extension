// PDFium engine wrapper scaffold. Replace with real integration.
export async function init({ baseURL }) {
  // TODO: load and initialize pdfium.wasm/js + helpers (hb, icu4x)
  async function rewrite(buffer, cfg, onProgress) {
    throw new Error('PDFium rewrite engine not implemented yet. Provide pdfium wasm + glue.');
  }
  return { rewrite };
}

