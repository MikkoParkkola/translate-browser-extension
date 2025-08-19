// WASM engine loader and interface (MuPDF/PDFium + HarfBuzz + ICU4X + Noto)
// Looks for vendor assets under src/wasm/vendor/ and loads the selected engine.

export const WASM_ASSETS = [
  { path: 'mupdf-wasm.wasm', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.wasm', sha256: '202c1dc9703cc003d4c14050db2bac937a9151dd79e719ae0cf1741080fbf19e' },
  // Some versions look for mupdf.wasm directly.
  { path: 'mupdf.wasm', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.wasm' },
  { path: 'mupdf-wasm.js', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.js', sha256: '7ce86f214d1a89b17323c32eb528c3d2de89db4b7d20f5ad7bf1dc35bdf81de7' },
  { path: 'mupdf.engine.js', url: 'https://unpkg.com/mupdf@1.26.4/dist/mupdf.js', sha256: 'f1c3895d09414b4ee3856167aad4afe027c074099525ec6bc54078cd0f3716de' },
  { path: 'pdfium.wasm', url: 'https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.wasm', sha256: 'b79739ef98095874ae15794b1e55b8a8a30b16b50ce0b3bc3edf741b68bc107e' },
  { path: 'pdfium.js', url: 'https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.js', sha256: '59bc29e1521b955d2b4625da1f4600cbf658ae4442170f5f98b44a557e3e3c03' },
  {
    path: 'pdfium.engine.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/pdfium.engine.js',
  },
  { path: 'hb.wasm', url: 'https://unpkg.com/harfbuzzjs@0.4.8/hb.wasm', sha256: '72d3e3a2553b4508b71f7ed0953914bed1840f714463be2fc6286a91fce83eff' },
  { path: 'hb.js', url: 'https://unpkg.com/harfbuzzjs@0.4.8/hb.js', sha256: '21af7e932a4ca41339fd70799e917a701eff4b486fd828c9a190d7c41bf7ed9f' },
  {
    path: 'icu4x_segmenter.wasm',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/icu4x_segmenter.wasm',
    sha256: '1ea58317e7ba84182ffee5cd4f85a312263d08a8b31e0dc407ae6851a2ab153e',
  },
  {
    path: 'icu4x_segmenter.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/icu4x_segmenter.js',
    sha256: 'b15d969a0eaa6c8ac3ecaa3c4bd624810e44fa824f16835f1a990da05f64b239',
  },
  { path: 'pdf-lib.js', url: 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js', sha256: '0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f' },
  {
    path: 'overlay.engine.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/overlay.engine.js',
  },
  {
    path: 'simple.engine.js',
    url: 'https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/simple.engine.js',
  },
  {
    path: 'fonts/NotoSans-Regular.ttf',
    url: 'https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf',
    sha256: '5be701a9511117e73603bdab95947feef4f18bd1851dbddc30659370b26c69f1',
  },
  {
    path: 'fonts/NotoSans-Bold.ttf',
    url: 'https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf',
    sha256: 'd36ad4cc05101c45653a8c0e854eb75f1f925c219eae57d5b3409f75397fdba1',
  },
];

let available = false;
let _impl = null;
let _lastChoice = 'auto';
const fetched = {};

// Minimal IndexedDB cache for large WASM/font assets
const DB_NAME = 'qwen-wasm';
const STORE = 'assets';
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      // IndexedDB not available
      resolve(null);
    }
  });
  return dbPromise;
}
async function idbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}
async function idbPut(key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
}

async function sha256Hex(buf) {
  try {
    const cryptoObj = (globalThis.crypto && globalThis.crypto.subtle)
      ? globalThis.crypto
      : (require && require('crypto').webcrypto);
    const digest = await cryptoObj.subtle.digest('SHA-256', buf);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

async function check(base, path) {
  const url = base + path;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) return true;
  } catch {}
  try {
    // Fallback for environments where HEAD is disallowed
    const get = await fetch(url);
    return get.ok;
  } catch {
    return false;
  }
}

