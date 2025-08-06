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
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      pageDiv.appendChild(textLayerDiv);
      const textContent = await page.getTextContent();
      const items = textContent.items.map(i => i.str);
      let translated = items;
      if (items.length) {
        try {
          const res = await window.qwenTranslateBatch({
            endpoint: cfg.apiEndpoint,
            apiKey: cfg.apiKey,
            model: cfg.model,
            texts: items,
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
      textContent.items.forEach((it, i) => {
        it.str = translated[i];
      });
      pdfjsLib.renderTextLayer({
        textContent,
        container: textLayerDiv,
        viewport,
        textDivs: [],
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
