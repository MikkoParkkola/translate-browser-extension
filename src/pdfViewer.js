import { regeneratePdfFromUrl } from './wasm/pipeline.js';
import { chooseEngine, ensureWasmAssets } from './wasm/engine.js';
import { safeFetchPdf } from './wasm/pdfFetch.js';
import { storePdfInSession, readPdfFromSession } from './sessionPdf.js';

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
  const sessionKey = params.get('session');
  const origFile = params.get('orig') || file;
  const viewer = document.getElementById('viewer');
  const thumbs = document.getElementById('thumbs');
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const zoomResetBtn = document.getElementById('zoomReset');
  let currentZoom = 1;

  const wasmOverlay = document.getElementById('wasmOverlay');
  const wasmRetry = document.getElementById('wasmRetry');
  const wasmError = document.getElementById('wasmError');
  async function prepareWasm() {
    try {
      await ensureWasmAssets();
    } catch (e) {
      if (wasmError) wasmError.textContent = e.message || String(e);
      if (wasmOverlay) wasmOverlay.style.display = 'flex';
    }
  }
  if (wasmRetry) wasmRetry.addEventListener('click', async () => {
    if (wasmError) wasmError.textContent = '';
    try {
      await ensureWasmAssets();
      if (wasmOverlay) wasmOverlay.style.display = 'none';
    } catch (e) {
      if (wasmError) wasmError.textContent = e.message || String(e);
    }
  });
  await prepareWasm();

  function applyZoom() {
    document.querySelectorAll('.page').forEach(p => {
      p.style.zoom = currentZoom;
    });
  }

  if (zoomInBtn && zoomOutBtn) {
    zoomInBtn.addEventListener('click', () => {
      currentZoom = Math.min(currentZoom + 0.1, 3);
      applyZoom();
    });
    zoomOutBtn.addEventListener('click', () => {
      currentZoom = Math.max(currentZoom - 0.1, 0.1);
      applyZoom();
    });
  }
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
      currentZoom = 1;
      applyZoom();
    });
  }

  const badge = document.getElementById('modeBadge');
  const isTranslatedParam = params.get('translated') === '1';
  document.body.classList.toggle('translated', isTranslatedParam);
  if (badge) {
    badge.textContent = isTranslatedParam ? 'Translated' : 'Original';
    badge.style.color = isTranslatedParam ? '#2e7d32' : '#666';
  }

  if (!file && !sessionKey) {
    viewer.textContent = 'No PDF specified';
    console.log('DEBUG: No PDF file specified.');
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', import.meta.url).href;
  console.log('DEBUG: PDF.js worker source set.');

  const cfg = await window.qwenLoadConfig();

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'translate-selection') {
      (async () => {
        const sel = window.getSelection();
        const text = sel && sel.toString().trim();
        if (!text) return;
        try {
          const { text: translated } = await window.qwenTranslate({
            endpoint: cfg.apiEndpoint,
            apiKey: cfg.apiKey,
            model: cfg.model,
            text,
            source: cfg.sourceLanguage,
            target: cfg.targetLanguage,
            debug: cfg.debug,
          });
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(translated));
          sel.removeAllRanges();
        } catch (e) {
          console.error('Failed to translate selection', e);
        }
      })();
    }
  });

  // Setup engine dropdown and status with available options and sensible default
  (async () => {
    try {
      const vendorBase = chrome.runtime.getURL('wasm/vendor/');
      const { hbOk, icuOk, pdfiumOk, mupdfOk, overlayOk } = await chooseEngine(vendorBase, cfg.wasmEngine);
      const avail = { mupdf: mupdfOk, pdfium: pdfiumOk, overlay: overlayOk, simple: true };
      const best = avail.mupdf ? 'mupdf' : (avail.pdfium ? 'pdfium' : (avail.overlay ? 'overlay' : 'simple'));
      const sel = document.getElementById('engineSelect');
      if (sel && !sel.dataset.inited) {
        sel.dataset.inited = '1';
        const opts = [];
        opts.push({ v: 'auto', t: 'Engine: Auto' });
        if (avail.mupdf) opts.push({ v: 'mupdf', t: 'Engine: MuPDF' });
        if (avail.pdfium) opts.push({ v: 'pdfium', t: 'Engine: PDFium' });
        if (avail.overlay) opts.push({ v: 'overlay', t: 'Engine: Overlay' });
        opts.push({ v: 'simple', t: 'Engine: Simple' });
        sel.innerHTML = opts.map(o => `<option value="${o.v}">${o.t}</option>`).join('');
        chrome.storage.sync.get({ wasmEngine: cfg.wasmEngine || '' }, s => {
          const choice = s.wasmEngine || best || 'auto';
          sel.value = choice;
        });
        sel.addEventListener('change', () => {
          chrome.storage.sync.set({ wasmEngine: sel.value }, async () => {
            if (document.body.classList.contains('translated')) {
              try {
                const key = await generateTranslatedSessionKey(origFile);
                gotoTranslated(origFile, key);
              } catch (e) { console.error('Engine switch failed', e); }
            }
          });
        });
      }
      const statEl = document.getElementById('engineStatus');
      if (statEl) {
        const names = [];
        if (mupdfOk) names.push('MuPDF');
        if (pdfiumOk) names.push('PDFium');
        if (overlayOk) names.push('Overlay');
        if (names.length) {
          statEl.textContent = `Available engines: ${names.join(', ')}`;
          statEl.style.color = '#2e7d32';
        } else {
          statEl.textContent = 'No PDF engines available';
          statEl.style.color = '#d32f2f';
        }
      }
    } catch (e) {
      const statEl = document.getElementById('engineStatus');
      if (statEl) {
        statEl.textContent = 'Engine: Unknown';
        statEl.style.color = '#f57c00';
      }
    }
  })();

  // Wire up view toggles and save menu
  const btnOriginal = document.getElementById('btnOriginal');
  const btnTranslated = document.getElementById('btnTranslated');
  const btnTranslatedMenu = document.getElementById('btnTranslatedMenu');
  const translatedMenu = document.getElementById('translatedMenu');
  const actionSaveTranslated = document.getElementById('actionSaveTranslated');

  function setModeUI(mode) {
    if (btnOriginal) btnOriginal.dataset.active = mode === 'original' ? '1' : '0';
    if (btnTranslated) btnTranslated.dataset.active = mode === 'translated' ? '1' : '0';
    if (badge) {
      badge.textContent = mode === 'translated' ? 'Translated' : 'Original';
      badge.style.color = mode === 'translated' ? '#2e7d32' : '#666';
    }
    if (btnTranslatedMenu) btnTranslatedMenu.style.display = mode === 'translated' ? '' : 'none';
    if (btnTranslated) {
      btnTranslated.style.borderRadius =
        btnTranslatedMenu && btnTranslatedMenu.style.display !== 'none'
          ? '0'
          : '0 8px 8px 0';
    }
    if (translatedMenu) translatedMenu.style.display = 'none';
  }

  async function generateTranslatedSessionKey(originalUrl) {
    console.log('DEBUG: starting translation for', originalUrl);
    const overlay = document.getElementById('regenOverlay');
    const text = document.getElementById('regenText');
    const bar = document.getElementById('regenBar');
    const setProgress = (msg, p) => { if (text) text.textContent = msg; if (bar && typeof p === 'number') bar.style.width = `${Math.max(0,Math.min(100,p))}%`; };
    await prepareWasm();
    let cfgNow = await window.qwenLoadConfig();
    const flags = await new Promise(r => chrome.storage.sync.get(['useWasmEngine','autoOpenAfterSave','wasmEngine','wasmStrict'], r));
    cfgNow = { ...cfgNow, ...flags, useWasmEngine: true };
    if (!cfgNow.apiKey) { alert('Configure API key first.'); throw new Error('API key missing'); }
    if (overlay) overlay.style.display = 'flex'; setProgress('Preparing…', 2);
    try {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: true, phase: 'prepare' } });
      const blob = await regeneratePdfFromUrl(originalUrl, cfgNow, (p)=>{
        if (!p) return;
        chrome.runtime.sendMessage({ action: 'translation-status', status: { active: true, ...p } });
        let pct = 0;
        if (p.phase === 'collect') { pct = Math.round((p.page / p.total) * 20); setProgress(`Collecting text… (${p.page}/${p.total})`, pct); }
        if (p.phase === 'translate') { pct = 20 + Math.round((p.page / p.total) * 40); setProgress(`Translating… (${p.page}/${p.total})`, pct); }
        if (p.phase === 'render') { pct = 60 + Math.round((p.page / p.total) * 40); setProgress(`Rendering pages… (${p.page}/${p.total})`, pct); }
      });
      console.log('DEBUG: translation finished, blob size', blob.size);
      const key = await storePdfInSession(blob);
      console.log('DEBUG: stored translated PDF key', key);
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: false } });
      return key;
    } finally {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: false } });
      if (overlay) setTimeout(()=>{ overlay.style.display = 'none'; const b = document.getElementById('regenBar'); if (b) b.style.width = '0%'; }, 800);
    }
  }

  function gotoOriginal(originalUrl) {
    console.log('DEBUG: navigating to original', originalUrl);
    const viewerUrl = chrome.runtime.getURL('pdfViewer.html') + '?file=' + encodeURIComponent(originalUrl) + '&orig=' + encodeURIComponent(originalUrl);
    window.location.href = viewerUrl;
  }
  function gotoTranslated(originalUrl, sessionKey) {
    console.log('DEBUG: navigating to translated', { originalUrl, sessionKey });
    const viewerUrl = chrome.runtime.getURL('pdfViewer.html') + `?translated=1&session=${encodeURIComponent(sessionKey)}&orig=${encodeURIComponent(originalUrl)}`;
    window.location.href = viewerUrl;
  }

  if (btnOriginal && !btnOriginal.dataset.bound) {
    btnOriginal.dataset.bound = '1';
    btnOriginal.addEventListener('click', () => gotoOriginal(origFile));
  }
  if (btnTranslated && !btnTranslated.dataset.bound) {
    btnTranslated.dataset.bound = '1';
    btnTranslated.addEventListener('click', async () => {
      try {
        btnTranslated.disabled = true;
        btnOriginal && (btnOriginal.disabled = true);
        const key = isTranslatedParam ? sessionKey : await generateTranslatedSessionKey(origFile);
        gotoTranslated(origFile, key);
      } catch (e) { console.error('Translate view failed', e); }
      finally {
        btnTranslated.disabled = false;
        btnOriginal && (btnOriginal.disabled = false);
      }
    });
  }
  if (btnTranslatedMenu && !btnTranslatedMenu.dataset.bound) {
    btnTranslatedMenu.dataset.bound = '1';
    btnTranslatedMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isTranslatedParam) return; // only usable in translated view
      if (translatedMenu) translatedMenu.style.display = translatedMenu.style.display === 'block' ? 'none' : 'block';
    });
    // Hide menu on outside click
    document.addEventListener('click', () => { if (translatedMenu) translatedMenu.style.display = 'none'; });
  }
  if (actionSaveTranslated && !actionSaveTranslated.dataset.bound) {
    actionSaveTranslated.dataset.bound = '1';
    actionSaveTranslated.addEventListener('click', async () => {
      try {
        let key = sessionKey;
        if (!isTranslatedParam) {
          key = await generateTranslatedSessionKey(origFile);
        }
        const buf = await readPdfFromSession(key);
        const blob = new Blob([buf], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date();
        const fname = `translated-${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}-${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}.pdf`;
        a.href = url; a.download = fname; a.click();
      } catch (e) { console.error('Save translated failed', e); }
    });
  }

  // Default view based on autoTranslate
  const initialMode = isTranslatedParam ? 'translated' : (cfg.autoTranslate ? 'translated' : 'original');
  setModeUI(initialMode);
  if (initialMode === 'translated' && !isTranslatedParam && origFile) {
    try {
      const key = await generateTranslatedSessionKey(origFile);
      gotoTranslated(origFile, key);
      return; // stop rendering original while navigating
    } catch (e) {
      console.error('Auto-translate preview failed', e);
    }
  }
  if (!cfg.apiKey) {
    viewer.textContent = 'API key not configured';
    console.log('DEBUG: API key not configured.');
    return;
  }
  console.log('DEBUG: API key loaded.');

  try {
    let buffer;
    if (sessionKey) {
      buffer = await readPdfFromSession(sessionKey);
      console.log('DEBUG: Loaded PDF from session storage.');
    } else {
      console.log(`DEBUG: Attempting to fetch PDF from: ${file}`);
      buffer = await safeFetchPdf(file);
      console.log('DEBUG: PDF fetched successfully.');
    }
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
      pageDiv.style.zoom = currentZoom;
      viewer.appendChild(pageDiv);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      pageDiv.appendChild(canvas);

      const num = document.createElement('div');
      num.className = 'pageNumber';
      num.textContent = pageNum;
      pageDiv.appendChild(num);

      // UI bindings handled above; no per-page hooks needed
      console.log(`DEBUG: Canvas created for page ${pageNum}.`);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      };
      console.log(`DEBUG: Rendering page ${pageNum} to canvas.`);
      await page.render(renderContext).promise;
      console.log(`DEBUG: Page ${pageNum} rendered to canvas.`);

      if (thumbs) {
        const thumbCanvas = document.createElement('canvas');
        const scale = 0.2;
        thumbCanvas.width = Math.floor(viewport.width * scale);
        thumbCanvas.height = Math.floor(viewport.height * scale);
        const tctx = thumbCanvas.getContext('2d');
        tctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        const holder = document.createElement('div');
        holder.className = 'thumb';
        holder.appendChild(thumbCanvas);
        holder.addEventListener('click', () => {
          pageDiv.scrollIntoView({ behavior: 'smooth' });
        });
        thumbs.appendChild(holder);
      }

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
    viewer.appendChild(document.createTextNode(' '));
    viewer.appendChild(link);
    console.log(`DEBUG: Caught error: ${e.message}`);
  }
})();
