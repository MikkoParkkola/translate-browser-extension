export const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MiB

export function assertAllowedScheme(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error('Invalid PDF URL'); }
  const ok = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:' || u.protocol === 'blob:';
  if (!ok) throw new Error('Blocked PDF URL scheme');
  return u;
}

export async function safeFetchPdf(urlStr) {
  const u = assertAllowedScheme(urlStr);
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    try {
      const head = await fetch(urlStr, { method: 'HEAD' });
      const len = Number(head.headers.get('content-length') || '0');
      if (Number.isFinite(len) && len > 0 && len > MAX_PDF_BYTES) {
        throw new Error('PDF too large');
      }
      const ctype = (head.headers.get('content-type') || '').toLowerCase();
      if (ctype && !ctype.includes('pdf')) {
        if (!u.pathname.toLowerCase().endsWith('.pdf')) throw new Error('Not a PDF content-type');
      }
    } catch {}
  }
  const resp = await fetch(urlStr);
  if (!resp.ok) throw new Error(`Failed to fetch PDF: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_PDF_BYTES) throw new Error('PDF too large');
  return buffer;
}
