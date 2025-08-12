export const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MiB

export function assertAllowedScheme(urlStr) {
  console.log(`DEBUG: checking PDF URL scheme for ${urlStr}`);
  let u;
  try { u = new URL(urlStr); } catch { throw new Error('Invalid PDF URL'); }
  const ok = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:' || u.protocol === 'blob:';
  if (!ok) {
    console.log(`DEBUG: blocked scheme ${u.protocol}`);
    throw new Error('Blocked PDF URL scheme');
  }
  console.log(`DEBUG: allowed scheme ${u.protocol}`);
  return u;
}

export async function safeFetchPdf(urlStr) {
  console.log(`DEBUG: safeFetchPdf called for ${urlStr}`);
  const u = assertAllowedScheme(urlStr);
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    try {
      const head = await fetch(urlStr, { method: 'HEAD' });
      console.log(`DEBUG: HEAD status ${head.status}`);
      const len = Number(head.headers.get('content-length') || '0');
      console.log(`DEBUG: content-length ${len}`);
      if (Number.isFinite(len) && len > 0 && len > MAX_PDF_BYTES) {
        throw new Error('PDF too large');
      }
      const ctype = (head.headers.get('content-type') || '').toLowerCase();
      console.log(`DEBUG: content-type ${ctype}`);
      if (ctype && !ctype.includes('pdf')) {
        if (!u.pathname.toLowerCase().endsWith('.pdf')) throw new Error('Not a PDF content-type');
      }
    } catch (e) {
      console.log('DEBUG: HEAD request failed', e);
    }
  }
  const resp = await fetch(urlStr);
  console.log(`DEBUG: GET status ${resp.status}`);
  if (!resp.ok) throw new Error(`Failed to fetch PDF: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  console.log(`DEBUG: fetched PDF size ${buffer.byteLength} bytes`);
  if (buffer.byteLength > MAX_PDF_BYTES) throw new Error('PDF too large');
  return buffer;
}
