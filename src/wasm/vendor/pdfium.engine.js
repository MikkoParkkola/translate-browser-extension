// PDFium engine wrapper scaffold. Replace with real integration.
export async function init({ baseURL }) {
  // Use PDFium if a real integration exists; otherwise fall back to overlay engine
  try {
    const mod = await import(/* @vite-ignore */ baseURL + 'pdfium.js');
    if (mod && typeof mod.rewrite === 'function') {
      return { rewrite: mod.rewrite };
    }
  } catch {}
  const { init: overlayInit } = await import(/* @vite-ignore */ baseURL + 'overlay.engine.js');
  return overlayInit({ baseURL });
}