export async function chooseEngine(base, requested) {
  const wants = (requested || 'auto').toLowerCase();
  console.log('DEBUG: chooseEngine requested', wants);
  const hbOk = await check(base, 'hb.wasm');
  const icuOk = (await check(base, 'icu4x_segmenter.wasm')) || (await check(base, 'icu4x_segmenter_wasm_bg.wasm'));
  const pdfiumOk =
    (await check(base, 'pdfium.engine.js')) &&
    (await check(base, 'pdfium.js')) &&
    (await check(base, 'pdfium.wasm'));
  const mupdfOk =
    (await check(base, 'mupdf.engine.js')) &&
    (await check(base, 'mupdf-wasm.js')) &&
    ((await check(base, 'mupdf.wasm')) || (await check(base, 'mupdf-wasm.wasm')));
  const overlayOk = await check(base, 'pdf-lib.js');
  console.log('DEBUG: engine assets', { hbOk, icuOk, pdfiumOk, mupdfOk, overlayOk });

  function pick() {
    if (wants === 'mupdf') return mupdfOk ? 'mupdf' : (pdfiumOk ? 'pdfium' : (overlayOk ? 'overlay' : 'simple'));
    if (wants === 'pdfium') return pdfiumOk ? 'pdfium' : (mupdfOk ? 'mupdf' : (overlayOk ? 'overlay' : 'simple'));
    if (wants === 'overlay') return overlayOk ? 'overlay' : (pdfiumOk ? 'pdfium' : (mupdfOk ? 'mupdf' : 'simple'));
    if (wants === 'simple') return 'simple';
    // auto: prefer PDFium if present; then MuPDF; then Overlay; else Simple
    if (pdfiumOk) return 'pdfium';
    if (mupdfOk) return 'mupdf';
    if (overlayOk) return 'overlay';
    return 'simple';
  }
  const choice = pick();
  console.log('DEBUG: chooseEngine selected', choice);
  return { choice, hbOk, icuOk, pdfiumOk, mupdfOk, overlayOk };
}

export async function downloadWasmAssets(dir, downloader) {
  const fs = require('fs');
  const path = require('path');
  const dl =
    downloader ||
    (async (url, dest) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to download ' + url);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, buf);
    });
  for (const a of WASM_ASSETS) {
    await dl(a.url, path.join(dir, a.path));
  }
}

export async function ensureWasmAssets() {
  const base = new URL('./vendor/', import.meta.url || 'file:///').href;
  for (const a of WASM_ASSETS) {
    if (fetched[a.path]) continue;
    const ok = await check(base, a.path);
    if (ok) continue;
    // Try IndexedDB cache first
    try {
      const cached = await idbGet(a.path);
      if (cached) {
        if (a.path.endsWith('.js')) {
          const blob = new Blob([cached], { type: 'text/javascript' });
          fetched[a.path] = URL.createObjectURL(blob);
        } else if (a.path.endsWith('.ttf') || a.path.endsWith('.otf') || a.path.endsWith('.wasm')) {
          fetched[a.path] = cached; // ArrayBuffer
        }
        continue;
      }
    } catch {}
    try {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      if (a.path.endsWith('.wasm') || a.path.endsWith('.ttf') || a.path.endsWith('.otf')) {
        const buf = await res.arrayBuffer();
        // Optional integrity check
        if (a.sha256) {
          const hex = await sha256Hex(buf);
          if (hex && hex !== a.sha256) {
            console.warn(`WASM asset checksum mismatch for ${a.path}: expected ${a.sha256} got ${hex}. Proceeding (asset may be updated upstream).`);
          }
        }
        fetched[a.path] = buf;
        await idbPut(a.path, buf);
      } else {
        const txt = await res.text();
        const blob = new Blob([txt], { type: 'text/javascript' });
        const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : ('data:text/javascript;base64,' + Buffer.from(txt).toString('base64'));
        fetched[a.path] = url;
        try { await idbPut(a.path, new TextEncoder().encode(txt).buffer); } catch {}
      }
    } catch (e) {
      throw new Error(`Failed to download ${a.path}: ${e.message}`);
    }
  }
}

export function resolveAssetPath(p) {
  const base = new URL('./vendor/', import.meta.url || 'file:///').href;
  return typeof fetched[p] === 'string' ? fetched[p] : base + p;
}

export function getAssetBuffer(p) {
  return fetched[p] || null;
}

