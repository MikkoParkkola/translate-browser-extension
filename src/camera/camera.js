(async () => {
  const video = document.getElementById('camera');
  const canvas = document.getElementById('captureCanvas');
  const overlay = document.getElementById('overlay');
  const captureBtn = document.getElementById('capture');
  const historyList = document.getElementById('history');

  // Initialize camera stream
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
  } catch (err) {
    console.error('Camera access denied', err);
  }

  // IndexedDB setup
  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('qwen-camera', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('captures')) {
        db.createObjectStore('captures', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function saveCapture(data) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('captures', 'readwrite');
      tx.objectStore('captures').add(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadCaptures() {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('captures', 'readonly');
      const req = tx.objectStore('captures').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function renderHistory() {
    const items = await loadCaptures();
    historyList.innerHTML = '';
    items.slice(-5).reverse().forEach(cap => {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = cap.image;
      const span = document.createElement('span');
      span.textContent = cap.translation || cap.text;
      li.appendChild(img);
      li.appendChild(span);
      historyList.appendChild(li);
    });
  }

  captureBtn.addEventListener('click', async () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    overlay.textContent = 'Recognizing...';

    let ocrText = '';
    try {
      const { data } = await Tesseract.recognize(canvas, 'eng');
      ocrText = (data.text || '').trim();
    } catch (err) {
      console.error('OCR failed', err);
      overlay.textContent = 'OCR failed';
      return;
    }

    overlay.textContent = 'Translating...';
    let translated = '';
    try {
      const cfg = await qwenLoadConfig();
      const res = await qwenTranslate({
        text: ocrText,
        source: cfg.sourceLanguage || 'auto',
        target: cfg.targetLanguage || 'en',
        providerOrder: cfg.providerOrder,
        endpoints: cfg.endpoints,
        failover: cfg.failover,
        autoInit: true,
      });
      translated = res && res.text ? res.text : '';
      overlay.textContent = translated;
    } catch (err) {
      console.error('Translation failed', err);
      overlay.textContent = 'Translation failed';
    }

    try {
      const image = canvas.toDataURL('image/png');
      await saveCapture({ timestamp: Date.now(), image, text: ocrText, translation: translated });
      renderHistory();
    } catch (err) {
      console.error('Save failed', err);
    }
  });

  renderHistory();
})();
