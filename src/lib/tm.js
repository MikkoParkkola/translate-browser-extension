(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenTM = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const hasIDB = typeof indexedDB !== 'undefined';
  let dbPromise = null;
  function openDb() {
    if (!hasIDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('qwen-tm', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', { keyPath: 'k' });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function get(k) {
    if (!hasIDB) return null;
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly');
      const store = tx.objectStore('entries');
      const r = store.get(k);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async function set(k, text) {
    if (!hasIDB) return;
    const db = await openDb();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      const r = store.put({ k, text, ts: Date.now() });
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    }).catch(() => {});
  }
  return { get, set };
}));
