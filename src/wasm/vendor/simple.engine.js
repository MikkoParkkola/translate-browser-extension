// Simple engine that produces a translated PDF using core Helvetica font.
// It extracts page text via pdf.js, translates it, and writes a new PDF
// with reflowed text (not preserving original layout).

function escapePdfText(str) {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\r|\n/g, ' ');
}

function buildSimplePdf(pages, onProgress) {
  // pages: [{ width, height, lines: ["..."] }]
  let objects = [];
  const offsets = [];
  let buf = '%PDF-1.4\n';
  function add(obj) { offsets.push(buf.length); buf += obj + '\n'; }
  const fontObjNum = 3; // we will place font at 3 0 obj

  // 1: Catalog
  // 2: Pages
  // 3: Font
  // Next: per-page + content objects
  const kids = [];
  let objNum = 4;
  const pageObjs = [];
  const contentObjs = [];
  pages.forEach((p, i) => {
    const pageNum = objNum++;
    const contentNum = objNum++;
    kids.push(`${pageNum} 0 R`);
    pageObjs.push({ num: pageNum, w: p.width, h: p.height, content: `${contentNum} 0 R` });
    // Build content stream
    const margin = 50;
    const fontSize = 12;
    const leading = 14;
    let x = margin;
    let y = p.height - margin;
    let stream = 'BT\n/F1 ' + fontSize + ' Tf\n';
    p.lines.forEach((line) => {
      if (y < margin + leading) { return; }
      const text = escapePdfText(line);
      stream += `${x} ${y} Td (${text}) Tj\n`;
      y -= leading;
    });
    stream += 'ET\n';
    const content = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    contentObjs.push({ num: contentNum, body: content });
    if (onProgress) onProgress({ phase: 'render', page: i + 1, total: pages.length });
  });

  // Write objects
  add('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
  add(`2 0 obj << /Type /Pages /Count ${pages.length} /Kids [ ${kids.join(' ')} ] >> endobj`);
  add('3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');
  pageObjs.forEach((p, idx) => {
    add(`${p.num} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Math.round(p.w)} ${Math.round(p.h)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${p.content} >> endobj`);
  });
  contentObjs.forEach((c) => add(`${c.num} 0 obj ${c.body} endobj`));

  const xrefPos = buf.length;
  buf += 'xref\n';
  buf += `0 ${contentObjs.length + pageObjs.length + 3 + 1}\n`; // +3 for catalog/pages/font, +1 for obj 0
  buf += '0000000000 65535 f \n';
  for (let i = 0; i < offsets.length; i++) {
    const off = String(offsets[i]).padStart(10, '0');
    buf += `${off} 00000 n \n`;
  }
  buf += `trailer << /Size ${contentObjs.length + pageObjs.length + 3 + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`; 
  return new Blob([new TextEncoder().encode(buf)], { type: 'application/pdf' });
}

async function extractPageText(pdf, pageIndex) {
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const items = textContent.items.map(i => (i.str || '').trim()).filter(Boolean);
  const joined = items.join(' ');
  return { width: viewport.width, height: viewport.height, text: joined };
}

export async function init({ baseURL }) {
  async function rewrite(buffer, cfg, onProgress) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const total = pdf.numPages;
    const pagesText = [];
    for (let i = 0; i < total; i++) {
      if (onProgress) onProgress({ phase: 'collect', page: i + 1, total });
      const { width, height, text } = await extractPageText(pdf, i);
      pagesText.push({ width, height, text });
    }

    // Translate per-page text blocks with chunking to respect token limits
    const endpoint = cfg.apiEndpoint || cfg.endpoint;
    const model = cfg.model || cfg.modelName;
    const source = cfg.sourceLanguage || cfg.source;
    const target = cfg.targetLanguage || cfg.target;

    if (!window.qwenTranslateBatch) throw new Error('translator not available');
    const approx = (s) => {
      try { if (window.qwenThrottle && typeof window.qwenThrottle.approxTokens === 'function') return window.qwenThrottle.approxTokens(s); } catch {}
      return Math.ceil((s || '').length / 4);
    };
    function splitIntoChunks(text, maxTokens) {
      const chunks = [];
      const parts = (text || '').split(/(\.|!|\?|\n)/g);
      let cur = '';
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i] || '';
        const next = cur ? cur + seg : seg;
        if (approx(next) > maxTokens && cur) { chunks.push(cur.trim()); cur = seg; }
        else { cur = next; }
      }
      if (cur && cur.trim()) chunks.push(cur.trim());
      // If still too large (very long segment), hard split
      const out = [];
      for (const c of chunks) {
        if (approx(c) <= maxTokens) { out.push(c); continue; }
        let start = 0;
        while (start < c.length) {
          const sliceLen = Math.max(128, Math.floor(maxTokens * 4));
          out.push(c.slice(start, start + sliceLen));
          start += sliceLen;
        }
      }
      return out;
    }
    async function translateChunks(pages, budgetTokens = 1200) {
      const mapping = []; // [{page, idx, text}]
      pages.forEach((p, pageIndex) => {
        const chunks = splitIntoChunks(p.text, Math.max(200, Math.floor(budgetTokens * 0.6)));
        chunks.forEach((t, idx) => mapping.push({ page: pageIndex, idx, text: t }));
      });
      const results = new Array(mapping.length);
      let i = 0;
      while (i < mapping.length) {
        let group = [];
        let tokens = 0;
        const maxPerRequest = budgetTokens;
        while (i < mapping.length) {
          const t = mapping[i].text;
          const tk = approx(t);
          if (group.length && tokens + tk > maxPerRequest) break;
          group.push(mapping[i]); tokens += tk; i++;
          if (group.length >= 40) break;
        }
        const texts = group.map(g => g.text);
        try {
          if (onProgress) onProgress({ phase: 'translate', page: Math.min(mapping[i-1]?.page + 1, pages.length), total: pages.length });
          const tr = await window.qwenTranslateBatch({ texts, endpoint, apiKey: cfg.apiKey, model, source, target });
          const outs = (tr && Array.isArray(tr.texts)) ? tr.texts : [];
          for (let k = 0; k < group.length; k++) results[mapping.indexOf(group[k])] = outs[k] || group[k].text;
        } catch (e) {
          // On 400 or similar, reduce budget and retry smaller groups
          if (e && /HTTP 400/i.test(e.message || '')) {
            return translateChunks(pages, Math.max(400, Math.floor(budgetTokens * 0.6)));
          } else {
            throw e;
          }
        }
      }
      // Reassemble per page
      const perPage = pages.map(() => []);
      mapping.forEach((m, idx) => { perPage[m.page][m.idx] = results[idx]; });
      return perPage.map(arr => (arr.filter(Boolean).join(' ')));
    }

    const translatedBlocks = await translateChunks(pagesText);

    // Wrap translated text into lines per page
    const wrappedPages = pagesText.map((p, idx) => {
      const block = (translatedBlocks[idx] || '').trim();
      const words = block.split(/\s+/);
      const maxChars = 90; // rough wrap target
      const lines = [];
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur.trim()); cur = w; }
        else { cur = (cur ? cur + ' ' : '') + w; }
      }
      if (cur) lines.push(cur);
      return { width: p.width, height: p.height, lines };
    });

    const blob = buildSimplePdf(wrappedPages, onProgress);
    return blob;
  }
  return { rewrite };
}