async function loadEngine(cfg) {
  if (_impl && cfg && (cfg.wasmEngine || 'auto') === _lastChoice) return _impl;
  console.log('DEBUG: loadEngine start', cfg && cfg.wasmEngine);
  try {
    const base = new URL('./vendor/', import.meta.url).href;
    const requested = cfg && cfg.wasmEngine;
    const { choice, hbOk, icuOk, pdfiumOk, mupdfOk } = await chooseEngine(base, requested);
    if (!choice) { _lastChoice = 'auto'; }
    console.log('DEBUG: loadEngine choice', choice);
    // Strict mode: if requested engine assets missing, do not fallback
    const strict = !!(cfg && cfg.wasmStrict);
    if (strict) {
      const need = requested || 'auto';
      if (need === 'mupdf' && !mupdfOk) throw new Error('MuPDF assets missing in strict mode');
      if (need === 'pdfium' && !pdfiumOk) throw new Error('PDFium assets missing in strict mode');
    }
    _lastChoice = choice;
    let wrapper = 'simple.engine.js';
    if (choice === 'mupdf') wrapper = 'mupdf.engine.js';
    else if (choice === 'pdfium') wrapper = 'pdfium.engine.js';
    else if (choice === 'simple') wrapper = 'simple.engine.js';
    else if (choice === 'overlay') wrapper = 'overlay.engine.js';
    if (choice === 'mupdf') {
      console.log('DEBUG: MuPDF base path', base);
      let wasmBinary = getAssetBuffer('mupdf-wasm.wasm') || getAssetBuffer('mupdf.wasm');
      if (!wasmBinary) {
        try {
          const wasmResp = await fetch(resolveAssetPath('mupdf-wasm.wasm'));
          if (wasmResp.ok) {
            wasmBinary = await wasmResp.arrayBuffer();
            console.log('DEBUG: MuPDF wasm fetched', wasmBinary.byteLength, 'bytes');
          } else {
            console.error('DEBUG: MuPDF wasm fetch status', wasmResp.status);
          }
        } catch (e) {
          console.error('DEBUG: MuPDF wasm fetch failed', e);
        }
      }
      globalThis.$libmupdf_wasm_Module = {
        locateFile: (p) => {
          const loc = resolveAssetPath(p);
          console.log('DEBUG: MuPDF locateFile', p, '->', loc);
          return loc;
        },
        wasmBinary,
        onAbort: (msg) => console.error('DEBUG: MuPDF abort', msg),
        print: (...args) => console.log('DEBUG: MuPDF', ...args),
        printErr: (...args) => console.error('DEBUG: MuPDF', ...args),
      };
    }
    let engineMod;
    try {
      console.log(`DEBUG: importing wrapper ${wrapper}`);
      engineMod = await import(/* @vite-ignore */ resolveAssetPath(wrapper));
      if (!engineMod || typeof engineMod.init !== 'function') {
        throw new Error('wrapper missing init');
      }
    } catch (e) {
      console.error('DEBUG: wrapper import failed', e);
      if (requested && requested !== 'auto' && !strict) {
        console.log('DEBUG: falling back to auto engine');
        return await loadEngine({ ...cfg, wasmEngine: 'auto' });
      }
      available = false;
      _impl = { async rewritePdf() { throw new Error(`WASM ${choice} wrapper not wired. Implement rewrite() in src/wasm/vendor/${wrapper}`); } };
      return _impl;
    }
    let engine;
    try {
      engine = await engineMod.init({ baseURL: base, hasHB: hbOk, hasICU: icuOk, hasPDF: choice === 'pdfium' ? pdfiumOk : mupdfOk });
    } catch (e) {
      console.error('DEBUG: engine init failed', e);
      if (requested && requested !== 'auto' && !strict) {
        console.log('DEBUG: falling back to auto engine');
        return await loadEngine({ ...cfg, wasmEngine: 'auto' });
      }
      available = false;
      _impl = { async rewritePdf() { throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.'); } };
      return _impl;
    }
    console.log('DEBUG: engine module initialized');
    if (!engine || typeof engine.rewrite !== 'function') {
      available = false;
      _impl = { async rewritePdf() { throw new Error(`WASM ${choice} wrapper missing rewrite()`); } };
      return _impl;
    }
    _impl = {
      async rewritePdf(buffer, cfg2, onProgress) {
        console.log(`DEBUG: rewritePdf called size ${buffer.byteLength} bytes`);
        if (onProgress) onProgress({ phase: 'rewrite', page: 0, total: 1 });
        return await engine.rewrite(buffer, cfg2, p => {
          console.log('DEBUG: engine progress', p);
          if (onProgress) onProgress(p);
        });
      },
    };
    available = true;
    console.log('DEBUG: engine loaded', choice);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      try { chrome.storage.sync.set({ wasmEngine: choice }); } catch {}
    }
  } catch (e) {
    available = false;
    console.error('DEBUG: loadEngine failed', e);
    _impl = { async rewritePdf() { throw new Error('WASM engine not available. Place vendor assets under src/wasm/vendor/.'); } };
  }
  return _impl;
}

export async function isWasmAvailable(cfg) {
  console.log('DEBUG: isWasmAvailable check');
  if (_impl && (cfg?.wasmEngine || 'auto') === _lastChoice) return available;
  await loadEngine(cfg);
  return available;
}

export async function rewritePdf(buffer, cfg, onProgress) {
  console.log(`DEBUG: rewritePdf entry size ${buffer.byteLength} bytes`);
  const impl = await loadEngine(cfg);
  return impl.rewritePdf(buffer, cfg, onProgress);
}

if (typeof module !== 'undefined') {
  module.exports = {
    chooseEngine,
    isWasmAvailable,
    rewritePdf,
    WASM_ASSETS,
    downloadWasmAssets,
    ensureWasmAssets,
    resolveAssetPath,
    getAssetBuffer,
  };
}
