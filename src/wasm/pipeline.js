import { isWasmAvailable, rewritePdf } from './engine.js';

export async function regeneratePdfFromUrl(fileUrl, cfg, onProgress) {
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error(`Failed to fetch PDF: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  if (!(cfg && cfg.useWasmEngine)) throw new Error('WASM engine disabled. Enable it in settings.');
  const available = await isWasmAvailable();
  if (!available) throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.');
  if (onProgress) onProgress({ phase: 'collect', page: 0, total: 1 });
  return await rewritePdf(buffer, cfg, onProgress);
}

