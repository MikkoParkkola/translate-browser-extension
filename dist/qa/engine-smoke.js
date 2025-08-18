import * as engine from '../wasm/engine.js';
// Mock translator: identity mapping to avoid network
window.qwenTranslateBatch = async ({ texts }) => ({ texts });
// pdf.js worker (disabled due to file:// restrictions in tests)
pdfjsLib.GlobalWorkerOptions.workerSrc = '../pdf.worker.min.js';
pdfjsLib.disableWorker = true;

const qs = new URLSearchParams(location.search);
const eng = qs.get('engine') || 'simple';
const status = document.getElementById('status');
const out = document.getElementById('out');

async function makePdf(bytes) {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const txt = 'Hello engine test';
  page.drawText(txt, { x: 50, y: 150, size: 18, font });
  return await doc.save();
}

(async () => {
  try {
    const input = await makePdf();
    const cfg = { useWasmEngine: true, wasmEngine: eng };
    const blob = await engine.rewritePdf(input, cfg, (p)=>{ /* progress noop */ });
    // Render first page
    const buf = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    out.appendChild(canvas);
    window.smokeOk = true;
    status.textContent = 'ok ('+eng+')';
  } catch (e) {
    console.error(e);
    status.textContent = 'failed: '+e.message;
  }
})();

