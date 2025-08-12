import { resolveAssetPath } from '../engine.js';

export async function init({ baseURL }) {
  async function rewrite(buffer, cfg, onProgress) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
    if (!window.qwenTranslateBatch) throw new Error('translator not available');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const total = pdf.numPages;
    const pages = [];
    for (let i = 1; i <= total; i++) {
      if (onProgress) onProgress({ phase: 'collect', page: i, total });
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const lines = [];
      for (const it of textContent.items) {
        const text = (it.str || '').trim();
        if (!text) continue;
        const m = pdfjsLib.Util.transform(viewport.transform, it.transform);
        const size = Math.hypot(m[0], m[2]);
        const x = m[4];
        const y = viewport.height - m[5];
        let line = lines.find(l => Math.abs(l.y - y) < size * 0.5);
        if (!line) {
          line = { y, x, size, parts: [] };
          lines.push(line);
        }
        line.x = Math.min(line.x, x);
        line.parts.push({ x, text });
      }
      const items = lines
        .sort((a, b) => b.y - a.y)
        .map(l => ({
          text: l.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' '),
          x: l.x,
          y: l.y,
          size: l.size,
        }));
      pages.push({ width: viewport.width, height: viewport.height, items });
    }
    const texts = pages.flatMap(p => p.items.map(i => i.text));
    let outTexts = texts;
    if (texts.length) {
      const endpoint = cfg.apiEndpoint || cfg.endpoint;
      const model = cfg.model || cfg.modelName;
      const source = cfg.sourceLanguage || cfg.source;
      const target = cfg.targetLanguage || cfg.target;
      const tr = await window.qwenTranslateBatch({ texts, endpoint, apiKey: cfg.apiKey, model, source, target });
      outTexts = (tr && Array.isArray(tr.texts)) ? tr.texts : texts;
    }
    let idx = 0;
    pages.forEach(p => p.items.forEach(it => { it.text = outTexts[idx++] || it.text; }));
    let pdfLib = window.PDFLib;
    if (!pdfLib) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = resolveAssetPath('pdf-lib.js');
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
        pdfLib = window.PDFLib;
      } catch {}
    }
    if (!pdfLib || !(pdfLib.PDFDocument)) {
      throw new Error('pdf-lib not available');
    }
    const { PDFDocument, StandardFonts, rgb } = pdfLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages.length; i++) {
      if (onProgress) onProgress({ phase: 'render', page: i + 1, total: pages.length });
      const p = pages[i];
      const page = doc.addPage([p.width, p.height]);
      page.drawRectangle({ x: 0, y: 0, width: p.width, height: p.height, color: rgb(1, 1, 1) });
      for (const it of p.items) {
        page.drawText(it.text, { x: it.x, y: it.y, size: it.size || 12, font, color: rgb(0.05, 0.05, 0.05) });
      }
    }
    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }
  return { rewrite };
}
