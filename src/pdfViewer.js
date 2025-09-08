import { regeneratePdfFromUrl } from './wasm/pipeline.js';
import { chooseEngine, ensureWasmAssets } from './wasm/engine.js';
import { safeFetchPdf } from './wasm/pdfFetch.js';
import { storePdfInSession, readPdfFromSession } from './sessionPdf.js';

(async function() {
  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
      if (typeof cb === 'function') cb(...args);
    };
  }
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
  const pages = [];
  let currentPageIndex = 0;
  const translationCache = new Map();

  const navPrev = document.createElement('button');
  navPrev.id = 'pagePrev';
  navPrev.textContent = 'Prev';
  navPrev.className = 'btn';
  const navNext = document.createElement('button');
  navNext.id = 'pageNext';
  navNext.textContent = 'Next';
  navNext.className = 'btn';
  const navLabel = document.createElement('span');
  navLabel.id = 'pageLabel';
  navLabel.className = 'muted';
  const navGroup = document.createElement('div');
  navGroup.className = 'toggle-group';
  navGroup.appendChild(navPrev);
  navGroup.appendChild(navNext);
  const topbar = document.querySelector('.topbar');
  const zoomControls = document.getElementById('zoomControls');
  if (topbar && zoomControls) {
    topbar.insertBefore(navGroup, zoomControls);
    topbar.insertBefore(navLabel, zoomControls);
  }

  function updateNav() {
    navLabel.textContent = `${currentPageIndex + 1}/${pages.length || 1}`;
    navPrev.disabled = currentPageIndex <= 0;
    navNext.disabled = currentPageIndex >= pages.length - 1;
  }

  navPrev.addEventListener('click', () => {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      pages[currentPageIndex].scrollIntoView({ behavior: 'smooth' });
      updateNav();
    }
  });
  navNext.addEventListener('click', () => {
    if (currentPageIndex < pages.length - 1) {
      currentPageIndex++;
      pages[currentPageIndex].scrollIntoView({ behavior: 'smooth' });
      updateNav();
    }
  });

  viewer.addEventListener('scroll', () => {
    const scrollTop = viewer.scrollTop;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (scrollTop >= p.offsetTop - 10 && scrollTop < p.offsetTop + p.offsetHeight - 10) {
        currentPageIndex = i;
        updateNav();
        break;
      }
    }
  }, { passive: true });

  updateNav();

  function normText(t) {
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  }

  const translateProgress = document.createElement('progress');
  translateProgress.max = 1;
  translateProgress.value = 0;
  translateProgress.className = 'qwen-progress';
  translateProgress.style.position = 'fixed';
  translateProgress.style.top = '0';
  translateProgress.style.left = '0';
  translateProgress.style.width = '100%';
  translateProgress.style.height = '4px';
  translateProgress.style.zIndex = '10000';
  translateProgress.style.display = 'none';
  document.body.appendChild(translateProgress);

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'translation-status' && msg.status) {
        const { active, progress, phase } = msg.status;
        if (typeof phase === 'string') translateProgress.dataset.phase = phase;
        if (active) {
          translateProgress.style.display = 'block';
          if (typeof progress === 'number') translateProgress.value = progress;
        } else {
          translateProgress.style.display = 'none';
          translateProgress.value = 0;
          delete translateProgress.dataset.phase;
        }
      }
    });
  }

  if (window.qwenTranslateBatch) {
    const origBatch = window.qwenTranslateBatch;
    window.qwenTranslateBatch = async function(opts = {}) {
      translateProgress.value = 0;
      translateProgress.style.display = 'block';
      const userProgress = opts.onProgress;
      opts.onProgress = p => {
        if (p && typeof p.request === 'number' && typeof p.requests === 'number' && p.requests > 0) {
          translateProgress.value = p.request / p.requests;
        }
        if (userProgress) userProgress(p);
      };
      try {
        return await origBatch(opts);
      } finally {
        translateProgress.style.display = 'none';
      }
    };
  }

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
  const isCompareParam = params.get('compare') === '1';
  document.body.classList.toggle('translated', isTranslatedParam);
  document.body.classList.toggle('compare', isCompareParam);
  if (badge) {
    badge.textContent = isCompareParam ? 'Compare' : (isTranslatedParam ? 'Translated' : 'Original');
    badge.style.color = isCompareParam ? '#0d6efd' : (isTranslatedParam ? '#2e7d32' : '#666');
  }

  if (!file && !sessionKey) {
    viewer.textContent = 'No PDF specified';
    console.log('DEBUG: No PDF file specified.');
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', import.meta.url).href;
  console.log('DEBUG: PDF.js worker source set.');

  const cfg = await window.qwenLoadConfig();
  if (window.qwenSetTokenBudget) {
    window.qwenSetTokenBudget(cfg.tokenBudget || 0);
  }
  if (window.qwenSetCacheLimit) {
    window.qwenSetCacheLimit(cfg.cacheMaxEntries || 1000);
  }
  if (window.qwenSetCacheTTL) {
    window.qwenSetCacheTTL(cfg.cacheTTL || 30 * 24 * 60 * 60 * 1000);
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'translate-selection') {
      (async () => {
        const sel = window.getSelection();
        const text = sel && sel.toString().trim();
        if (!text) return;
        try {
          const models = cfg.dualMode
            ? [
                cfg.model,
                cfg.model === 'qwen-mt-plus' ? 'qwen-mt-turbo' : 'qwen-mt-plus',
              ]
            : undefined;
          const { text: translated } = await window.qwenTranslate({
            provider: cfg.provider,
            endpoint: cfg.apiEndpoint,
            apiKey: cfg.apiKey,
            model: cfg.model,
            models,
            failover: cfg.failover,
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
        // Clear existing options and add new ones securely
        while (sel.firstChild) {
          sel.removeChild(sel.firstChild);
        }
        opts.forEach(o => {
          const option = document.createElement('option');
          option.value = o.v;
          option.textContent = o.t;
          sel.appendChild(option);
        });
        chrome.storage.sync.get({ wasmEngine: cfg.wasmEngine || '' }, s => {
          const choice = s.wasmEngine || best || 'auto';
          sel.value = choice;
        });
        sel.addEventListener('change', () => {
          chrome.storage.sync.set({ wasmEngine: sel.value }, async () => {
            const isTranslatedView = document.body.classList.contains('translated');
            const isCompareView = document.body.classList.contains('compare');
            if (isTranslatedView || isCompareView) {
              try {
                const key = await generateTranslatedSessionKey(origFile);
                if (isCompareView) {
                  gotoCompare(origFile, key);
                } else {
                  gotoTranslated(origFile, key);
                }
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

  // Setup PDF translation engine dropdown
  (function() {
    const wasmSel = document.getElementById('engineSelect');
    if (!wasmSel) return;
    let sel = document.getElementById('pdfTranslateSelect');
    if (sel) return;
    sel = document.createElement('select');
    sel.id = 'pdfTranslateSelect';
    sel.className = 'btn';
    sel.title = 'PDF translation engine';
    // Add options securely using DOM creation
    const pdfEngineOptions = [
      { v: 'wasm', t: 'PDF: WASM' },
      { v: 'google', t: 'PDF: Google' },
      { v: 'deepl-pro', t: 'PDF: DeepL Pro' },
    ];
    pdfEngineOptions.forEach(o => {
      const option = document.createElement('option');
      option.value = o.v;
      option.textContent = o.t;
      sel.appendChild(option);
    });
    wasmSel.parentNode.insertBefore(sel, wasmSel);
    chrome.storage.sync.get({ pdfTranslateEngine: 'wasm' }, s => {
      sel.value = s.pdfTranslateEngine || 'wasm';
    });
    sel.addEventListener('change', () => {
      chrome.storage.sync.set({ pdfTranslateEngine: sel.value }, async () => {
        const isTranslatedView = document.body.classList.contains('translated');
        const isCompareView = document.body.classList.contains('compare');
        if (isTranslatedView || isCompareView) {
          try {
            const key = await generateTranslatedSessionKey(origFile);
            if (isCompareView) {
              gotoCompare(origFile, key);
            } else {
              gotoTranslated(origFile, key);
            }
          } catch (e) { console.error('PDF engine switch failed', e); }
        }
      });
    });
  })();

  // Wire up view toggles and save menu
  const btnOriginal = document.getElementById('btnOriginal');
  const btnTranslated = document.getElementById('btnTranslated');
  const btnCompare = document.getElementById('btnCompare');
  const btnTranslatedMenu = document.getElementById('btnTranslatedMenu');
  const translatedMenu = document.getElementById('translatedMenu');
  const actionSaveTranslated = document.getElementById('actionSaveTranslated');

  function setModeUI(mode) {
    if (btnOriginal) btnOriginal.dataset.active = mode === 'original' ? '1' : '0';
    if (btnTranslated) btnTranslated.dataset.active = mode === 'translated' ? '1' : '0';
    if (btnCompare) btnCompare.dataset.active = mode === 'compare' ? '1' : '0';
    if (badge) {
      badge.textContent = mode === 'compare' ? 'Compare' : (mode === 'translated' ? 'Translated' : 'Original');
      badge.style.color = mode === 'compare' ? '#0d6efd' : (mode === 'translated' ? '#2e7d32' : '#666');
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
    if (window.qwenSetTokenBudget) {
      window.qwenSetTokenBudget(cfgNow.tokenBudget || 0);
    }
    if (window.qwenSetCacheLimit) {
      window.qwenSetCacheLimit(cfgNow.cacheMaxEntries || 1000);
    }
    if (window.qwenSetCacheTTL) {
      window.qwenSetCacheTTL(cfgNow.cacheTTL || 30 * 24 * 60 * 60 * 1000);
    }
    const flags = await new Promise(r => chrome.storage.sync.get(['useWasmEngine','autoOpenAfterSave','wasmEngine','wasmStrict','pdfTranslateEngine'], r));
    cfgNow = { ...cfgNow, ...flags, useWasmEngine: true };
    const engine = flags.pdfTranslateEngine || 'wasm';
    if (!cfgNow.apiKey) { alert('Configure API key first.'); throw new Error('API key missing'); }
    if (overlay) overlay.style.display = 'flex'; setProgress('Preparing…', 2);
    let summary;
    const progressCb = (p) => {
      if (!p) return;
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: true, ...p } }, handleLastError());
      if (p.stats) summary = p.stats;
      let pct = 0;
      if (p.phase === 'collect') { pct = Math.round((p.page / p.total) * 20); setProgress(`Collecting text… (${p.page}/${p.total})`, pct); }
      if (p.phase === 'translate') { pct = 20 + Math.round((p.request / p.requests) * 40); setProgress(`Translating… (${p.request}/${p.requests})`, pct); }
      if (p.phase === 'render') { pct = 60 + Math.round((p.page / p.total) * 40); setProgress(`Rendering pages… (${p.page}/${p.total})`, pct); }
    };
    try {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: true, phase: 'prepare' } }, handleLastError());
      if (engine === 'google' || engine === 'deepl-pro') {
        try {
          const provider = window.qwenProviders && window.qwenProviders.getProvider && window.qwenProviders.getProvider(engine);
          if (!provider || !provider.translateDocument) throw new Error('translateDocument missing');
          const blob = await provider.translateDocument(originalUrl, cfgNow, progressCb);
          const key = await storePdfInSession(blob);
          chrome.runtime.sendMessage({ action: 'translation-status', status: { active: false, summary } }, handleLastError());
          return key;
        } catch (err) {
          console.warn('Provider translation failed, falling back to WASM', err);
        }
      }
      const blob = await regeneratePdfFromUrl(originalUrl, cfgNow, progressCb);
      console.log('DEBUG: translation finished, blob size', blob.size);
      const key = await storePdfInSession(blob);
      console.log('DEBUG: stored translated PDF key', key);
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: false, summary } }, handleLastError());
      return key;
    } catch (e) {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: false, summary } }, handleLastError());
      throw e;
    } finally {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { active: false } }, handleLastError());
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
  function gotoCompare(originalUrl, sessionKey) {
    console.log('DEBUG: navigating to compare', { originalUrl, sessionKey });
    const viewerUrl = chrome.runtime.getURL('pdfViewer.html') + `?compare=1&session=${encodeURIComponent(sessionKey)}&orig=${encodeURIComponent(originalUrl)}`;
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
  if (btnCompare && !btnCompare.dataset.bound) {
    btnCompare.dataset.bound = '1';
    btnCompare.addEventListener('click', async () => {
      try {
        btnCompare.disabled = true;
        btnOriginal && (btnOriginal.disabled = true);
        const key = isTranslatedParam ? sessionKey : await generateTranslatedSessionKey(origFile);
        gotoCompare(origFile, key);
      } catch (e) { console.error('Compare view failed', e); }
      finally {
        btnCompare.disabled = false;
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
  const initialMode = isCompareParam ? 'compare' : (isTranslatedParam ? 'translated' : (cfg.autoTranslate ? 'translated' : 'original'));
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
  if (isCompareParam) {
    if (!sessionKey) {
      viewer.textContent = 'No translated PDF for comparison';
      return;
    }
    // Clear viewer content securely
    while (viewer.firstChild) {
      viewer.removeChild(viewer.firstChild);
    }
    const left = document.createElement('iframe');
    left.className = 'pdfPane';
    left.src = chrome.runtime.getURL('pdfViewer.html') + '?file=' + encodeURIComponent(origFile) + '&orig=' + encodeURIComponent(origFile);
    const right = document.createElement('iframe');
    right.className = 'pdfPane';
    right.src = chrome.runtime.getURL('pdfViewer.html') + `?translated=1&session=${encodeURIComponent(sessionKey)}&orig=${encodeURIComponent(origFile)}`;
    viewer.appendChild(left);
    viewer.appendChild(right);
    return;
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
      const transLayer = document.createElement('div');
      transLayer.className = 'translationLayer';
      transLayer.style.position = 'absolute';
      transLayer.style.left = '0';
      transLayer.style.top = '0';
      transLayer.style.width = `${viewport.width}px`;
      transLayer.style.height = `${viewport.height}px`;
      transLayer.style.zIndex = '20';
      pageDiv.appendChild(transLayer);

      const dedup = new Map();
      const boxes = [];
      textContent.items.forEach(item => {
        const txt = item.str;
        if (!shouldTranslateLine(txt, cfg)) return;
        const cacheKey = normText(txt);
        const tr = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const height = Math.sqrt(tr[1] * tr[1] + tr[3] * tr[3]);
        const box = {
          text: txt,
          left: tr[4],
          top: tr[5] - height,
          height,
          width: item.width,
        };
        boxes.push(box);
        if (translationCache.has(cacheKey)) {
          box.translated = translationCache.get(cacheKey);
        } else {
          if (!dedup.has(cacheKey)) dedup.set(cacheKey, { text: txt, boxes: [] });
          dedup.get(cacheKey).boxes.push(box);
        }
      });

      const dedupEntries = Array.from(dedup.entries());
      if (dedupEntries.length) {
        const { texts: translated } = await window.qwenTranslateBatch({
          texts: dedupEntries.map(([, v]) => v.text),
          provider: cfg.provider,
          endpoint: cfg.apiEndpoint,
          apiKey: cfg.apiKey,
          model: cfg.model,
          failover: cfg.failover,
          source: cfg.sourceLanguage,
          target: cfg.targetLanguage,
          debug: cfg.debug,
        });
        dedupEntries.forEach(([k, v], i) => {
          const out = translated[i];
          translationCache.set(k, out);
          v.boxes.forEach(b => { b.translated = out; });
        });
      }

      boxes.forEach(box => {
        const div = document.createElement('div');
        div.textContent = box.translated || '';
        div.style.position = 'absolute';
        div.style.left = `${box.left}px`;
        div.style.top = `${box.top}px`;
        div.style.width = `${box.width}px`;
        div.style.height = `${box.height}px`;
        div.style.fontSize = `${box.height}px`;
        div.style.lineHeight = `${box.height}px`;
        div.style.whiteSpace = 'pre';
        div.style.background = 'rgba(255,255,255,0.6)';
        div.style.color = '#000';
        div.style.pointerEvents = 'auto';
        div.contentEditable = 'true';
        div.addEventListener('blur', () => {
          const edited = div.textContent || '';
          const cacheKey = normText(box.text);
          translationCache.set(cacheKey, edited);
          if (window.qwenTM && window.qwenTM.set) {
            const key = `${cfg.sourceLanguage}:${cfg.targetLanguage}:${cacheKey}`;
            try { window.qwenTM.set(key, edited); } catch {}
          }
        });
        transLayer.appendChild(div);
      });

      pages.push(pageDiv);
      updateNav();

      // Selection enabled via textLayer above; translation overlay rendered
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
