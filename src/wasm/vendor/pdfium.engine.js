export async function init({ baseURL }) {
  function approxTokens(s) {
    return Math.ceil((s || '').length / 4);
  }
  function splitIntoChunks(text, maxTokens) {
    const chunks = [];
    const parts = (text || '').split(/(\.|!|\?|\n)/g);
    let cur = '';
    for (const seg of parts) {
      const next = cur ? cur + seg : seg;
      if (approxTokens(next) > maxTokens && cur) {
        chunks.push(cur.trim());
        cur = seg;
      } else {
        cur = next;
      }
    }
    if (cur && cur.trim()) chunks.push(cur.trim());
    const out = [];
    for (const c of chunks) {
      if (approxTokens(c) <= maxTokens) { out.push(c); continue; }
      let start = 0;
      const step = Math.max(128, Math.floor(maxTokens * 4));
      while (start < c.length) { out.push(c.slice(start, start + step)); start += step; }
    }
    return out;
  }
  async function translatePages(pages, cfg, onProgress, budget = 1200) {
    const endpoint = cfg.apiEndpoint || cfg.endpoint;
    const model = cfg.model || cfg.modelName;
    const source = cfg.sourceLanguage || cfg.source;
    const target = cfg.targetLanguage || cfg.target;
    const mapping = [];
    pages.forEach((t, i) => splitIntoChunks(t, Math.max(200, Math.floor(budget * 0.6)))
      .forEach((c, idx) => mapping.push({ page: i, idx, text: c })));
    const results = new Array(mapping.length);
    let i = 0;
    while (i < mapping.length) {
      let group = [];
      let tokens = 0;
      const maxPer = budget;
      while (i < mapping.length) {
        const tk = approxTokens(mapping[i].text);
        if (group.length && tokens + tk > maxPer) break;
        group.push(mapping[i]); tokens += tk; i++;
        if (group.length >= 40) break;
      }
      const texts = group.map(g => g.text);
      try {
        if (onProgress) onProgress({ phase: 'translate', page: Math.min(group[group.length - 1].page + 1, pages.length), total: pages.length });
        const tr = await window.qwenTranslateBatch({ texts, endpoint, apiKey: cfg.apiKey, model, source, target, tokenBudget: budget });
        const outs = (tr && Array.isArray(tr.texts)) ? tr.texts : texts;
        for (let k = 0; k < group.length; k++) results[mapping.indexOf(group[k])] = outs[k] || group[k].text;
      } catch (e) {
        if (/HTTP 400/i.test(e?.message || '')) {
          const next = Math.max(100, Math.floor(budget * 0.6));
          if (next === budget) throw e;
          return translatePages(pages, cfg, onProgress, next);
        } else {
          throw e;
        }
      }
    }
    const perPage = pages.map(() => []);
    mapping.forEach((m, idx) => { perPage[m.page][m.idx] = results[idx]; });
    return perPage.map(arr => (arr.filter(Boolean).join(' ')));
  }
  function wrapText(text, font, size, maxWidth) {
    const words = (text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  async function rewrite(buffer, cfg, onProgress) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
    if (!window.qwenTranslateBatch) throw new Error('translator not available');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const total = pdf.numPages;
    const pages = [];
    for (let p = 1; p <= total; p++) {
      if (onProgress) onProgress({ phase: 'collect', page: p, total });
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.5 });
      const tc = await page.getTextContent();
      const items = tc.items.map(i => (i.str || '').trim()).filter(Boolean);
      pages.push({ w: Math.floor(viewport.width), h: Math.floor(viewport.height), text: items.join(' ') });
    }
    const translated = await translatePages(pages.map(p => p.text), cfg, onProgress);
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
      throw new Error('pdf-lib not available for PDFium engine');
    }
    const { PDFDocument, StandardFonts, rgb } = pdfLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages.length; i++) {
      if (onProgress) onProgress({ phase: 'render', page: i + 1, total: pages.length });
      const p = pages[i];
      const page = doc.addPage([p.w, p.h]);
      page.drawRectangle({ x: 0, y: 0, width: p.w, height: p.h, color: rgb(1, 1, 1) });
      const margin = 40;
      const boxW = p.w - margin * 2;
      const lines = wrapText((translated[i] || '').trim(), font, 12, boxW);
      let y = p.h - margin - 12;
      for (const line of lines) {
        page.drawText(line, { x: margin, y, size: 12, font, color: rgb(0.05,0.05,0.05) });
        y -= 14;
        if (y < margin) break;
      }
    }
    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }
  return { rewrite };
}
