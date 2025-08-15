(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenTM = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const hasIDB = typeof indexedDB !== 'undefined';
  let dbPromise = null;
  const metrics = { hits: 0, misses: 0, sets: 0, evictionsTTL: 0, evictionsLRU: 0 };
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
  const DEFAULT_MAX = 5000;
  const DEFAULT_TTL_MS = 0; // 0 = no TTL expiry
  function getMax() {
    try { return (root.qwenConfig && root.qwenConfig.tmMaxEntries) || DEFAULT_MAX; } catch {}
    try { return parseInt(process.env.QWEN_TM_MAX, 10) || DEFAULT_MAX; } catch {}
    return DEFAULT_MAX;
  }
  function getTTL() {
    try { return (root.qwenConfig && root.qwenConfig.tmTTLms) || DEFAULT_TTL_MS; } catch {}
    try { return parseInt(process.env.QWEN_TM_TTL, 10) || DEFAULT_TTL_MS; } catch {}
    return DEFAULT_TTL_MS;
  }
  async function count(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly');
      const store = tx.objectStore('entries');
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }
  async function pruneDb(db) {
    if (!db) return;
    const ttl = getTTL();
    const now = Date.now();
    if (ttl > 0) {
      await new Promise((resolve) => {
        const tx = db.transaction('entries', 'readwrite');
        const idx = tx.objectStore('entries').index('ts');
        const until = now - ttl;
        const req = idx.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) { resolve(); return; }
          if (cursor.value.ts <= until) {
            cursor.delete();
            try { metrics.evictionsTTL++; } catch {}
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      });
    }
    const max = getMax();
    let total = await count(db).catch(() => 0);
    if (total <= max) return;
    const toDelete = total - max;
    await new Promise((resolve) => {
      let removed = 0;
      const tx = db.transaction('entries', 'readwrite');
      const idx = tx.objectStore('entries').index('ts');
      const req = idx.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || removed >= toDelete) { resolve(); return; }
        cursor.delete();
        try { metrics.evictionsLRU++; } catch {}
        removed++;
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  }
  async function get(k) {
    if (!hasIDB) return null;
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly');
      const store = tx.objectStore('entries');
      const r = store.get(k);
      r.onsuccess = () => {
        const val = r.result || null;
        try { if (val) metrics.hits++; else metrics.misses++; } catch {}
        if (val) {
          try {
            const tx2 = db.transaction('entries', 'readwrite');
            tx2.objectStore('entries').put({ ...val, ts: Date.now() });
          } catch {}
        }
        resolve(val);
      };
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
      r.onsuccess = () => {
        resolve();
        try { metrics.sets++; } catch {}
        try { pruneDb(db); } catch {}
      };
      r.onerror = () => reject(r.error);
    }).catch(() => {});
  }
  function stats() { return { ...metrics }; }
  function __resetStats() { metrics.hits = metrics.misses = metrics.sets = metrics.evictionsTTL = metrics.evictionsLRU = 0; }
  return { get, set, stats, __resetStats };
}));
