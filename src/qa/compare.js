pdfjsLib.GlobalWorkerOptions.workerSrc = '../pdf.worker.min.js';
const left = document.getElementById('left');
const right = document.getElementById('right');
const status = document.getElementById('status');
const diffChk = document.getElementById('diffChk');

async function renderDoc(url, container) {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  container.innerHTML = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.25 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    container.appendChild(canvas);
  }
}

function makeDiff() {
  const a = left.querySelectorAll('canvas');
  const b = right.querySelectorAll('canvas');
  const n = Math.min(a.length, b.length);
  let total = 0;
  let denom = 0;
  const perPage = [];
  for (let i=0;i<n;i++) {
    const ca = a[i], cb = b[i];
    const w = Math.min(ca.width, cb.width), h = Math.min(ca.height, cb.height);
    const da = ca.getContext('2d').getImageData(0,0,w,h);
    const db = cb.getContext('2d').getImageData(0,0,w,h);
    const out = new ImageData(w,h);
    // stride of 2 for scoring to reduce sensitivity and CPU, overlay still full-res
    let pageTotal = 0, pageDenom = 0;
    for (let j=0;j<da.data.length; j+=4) {
      const dr = Math.abs(da.data[j]-db.data[j]);
      const dg = Math.abs(da.data[j+1]-db.data[j+1]);
      const dbb= Math.abs(da.data[j+2]-db.data[j+2]);
      const d = Math.max(dr,dg,dbb);
      out.data[j] = 255; out.data[j+1]=0; out.data[j+2]=0; out.data[j+3] = Math.min(255, d*2);
      // Luminance-weighted absolute difference for scoring
      if (((j>>2) % 2) === 0) {
        const ya = 0.2126*da.data[j] + 0.7152*da.data[j+1] + 0.0722*da.data[j+2];
        const yb = 0.2126*db.data[j] + 0.7152*db.data[j+1] + 0.0722*db.data[j+2];
        pageTotal += Math.abs(ya - yb);
        pageDenom += 255;
      }
    }
    const overlay = document.createElement('canvas');
    overlay.width=w; overlay.height=h;
    overlay.getContext('2d').putImageData(out,0,0);
    overlay.style.position='absolute'; overlay.style.pointerEvents='none';
    const wrap = document.createElement('div');
    wrap.style.position='relative'; wrap.appendChild(cb.cloneNode()); wrap.appendChild(overlay);
    right.replaceChild(wrap, cb);
    const pageScore = pageDenom ? (pageTotal / pageDenom) : 0;
    perPage.push(pageScore);
    total += pageTotal;
    denom += pageDenom;
  }
  const score = denom ? (total / denom) / n : 0;
  window.diffScore = score; // 0..~1 lower is better
  window.diffPages = perPage;
  return score;
}

document.getElementById('loadBtn').onclick = async () => {
  const u1 = document.getElementById('src1').value.trim();
  const u2 = document.getElementById('src2').value.trim();
  try {
    status.textContent='Loading…';
    await Promise.all([renderDoc(u1,left), renderDoc(u2,right)]);
    if (diffChk.checked) {
      const s = makeDiff();
      const pages = (window.diffPages||[]).map(v=>Number((v*100).toFixed(2))).join(', ');
      status.textContent = `Diff score: ${Number((s*100).toFixed(3))}% (pages %: [${pages}])`;
    } else {
      status.textContent='';
    }
  } catch(e) {
    console.error(e); status.textContent='Failed: '+e.message;
  }
};

// E2E support: allow query params to auto-load
(function initFromQuery(){
  const qs = new URLSearchParams(location.search);
  const s1 = qs.get('src1');
  const s2 = qs.get('src2');
  const autoload = qs.get('autoload');
  const diff = qs.get('diff');
  if (s1) document.getElementById('src1').value = s1;
  if (s2) document.getElementById('src2').value = s2;
  if (diff === '1' || diff === 'true') diffChk.checked = true;
  if (autoload === '1' || autoload === 'true') {
    document.getElementById('loadBtn').click();
  }
})();

