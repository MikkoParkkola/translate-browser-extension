// Minimal PDF generator that assembles a PDF from JPEG page images.
// Pages should be pre-rendered (with translations drawn into the canvas).

function bytes(s) {
  return new TextEncoder().encode(s);
}

function concat(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Convert dataURL (image/jpeg) to Uint8Array (raw JPEG bytes)
function dataURLToBytes(dataURL) {
  const base64 = dataURL.split(',')[1];
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Build a simple PDF with one JPEG XObject per page
export function buildPdfFromJpegs(pages) {
  // pages: [{ widthPx, heightPx, jpegDataURL }]
  // Convert CSS px to PDF points (assume 96 dpi CSS)
  const PX_TO_PT = 72 / 96;

  const header = bytes('%PDF-1.4\n');
  const body = [];
  const xref = [];
  let objIndex = 1;

  const objects = [];

  // Fonts not required; pages are images
  // Build per-page image XObject + content stream + page object

  const pagesKids = [];

  function addObject(src) {
    const off = header.length + body.reduce((s, b) => s + b.length, 0);
    xref.push(off);
    body.push(src);
    return objIndex++;
  }

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const wPt = Math.max(1, Math.round(p.widthPx * PX_TO_PT));
    const hPt = Math.max(1, Math.round(p.heightPx * PX_TO_PT));
    const jpegBytes = dataURLToBytes(p.jpegDataURL);

    // Image XObject
    const imgObjNum = addObject(concat([
      bytes(`${objIndex} 0 obj\n`),
      bytes('<< /Type /XObject /Subtype /Image ' +
            `/Width ${p.widthPx} /Height ${p.heightPx} ` +
            '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ' +
            `/Length ${jpegBytes.length} >>\nstream\n`),
      jpegBytes,
      bytes('\nendstream\nendobj\n')
    ]));

    // Content stream: draw image to full page
    const content = bytes(`q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im${i} Do\nQ\n`);
    const contentObjNum = addObject(concat([
      bytes(`${objIndex} 0 obj\n`),
      bytes(`<< /Length ${content.length} >>\nstream\n`),
      content,
      bytes('\nendstream\nendobj\n')
    ]));

    // Resources dict
    const resObjNum = addObject(concat([
      bytes(`${objIndex} 0 obj\n`),
      bytes(`<< /XObject << /Im${i} ${imgObjNum} 0 R >> >>\nendobj\n`)
    ]));

    // Page object
    const pageObj = concat([
      bytes(`${objIndex} 0 obj\n`),
      bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] `),
      bytes(`/Resources ${resObjNum} 0 R /Contents ${contentObjNum} 0 R >>\nendobj\n`)
    ]);
    const pageObjNum = addObject(pageObj);
    pagesKids.push(pageObjNum);
  }

  // Pages tree (object 2)
  const kidsStr = pagesKids.map(k => `${k} 0 R`).join(' ');
  const pagesObj = concat([
    bytes('2 0 obj\n'),
    bytes(`<< /Type /Pages /Count ${pagesKids.length} /Kids [ ${kidsStr} ] >>\nendobj\n`)
  ]);
  xref.push(header.length + body.reduce((s, b) => s + b.length, 0));
  body.push(pagesObj);

  // Catalog (object 1)
  const catalogObj = concat([
    bytes('1 0 obj\n'),
    bytes('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  ]);
  xref.unshift(header.length); // object 1 offset
  body.unshift(catalogObj);

  // Build xref table
  const xrefStart = header.length + body.reduce((s, b) => s + b.length, 0);
  let xrefStr = `xref\n0 ${objIndex}\n`;
  xrefStr += '0000000000 65535 f \n';
  for (const off of xref) {
    xrefStr += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objIndex} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const pdfBytes = concat([header, ...body, bytes(xrefStr), bytes(trailer)]);
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// Build a PDF with a JPEG background and selectable text overlays per page.
// pages: [{ widthPx, heightPx, jpegDataURL, texts: [{ xPx, yPx, fontSizePx, lineHeightPx, widthPx, lines: [{text, scaleX}] }] }]
export function buildPdfWithImageAndText(pages) {
  const PX_TO_PT = 72 / 96;
  const header = bytes('%PDF-1.4\n');
  const objs = [null]; // 1-based index, objs[1]..objs[n]

  // Reserve catalog (1) and pages tree (2)
  objs[1] = null;
  objs[2] = null;

  const pageObjNums = [];
  const makeObj = (content) => { objs.push(bytes(content)); return objs.length - 1; };

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const wPt = Math.max(1, Math.round(p.widthPx * PX_TO_PT));
    const hPt = Math.max(1, Math.round(p.heightPx * PX_TO_PT));
    const jpegBytes = dataURLToBytes(p.jpegDataURL);

    // Image XObject
    const imgNum = makeObj(
      `${objs.length} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    // Replace the last object body with binary stream + end
    objs[imgNum] = concat([
      bytes(`${imgNum} 0 obj\n`),
      bytes(`<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`),
      jpegBytes,
      bytes('\nendstream\nendobj\n')
    ]);

    // Content stream: draw image then text
    const parts = [];
    parts.push(`q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im${i} Do\nQ\n`);
    parts.push(`q\n1 0 0 -1 0 ${hPt} cm\n`);
    parts.push('/F1 12 Tf\n');
    const texts = p.texts || [];
    for (const t of texts) {
      const x = Math.round(t.xPx * PX_TO_PT);
      const y = Math.round(t.yPx * PX_TO_PT);
      const fs = Math.max(1, Math.round((t.fontSizePx || 12) * PX_TO_PT));
      const lh = Math.max(1, Math.round((t.lineHeightPx || (t.fontSizePx * 1.2 || 14)) * PX_TO_PT));
      parts.push(`BT /F1 ${fs} Tf ${x} ${y} Td `);
      for (let li = 0; li < t.lines.length; li++) {
        const line = t.lines[li];
        const text = (line.text || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        const tz = Math.round((line.scaleX || 1) * 100);
        parts.push(`${tz} Tz (${text}) Tj`);
        if (li < t.lines.length - 1) parts.push(` 0 -${lh} Td `);
      }
      parts.push(' 100 Tz ET\n');
    }
    parts.push('Q\n');
    const content = bytes(parts.join(''));
    const contentNum = makeObj(`${objs.length} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    objs[contentNum] = concat([bytes(`${contentNum} 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, bytes('\nendstream\nendobj\n')]);

    // Resources
    const resNum = makeObj(`${objs.length} 0 obj\n<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> /XObject << /Im${i} ${imgNum} 0 R >> >>\nendobj\n`);

    // Page object
    const pageNum = makeObj(`${objs.length} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources ${resNum} 0 R /Contents ${contentNum} 0 R >>\nendobj\n`);
    pageObjNums.push(pageNum);
  }

  // Pages tree (2)
  const kids = pageObjNums.map(n => `${n} 0 R`).join(' ');
  objs[2] = bytes(`2 0 obj\n<< /Type /Pages /Count ${pageObjNums.length} /Kids [ ${kids} ] >>\nendobj\n`);

  // Catalog (1)
  objs[1] = bytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Build file with xref
  const chunks = [header];
  const xref = [0];
  let offset = header.length;
  for (let i = 1; i < objs.length; i++) {
    const buf = objs[i];
    xref[i] = offset;
    chunks.push(buf);
    offset += buf.length;
  }
  const xrefStart = offset;
  let xrefStr = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) {
    xrefStr += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  chunks.push(bytes(xrefStr));
  chunks.push(bytes(trailer));
  return new Blob(chunks, { type: 'application/pdf' });
}
