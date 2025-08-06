(async function() {
  const params = new URL(location.href).searchParams;
  const file = params.get('file');
  const viewer = document.getElementById('viewer');
  if (!file) {
    viewer.textContent = 'No PDF specified';
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');

  const cfg = await window.qwenLoadConfig();
  if (!cfg.apiKey) {
    viewer.textContent = 'API key not configured';
    return;
  }

  try {
    const resp = await fetch(file);
    if (!resp.ok) throw new Error(`unexpected status ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.2 });
      const pageDiv = document.createElement('div');
      pageDiv.className = 'page';
      viewer.appendChild(pageDiv);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pageDiv.appendChild(canvas);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const textContent = await page.getTextContent();
      const original = textContent.items.map(i => i.str);
      let translated = original;
      if (original.length) {
        try {
          const res = await window.qwenTranslateBatch({
            endpoint: cfg.apiEndpoint,
            apiKey: cfg.apiKey,
            model: cfg.model,
            texts: original,
            source: cfg.sourceLanguage,
            target: cfg.targetLanguage,
            debug: cfg.debug,
            stream: false,
          });
          translated = res.texts;
        } catch (e) {
          console.error('PDF translation failed', e);
        }
      }
      const measure = document.createElement('canvas').getContext('2d');
      const vpTransform = viewport.transform;
      textContent.items.forEach((it, i) => {
        const style = textContent.styles[it.fontName];
        if (!style) return;
        if (!translated[i] || translated[i] === original[i]) return;
        const fontSize = Math.hypot(it.transform[0], it.transform[1]);
        const font = `${fontSize}px ${style.fontFamily}`;
        measure.font = font;
        const ow = measure.measureText(original[i]).width;
        const tw = measure.measureText(translated[i]).width;
        const ot = it.transform;
        let nt = ot;
        if (ow > 0 && tw > 0) {
          const scale = ow / tw;
          nt = [ot[0] * scale, ot[1] * scale, ot[2], ot[3], ot[4], ot[5]];
        }
        ctx.save();
        const er = pdfjsLib.Util.transform(vpTransform, ot);
        ctx.setTransform(er[0], er[1], er[2], er[3], er[4], er[5]);
        ctx.font = font;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillText(original[i], 0, 0);
        ctx.restore();
        ctx.save();
        const tr = pdfjsLib.Util.transform(vpTransform, nt);
        ctx.setTransform(tr[0], tr[1], tr[2], tr[3], tr[4], tr[5]);
        ctx.font = font;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillText(translated[i], 0, 0);
        ctx.restore();
      });
    }
  } catch (e) {
    console.error('Error loading PDF', e);
    viewer.textContent = 'Failed to load PDF';
    const link = document.createElement('a');
    link.href = file;
    link.textContent = 'Open original PDF';
    link.target = '_blank';
    viewer.appendChild(link);
  }
})();
