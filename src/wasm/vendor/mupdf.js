// Wrapper stub; replace calls with actual MuPDF/PDFium APIs once available.
// Expected to run in the viewer (browser) context.

export async function init({ baseURL }) {
  // Load underlying engine and helpers here (mupdf.wasm/js, hb.wasm/js, icu4x wasm/js)
  // For now, throw if missing — the pipeline is WASM-only.
  async function rewrite(buffer, cfg, onProgress) {
    throw new Error('MuPDF/PDFium rewrite engine not wired yet. Place engine assets and implement rewrite().');
  }
  return { rewrite };
}

