import { isWasmAvailable, rewritePdf } from './engine.js';
import { safeFetchPdf } from './pdfFetch.js';

export async function regeneratePdfFromUrl(fileUrl, cfg, onProgress) {
  const buffer = await safeFetchPdf(fileUrl);
  if (!(cfg && cfg.useWasmEngine)) throw new Error('WASM engine disabled. Enable it in settings.');
  const available = await isWasmAvailable(cfg);
  if (!available) throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.');
  if (onProgress) onProgress({ phase: 'collect', page: 0, total: 1 });
  return await rewritePdf(buffer, cfg, onProgress);
}
