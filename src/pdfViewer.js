import { regeneratePdfFromUrl } from './wasm/pipeline.js';
import { isWasmAvailable } from './wasm/engine.js';

(async function() {
  function isLikelyDutch(text) {
    if (!text) return false;
    const clean = (text || '').toLowerCase();
    // Ignore mostly non-letters
    const letters = clean.replace(/[^a-zà-ÿ]/g, '');
    if (letters.length < 3) return false;
    const words = clean.match(/[a-zà-ÿ]{2,}/g) || [];
    if (!words.length) return false;
    const dutchHints = [
      ' de ', ' het ', ' een ', ' en ', ' ik ', ' jij ', ' je ', ' u ', ' wij ', ' we ', ' jullie ',
      ' niet ', ' met ', ' op ', ' voor ', ' naar ', ' van ', ' dat ', ' die ', ' te ', ' zijn ',
      ' ook ', ' maar ', ' omdat ', ' zodat ', ' hier ', ' daar ', ' hoe ', ' wat ', ' waar ', ' wanneer '
    ];
    const englishHints = [
      ' the ', ' and ', ' of ', ' to ', ' in ', ' is ', ' you ', ' that ', ' it ', ' for ', ' on ', ' with ',
      ' as ', ' are ', ' this ', ' be ', ' or ', ' by ', ' from ', ' at ', ' an '
    ];
    let dScore = 0, eScore = 0;
    const padded = ` ${clean} `;
    dutchHints.forEach(h => { if (padded.includes(h)) dScore += 2; });
    englishHints.forEach(h => { if (padded.includes(h)) eScore += 2; });
    // Character patterns common in Dutch
    if (clean.includes('ij')) dScore += 1;
    if (clean.includes('een ')) dScore += 1; // article 'een'
    // Penalize if overwhelmingly English common words
    // Simple heuristic: ratio of short function words
    const commonEn = (clean.match(/\b(the|and|of|to|in|is|for|on|with|as|are)\b/g) || []).length;
    const commonNl = (clean.match(/\b(de|het|een|en|ik|je|niet|met|voor|naar|van|dat|die|te|zijn)\b/g) || []).length;
    dScore += commonNl;
    eScore += commonEn;
    return dScore >= eScore + 1; // require a bit more Dutch evidence than English
  }

  function shouldTranslateLine(text, cfg) {
    if (!text || !text.trim()) return false;
    // Skip if already target language (English)
    if ((cfg.targetLanguage || '').toLowerCase().startsWith('en')) {
      if (!isLikelyDutch(text)) return false;
    }
    // Skip lines that are mostly numbers/symbols
    const letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const nonLetters = (text.replace(/[A-Za-zÀ-ÿ]/g, '').length);
    if (letters < 2 || letters < nonLetters / 2) return false;
    return true;
  }
  const params = new URL(location.href).searchParams;
  const file = params.get('file');
  const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MiB
  function assertAllowedScheme(urlStr) {
    let u;
    try { u = new URL(urlStr); } catch { throw new Error('Invalid PDF URL'); }
    const ok = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:' || u.protocol === 'blob:';
    if (!ok) throw new Error('Blocked PDF URL scheme');
    return u;
  }
  const viewer = document.getElementById('viewer');

  const badge = document.getElementById('modeBadge');
  if (badge) {
    const isTranslated = params.get('translated') === '1';
    badge.textContent = isTranslated ? 'Translated Preview' : 'Original';
    badge.style.color = isTranslated ? '#2e7d32' : '#666';
  }

  if (!file) {
    viewer.textContent = 'No PDF specified';
    console.log('DEBUG: No PDF file specified.');
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', import.meta.url).href;
  console.log('DEBUG: PDF.js worker source set.');

  const cfg = await window.qwenLoadConfig();
(async () => {
    try {
      const vendorBase = chrome.runtime.getURL('wasm/vendor/');
      const s = await new Promise(r=>chrome.storage.sync.get({ wasmEngine: cfg.wasmEngine || 'auto' }, r));
      const engine = s.wasmEngine || 'auto';
      async function head(u){ try{ const r=await fetch(u,{method:'HEAD'}); return r.ok; }catch{return false;} }
      let missing=[];
      if (engine==='overlay') { if(!await head(vendorBase+'pdf-lib.js')) missing.push('pdf-lib.js'); }
      else if (engine==='mupdf') { const ok1=await head(vendorBase+'mupdf-wasm.wasm'); const ok2=await head(vendorBase+'mupdf.js'); const ok3=await head(vendorBase+'mupdf-wasm.js'); if(!(ok1&&ok2&&ok3)) missing.push('mupdf wasm/js'); }
      else if (engine==='pdfium') { const ok1=await head(vendorBase+'pdfium.wasm'); const ok2=await head(vendorBase+'pdfium.js'); if(!(ok1&&ok2)) missing.push('pdfium wasm/js'); }
      const es = document.getElementById('engineStatus');
      if (es) { if (missing.length){ es.textContent = 'Engine: missing '+missing.join(', '); es.style.color = '#d32f2f'; } else { es.textContent = 'Engine: Ready ('+engine+')'; es.style.color = '#2e7d32'; } }
    } catch {}
  })();
  // Show engine readiness status
  (async () => {
    const statEl = document.getElementById('engineStatus');
    if (!statEl) return;
    try {
      const ready = await isWasmAvailable(cfg);
      if (ready) {
        statEl.textContent = 'Engine: Ready';
        statEl.style.color = '#2e7d32';
      } else {
        statEl.textContent = 'Engine: Missing components (requires: hb.wasm, pdfium.wasm, mupdf.wasm, icu4x_segmenter.wasm)';
        statEl.style.color = '#d32f2f';
      }
    } catch (e) {
      statEl.textContent = 'Engine: Unknown';
      statEl.style.color = '#f57c00';
    }
  })();
  if (!cfg.apiKey) {
    viewer.textContent = 'API key not configured';
    console.log('DEBUG: API key not configured.');
    return;
  }
  console.log('DEBUG: API key loaded.');

  try {
    console.log(`DEBUG: Attempting to fetch PDF from: ${file}`);
    const u = assertAllowedScheme(file);
    // Best-effort HEAD
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      try {
        const head = await fetch(file, { method: 'HEAD' });
        const len = Number(head.headers.get('content-length') || '0');
        if (Number.isFinite(len) && len > 0 && len > MAX_PDF_BYTES) throw new Error('PDF too large');
        const ctype = (head.headers.get('content-type') || '').toLowerCase();
        if (ctype && !ctype.includes('pdf') && !u.pathname.toLowerCase().endsWith('.pdf')) throw new Error('Not a PDF content-type');
      } catch (e) { console.warn('HEAD check failed or returned unexpected headers', e?.message || e); }
    }
    const resp = await fetch(file);
    if (!resp.ok) {
      throw new Error(`unexpected status ${resp.status}`);
    }
    console.log('DEBUG: PDF fetched successfully.');
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) throw new Error('PDF too large');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    console.log('DEBUG: PDF loading task created.');
    const pdf = await loadingTask.promise;
    console.log(`DEBUG: PDF loaded. Number of pages: ${pdf.numPages}`);

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      console.log(`DEBUG: Processing page ${pageNum}`);
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      console.log(`DEBUG: Page ${pageNum} viewport created.`);

      const pageDiv = document.createElement('div');
      pageDiv.className = 'page';
      pageDiv.style.width = `${viewport.width}px`;
      pageDiv.style.height = `${viewport.height}px`;
      pageDiv.style.position = 'relative'; // Needed for absolute positioning of text
      viewer.appendChild(pageDiv);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      pageDiv.appendChild(canvas);

      // Hook up the regenerate button to current file with progress overlay
      const regenBtn = document.getElementById('regenBtn');
      const previewBtn = document.getElementById('previewBtn');
      const useWasmFlag = document.getElementById('useWasmFlag');
      const autoOpenFlag = document.getElementById('autoOpenFlag');
      let engineSelect = document.getElementById('engineSelect');
      const strictWasmFlag = document.getElementById('strictWasmFlag');
      const inspectBtn = document.getElementById('inspectBtn');
      if (useWasmFlag && autoOpenFlag && !useWasmFlag.dataset.bound) {
        useWasmFlag.dataset.bound = '1';
        // Initialize from storage/config
        chrome.storage.sync.get({ useWasmEngine: cfg.useWasmEngine, autoOpenAfterSave: cfg.autoOpenAfterSave, wasmEngine: cfg.wasmEngine || 'auto', wasmStrict: !!cfg.wasmStrict }, s => {
          useWasmFlag.checked = !!s.useWasmEngine;
          autoOpenFlag.checked = !!s.autoOpenAfterSave;
          if (strictWasmFlag) strictWasmFlag.checked = !!s.wasmStrict;
          if (engineSelect) engineSelect.value = s.wasmEngine || 'auto';
        });
        useWasmFlag.addEventListener('change', () => {
          chrome.storage.sync.set({ useWasmEngine: useWasmFlag.checked });
        });
        autoOpenFlag.addEventListener('change', () => {
          chrome.storage.sync.set({ autoOpenAfterSave: autoOpenFlag.checked });
        });
        if (!engineSelect) {
          // Create engine selector
          const bar = document.querySelector('.topbar');
          engineSelect = document.createElement('select');
          engineSelect.id = 'engineSelect'; engineSelect.className = 'btn';
          engineSelect.innerHTML = '<option value="auto">Engine: Auto</option><option value="mupdf">Engine: MuPDF</option><option value="pdfium">Engine: PDFium</option><option value="overlay">Engine: Overlay</option><option value="simple">Engine: Simple</option>';
          bar?.insertBefore(engineSelect, document.getElementById('regenStatus'));
        }
        engineSelect.addEventListener('change', () => {
          chrome.storage.sync.set({ wasmEngine: engineSelect.value });
        });
        if (inspectBtn && !inspectBtn.dataset.bound) {
          inspectBtn.dataset.bound = '1';
          inspectBtn.addEventListener('click', async () => {
            try {
              let eng = engineSelect ? engineSelect.value : 'auto';
              const base = chrome.runtime.getURL('wasm/vendor/');
              let modPath = eng === 'pdfium' ? 'pdfium.js' : (eng === 'mupdf' ? 'mupdf.js' : (eng === 'overlay' ? 'overlay.engine.js' : (eng === 'simple' ? 'simple.engine.js' : 'mupdf.engine.js')));
              const mod = await import(base + modPath);
              console.log('Engine module', modPath, 'keys:', Object.keys(mod));
            } catch (e) { console.error('Inspect Engine failed', e); }
          });
        }
        if (strictWasmFlag) {
          strictWasmFlag.addEventListener('change', () => {
            chrome.storage.sync.set({ wasmStrict: strictWasmFlag.checked });
          });
        }
      }
      // Bind Preview button (out of regen click handler)
      if (previewBtn && !previewBtn.dataset.bound) {
        previewBtn.dataset.bound = '1';
        previewBtn.addEventListener('click', async () => {
          try {
            let cfgNow = await window.qwenLoadConfig();
            const flags = await new Promise(r => chrome.storage.sync.get(['useWasmEngine','autoOpenAfterSave','wasmEngine','wasmStrict'], r));
            cfgNow = { ...cfgNow, ...flags, useWasmEngine: true }; // force engine path for preview
            const blob = await regeneratePdfFromUrl(file, cfgNow, null);
            const url = URL.createObjectURL(blob);
            const viewerUrl = chrome.runtime.getURL('pdfViewer.html') + '?translated=1&file=' + encodeURIComponent(url);
            window.location.href = viewerUrl;
          } catch (e) {
            console.error('Preview failed', e);
            alert('Preview failed: ' + (e && e.message || e));
          }
        });
      }

      if (regenBtn && !regenBtn.dataset.bound) {
        regenBtn.dataset.bound = '1';
        regenBtn.addEventListener('click', async () => {
          if (previewBtn && !previewBtn.dataset.bound) {
            previewBtn.dataset.bound = '1';
            previewBtn.addEventListener('click', async () => {
              try {
                let cfgNow = await window.qwenLoadConfig();
                const flags = await new Promise(r => chrome.storage.sync.get(['useWasmEngine','autoOpenAfterSave','wasmEngine','wasmStrict'], r));
                cfgNow = { ...cfgNow, ...flags };
                const blob = await regeneratePdfFromUrl(file, cfgNow, null);
                const url = URL.createObjectURL(blob);
                const viewerUrl = chrome.runtime.getURL('pdfViewer.html') + '?translated=1&file=' + encodeURIComponent(url);
                window.location.href = viewerUrl;
              } catch(e) { console.error('Preview failed', e); }
            });
          }

          const overlay = document.getElementById('regenOverlay');
          const text = document.getElementById('regenText');
          const bar = document.getElementById('regenBar');
          const setProgress = (msg, p) => { if (text) text.textContent = msg; if (bar && typeof p === 'number') bar.style.width = `${Math.max(0,Math.min(100,p))}%`; };
          try {
            regenBtn.disabled = true;
            let cfgNow = await window.qwenLoadConfig();
            // Merge with runtime flags
            const flags = await new Promise(r => chrome.storage.sync.get(['useWasmEngine','autoOpenAfterSave','wasmEngine','wasmStrict'], r));
            cfgNow = { ...cfgNow, ...flags };
            if (!cfgNow.apiKey) { alert('Configure API key first.'); return; }
            if (overlay) overlay.style.display = 'flex'; setProgress('Preparing…', 2);
            const blob = await regeneratePdfFromUrl(file, cfgNow, (p)=>{
              if (!p) return;
              let pct = 0;
              if (p.phase === 'collect') { pct = Math.round((p.page / p.total) * 20); setProgress(`Collecting text… (${p.page}/${p.total})`, pct); }
              if (p.phase === 'translate') { pct = 20 + Math.round((p.page / p.total) * 40); setProgress(`Translating… (${p.page}/${p.total})`, pct); }
              if (p.phase === 'render') { pct = 60 + Math.round((p.page / p.total) * 40); setProgress(`Rendering pages… (${p.page}/${p.total})`, pct); }
            });
      if (inspectBtn && !inspectBtn.dataset.bound) {
        inspectBtn.dataset.bound = '1';
        inspectBtn.addEventListener('click', async () => {
          try {
            let eng = engineSelect ? engineSelect.value : 'auto';
            const base = chrome.runtime.getURL('wasm/vendor/');
            let modPath = eng === 'pdfium' ? 'pdfium.js' : (eng === 'mupdf' ? 'mupdf.js' : (eng === 'simple' ? 'simple.engine.js' : 'mupdf.engine.js'));
            const mod = await import(base + modPath);
            console.log('Engine module', modPath, "keys:", Object.keys(mod));
          } catch (e) { console.error('Inspect Engine failed', e); }
        });
      }

            const url = URL.createObjectURL(blob);
            // Trigger download via Chrome downloads API if available
            try {
              if (chrome && chrome.downloads && chrome.downloads.download) {
                const ts = new Date();
                const fname = `translated-${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}-${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}.pdf`;
                chrome.downloads.download({ url, filename: fname, saveAs: false });
              } else {
                const a = document.createElement('a'); a.href = url; a.download = 'translated.pdf'; a.click();
              }
            } catch {}
            // Open the translated PDF in a new viewer tab automatically
            try {
              const viewerUrl = chrome.runtime.getURL('pdfViewer.html') + '?file=' + encodeURIComponent(url);
              const autoOpen = cfgNow.autoOpenAfterSave !== false;
              if (autoOpen) {
                if (chrome && chrome.tabs && chrome.tabs.create) {
                  chrome.tabs.create({ url: viewerUrl });
                } else {
                  window.open(viewerUrl, '_blank');
                }
              }
            } catch {}
            // Revoke later (after viewer loads)
            setTimeout(()=>URL.revokeObjectURL(url), 30000);
            if (text) setProgress('Done', 100);
          } catch (e) {
            console.error('Regeneration failed', e);
            if (text) setProgress('Failed: ' + e.message, 100);
          } finally {
            regenBtn.disabled = false;
            const overlay = document.getElementById('regenOverlay');
            if (overlay) setTimeout(()=>{ overlay.style.display = 'none'; const b = document.getElementById('regenBar'); if (b) b.style.width = '0%'; }, 800);
          }
        });
      }
      console.log(`DEBUG: Canvas created for page ${pageNum}.`);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      };
      console.log(`DEBUG: Rendering page ${pageNum} to canvas.`);
      await page.render(renderContext).promise;
      console.log(`DEBUG: Page ${pageNum} rendered to canvas.`);

      // Build a DOM text layer that exactly matches PDF.js layout
      const textContent = await page.getTextContent();
      const original = textContent.items.map(i => i.str);
      console.log(`DEBUG: Extracted ${original.length} text items from page ${pageNum}.`);

      // Create text layer container
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      textLayer.style.position = 'absolute';
      textLayer.style.left = '0';
      textLayer.style.top = '0';
      textLayer.style.width = `${viewport.width}px`;
      textLayer.style.height = `${viewport.height}px`;
      textLayer.style.pointerEvents = 'none';
      textLayer.style.zIndex = '10';
      textLayer.style.setProperty('--scale-factor', String(viewport.scale || 1));
      pageDiv.appendChild(textLayer);

      // Render the text layer using PDF.js so positions and spacing match exactly
      const textLayerTask = pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
        enhanceTextSelection: false,
      });
      await textLayerTask.promise;

      // Selection enabled via textLayer above; no translation until user clicks regenerate
    }
  } catch (e) {
    console.error('Error loading PDF', e);
    viewer.textContent = 'Failed to load PDF';
    const link = document.createElement('a');
    link.href = file;
    link.textContent = 'Open original PDF';
    link.target = '_blank';
    viewer.appendChild(link);
    console.log(`DEBUG: Caught error: ${e.message}`);
  }
})();
