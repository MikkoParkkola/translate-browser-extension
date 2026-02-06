export async function storePdfInSession(data) {
  let raw;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    raw = data.arrayBuffer ? await data.arrayBuffer() : await new Response(data).arrayBuffer();
  } else if (data instanceof ArrayBuffer) {
    raw = data;
  } else if (data.buffer) {
    raw = data.buffer;
  } else {
    const text = String(data);
    raw = new TextEncoder().encode(text).buffer;
  }
  const b64 = base64Encode(raw);
  const key = `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore('pdfs');
    store.put(b64, key);
  });
  return key;
}

export async function readPdfFromSession(key) {
  const db = await openDb();
  const b64 = await new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readonly');
    tx.oncomplete = () => {};
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore('pdfs');
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!b64) {
    throw new Error('Session PDF missing');
  }
  const buf = base64Decode(b64);
  return buf;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('qwen-pdfs', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
