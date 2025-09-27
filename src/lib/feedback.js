(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenFeedback = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  const hasIDB = typeof indexedDB !== 'undefined';
  const DB_NAME = 'qwen-feedback';
  const STORE_NAME = 'fb';
  let dbPromise;

  function getDB() {
    if (!hasIDB) return null;
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME, { autoIncrement: true });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (error) {
          console.warn('[feedback] indexedDB unavailable', error);
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  async function save(record) {
    const db = await getDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add({ ...record, ts: Date.now() });
      await new Promise(res => {
        tx.oncomplete = res;
        tx.onerror = res;
      });
    } catch (error) {
      console.warn('[feedback] failed to persist feedback', error);
    }
  }

  return { save };
}));
