const files = [
  'wasm/vendor/hb.wasm',
  'wasm/vendor/hb.js',
  'wasm/vendor/pdfium.wasm',
  'wasm/vendor/pdfium.js',
  'wasm/vendor/mupdf-wasm.wasm',
  'wasm/vendor/mupdf-wasm.js',
  // ICU4X segmenter: support both original wasm-pack names and compatibility copies
  'wasm/vendor/icu4x_segmenter_wasm_bg.wasm',
  'wasm/vendor/icu4x_segmenter_wasm.js',
  'wasm/vendor/icu4x_segmenter.wasm',
  'wasm/vendor/icu4x_segmenter.js',
  'wasm/vendor/fonts/NotoSans-Regular.ttf',
  'wasm/vendor/fonts/NotoSans-Bold.ttf',
];
const rows = document.getElementById('rows');
const summary = document.getElementById('summary');
async function check() {
  rows.innerHTML='';
  let ok = 0;
  for (const f of files) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = f; tr.appendChild(td1);
    const td2 = document.createElement('td'); td2.textContent = 'Checking…'; tr.appendChild(td2);
    rows.appendChild(tr);
    try {
      const url = chrome.runtime.getURL(f);
      const resp = await fetch(url, { method: 'HEAD' });
      if (resp.ok) {
        const size = resp.headers.get('content-length');
        td2.textContent = size ? `OK (${Number(size).toLocaleString()} bytes)` : 'OK';
        td2.className='ok'; ok++;
      } else {
        td2.textContent = 'Missing ('+resp.status+')'; td2.className='miss';
      }
    } catch (e) {
      td2.textContent = 'Missing'; td2.className='miss';
    }
  }
  summary.textContent = `Ready ${ok}/${files.length}`;
}
check();
setInterval(check, 3000);

