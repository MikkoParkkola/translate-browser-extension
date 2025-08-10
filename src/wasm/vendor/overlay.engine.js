// Overlay engine: render original pages to images, overlay translated text block.
export async function init({ baseURL }) {
  async function rewrite(buffer, cfg, onProgress) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
    if (!window.qwenTranslateBatch) throw new Error('translator not available');
    const endpoint = cfg.apiEndpoint || cfg.endpoint;
    const model = cfg.model || cfg.modelName;
    const source = cfg.sourceLanguage || cfg.source;
    const target = cfg.targetLanguage || cfg.target;

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const total = pdf.numPages;
    const pageData = [];
    for (let i=1;i<=total;i++) {
      if (onProgress) onProgress({ phase: 'collect', page: i, total });
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const textContent = await page.getTextContent();
      const items = textContent.items.map(it => (it.str||'').trim()).filter(Boolean);
      const block = items.join(' ');
      pageData.push({ w: canvas.width, h: canvas.height, img: canvas.toDataURL('image/jpeg', 0.85), text: block });
    }

    // Translate all blocks
    const texts = pageData.map(p => p.text);
    async function translate(texts, budget = 1800, batch = 40) {
      try {
        return await window.qwenTranslateBatch({
          texts,
          endpoint,
          apiKey: cfg.apiKey,
          model,
          source,
          target,
          tokenBudget: budget,
          maxBatchSize: batch,
        });
      } catch (e) {
        if (e && /HTTP 400/i.test(e.message || '')) {
          return translate(
            texts,
            Math.max(400, Math.floor(budget * 0.6)),
            Math.max(1, Math.floor(batch * 0.6)),
          );
        }
        throw e;
      }
    }
    const tr = await translate(texts);
    const outTexts = (tr && Array.isArray(tr.texts)) ? tr.texts : texts;

    // Use pdf-lib via global script; dynamically inject if needed
    let pdfLib = window.PDFLib;
    if (!pdfLib) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = baseURL + 'pdf-lib.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
        pdfLib = window.PDFLib;
      } catch {}
    }
    if (!pdfLib || !(pdfLib.PDFDocument)) {
      throw new Error('pdf-lib not available for Overlay engine');
    }
    const { PDFDocument, StandardFonts, rgb } = pdfLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i=0;i<pageData.length;i++) {
      if (onProgress) onProgress({ phase: 'render', page: i+1, total });
      const p = pageData[i];
      const page = doc.addPage([p.w, p.h]);
      const jpgBytes = atob(p.img.split(',')[1]);
      const arr = new Uint8Array(jpgBytes.length);
      for (let j=0;j<jpgBytes.length;j++) arr[j]=jpgBytes.charCodeAt(j);
      const jpg = await doc.embedJpg(arr);
      page.drawImage(jpg, { x:0, y:0, width:p.w, height:p.h });
      // Draw translated text block in a box for readability
      const margin = 40;
      const boxW = p.w - margin*2;
      const text = (outTexts[i]||'').trim();
      if (text) {
        page.drawText(text, { x: margin, y: p.h - margin - 14, size: 12, font, color: rgb(0.05,0.05,0.05), maxWidth: boxW, lineHeight: 14 });
      }
    }
    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }
  return { rewrite };
}
