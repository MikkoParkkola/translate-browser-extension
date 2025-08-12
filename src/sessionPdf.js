export async function storePdfInSession(blob) {
  console.log('DEBUG: storing PDF in session');
  const buf = await blob.arrayBuffer();
  console.log(`DEBUG: PDF size ${buf.byteLength} bytes`);
  const b64 = base64Encode(buf);
  const key = `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    sessionStorage.setItem(key, b64);
    console.log(`DEBUG: stored PDF under key ${key}`);
  } catch (e) {
    console.error('DEBUG: failed to store PDF', e);
    throw new Error('Failed to store PDF in session');
  }
  return key;
}

export function readPdfFromSession(key) {
  console.log(`DEBUG: reading PDF from session key ${key}`);
  const b64 = sessionStorage.getItem(key);
  if (!b64) {
    console.log('DEBUG: session PDF missing');
    throw new Error('Session PDF missing');
  }
  const buf = base64Decode(b64);
  console.log(`DEBUG: decoded session PDF size ${buf.byteLength} bytes`);
  return buf;
}

function base64Encode(buffer) {
  if (typeof btoa === 'function') {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }
  return Buffer.from(buffer).toString('base64');
}

function base64Decode(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return buf;
  }
  return Buffer.from(b64, 'base64').buffer;
}
