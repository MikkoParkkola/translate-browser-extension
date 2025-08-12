import { resolveAssetPath } from '../engine.js';

export function dedupeItems(items) {
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const key = `${it.text}@@${Math.round(it.x)}_${Math.round(it.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export function groupTextItems(textContent, viewport, ctx) {
  const lines = [];
  for (const it of textContent.items) {
    const raw = (it.str || '').trim();
    if (!raw) continue;
    const m = pdfjsLib.Util.transform(viewport.transform, it.transform);
    const size = Math.hypot(m[0], m[2]);
    const x = m[4];
    const y = viewport.height - m[5];
    const width = (it.width || 0) * viewport.scale;
    if (ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y - size, width, size * 1.2);
      ctx.restore();
    }
    let line = lines.find(l => Math.abs(l.y - y) < size * 0.5);
    if (!line) {
      line = { y, x, size, parts: [] };
      lines.push(line);
    }
    line.x = Math.min(line.x, x);
    const exists = line.parts.find(p => Math.abs(p.x - x) < size * 0.1 && p.text === raw);
    if (exists) continue;
    line.parts.push({ x, text: raw, width });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map(l => {
      l.parts.sort((a, b) => a.x - b.x);
      let txt = '';
      let prevEnd = null;
      for (const part of l.parts) {
        if (prevEnd != null) {
          const gap = part.x - prevEnd;
          if (gap > l.size * 0.3) txt += ' ';
        }
        txt += part.text;
        prevEnd = part.x + part.width;
      }
      return { text: txt, x: l.x, y: l.y, size: l.size };
    });
}

export async function init({ baseURL }) {
  function shouldTranslate(text) {
    const letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const nonLetters = text.replace(/[A-Za-zÀ-ÿ]/g, '').length;
    return letters >= 2 && letters >= nonLetters / 2;
  }
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
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const textContent = await page.getTextContent();
      const rawItems = groupTextItems(textContent, viewport, ctx);
      const items = dedupeItems(rawItems);
      const imgUrl = canvas.toDataURL('image/png');
      const imgBytes = await (await fetch(imgUrl)).arrayBuffer();
      pages.push({ width: viewport.width, height: viewport.height, items, image: imgBytes });
    }
    const texts = [];
    pages.forEach(p => p.items.forEach(i => {
      if (shouldTranslate(i.text)) {
        texts.push(i.text);
      } else {
        i.skip = true;
      }
    }));
    let outTexts = texts;
    if (texts.length) {
      const endpoint = cfg.apiEndpoint || cfg.endpoint;
      const model = cfg.model || cfg.modelName;
      const source = cfg.sourceLanguage || cfg.source;
      const target = cfg.targetLanguage || cfg.target;
      const tr = await window.qwenTranslateBatch({
        texts,
        endpoint,
        apiKey: cfg.apiKey,
        model,
        source,
        target,
        onProgress,
      });
      outTexts = (tr && Array.isArray(tr.texts)) ? tr.texts : texts;
    }
    let idx = 0;
    pages.forEach(p => p.items.forEach(it => {
      if (it.skip) return;
      it.text = (outTexts[idx++] || it.text).replace(/\r?\n/g, ' ');
    }));
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
      if (p.image) {
        const img = await doc.embedPng(p.image);
        page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
      } else {
        page.drawRectangle({ x: 0, y: 0, width: p.width, height: p.height, color: rgb(1, 1, 1) });
      }
      for (const it of p.items) {
        let size = it.size || 12;
        const maxW = p.width - it.x - 10;
        let w = font.widthOfTextAtSize(it.text, size);
        if (w > maxW && maxW > 0) {
          size = size * (maxW / w);
          w = font.widthOfTextAtSize(it.text, size);
        }
        page.drawText(it.text, {
          x: it.x,
          y: it.y,
          size,
          font,
          color: rgb(0.05, 0.05, 0.05),
        });
      }
    }
    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }
  return { rewrite };
}
