import { isWasmAvailable, rewritePdf, WASM_ASSETS } from './engine.js';
import { safeFetchPdf } from './pdfFetch.js';

export async function regeneratePdfFromUrl(fileUrl, cfg, onProgress) {
  console.log(`DEBUG: regeneratePdfFromUrl start ${fileUrl}`);
  const buffer = await safeFetchPdf(fileUrl);
  console.log(`DEBUG: fetched original PDF size ${buffer.byteLength} bytes`);
  if (!(cfg && cfg.useWasmEngine)) {
    console.log('DEBUG: WASM engine disabled in config');
    throw new Error('WASM engine disabled. Enable it in settings.');
  }
  const available = await isWasmAvailable(cfg);
  console.log(`DEBUG: WASM engine available ${available}`);
  if (!available) {
    console.log('DEBUG: WASM engine not available');
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      for (const a of WASM_ASSETS) {
        chrome.downloads.download({ url: a.url, filename: `wasm/vendor/${a.path}` });
      }
      if (typeof alert === 'function') {
        alert('Downloading engine assets. Copy the "wasm" folder into the extension directory and reload.');
      }
    }
    throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.');
  }
  if (onProgress) onProgress({ phase: 'collect', page: 0, total: 1 });
  return await rewritePdf(buffer, cfg, p => {
    console.log('DEBUG: rewrite progress', p);
    if (onProgress) onProgress(p);
  });
}
