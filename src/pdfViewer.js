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
        const fontSize = Math.hypot(it.transform[0], it.transform[1]);
        measure.font = `${fontSize}px ${style.fontFamily}`;
        const w = measure.measureText(translated[i]).width;
        let a = it.transform[0];
        let b = it.transform[1];
        let c = it.transform[2];
        let d = it.transform[3];
        let e = it.transform[4];
        let f = it.transform[5];
        if (w > 0 && it.width) {
          const scale = it.width / w;
          a *= scale;
          b *= scale;
        }
        const tr = pdfjsLib.Util.transform(vpTransform, [a, b, c, d, e, f]);
        ctx.save();
        ctx.setTransform(tr[0], tr[1], tr[2], tr[3], tr[4], tr[5]);
        ctx.font = measure.font;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillText(original[i], 0, 0);
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
