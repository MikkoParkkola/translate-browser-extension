// PDFium engine wrapper scaffold. Replace with real integration.
export async function init({ baseURL }) {
  // Try to load PDFium vendor JS if present; otherwise fall back to overlay engine
  let mod = null;
  try {
    mod = await import(/* @vite-ignore */ baseURL + 'pdfium.js');
  } catch {}
  if (!mod) {
    const { init: overlayInit } = await import(/* @vite-ignore */ baseURL + 'overlay.engine.js');
    return overlayInit({ baseURL });
  }
  // Placeholder: return the original PDF unchanged
  async function rewrite(buffer, cfg, onProgress) {
    try {
      if (onProgress) onProgress({ phase: 'rewrite', page: 1, total: 1 });
      const blob = new Blob([buffer], { type: 'application/pdf' });
      return blob;
    } catch (e) {
      throw new Error('PDFium PoC rewrite failed: ' + e.message);
    }
  }
  return { rewrite };
}
