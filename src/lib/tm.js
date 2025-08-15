(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.qwenTM = mod;
}(typeof self !== 'undefined' ? self : this, function (root) {
  const store = new Map();
  const metrics = { hits: 0, misses: 0, sets: 0, evictionsTTL: 0, evictionsLRU: 0 };
  const hasIDB = typeof indexedDB !== 'undefined';
  const DB_NAME = 'qwen-tm';
  const STORE_NAME = 'store';
  const KEY = 'data';
  let loaded = false;
  let dbPromise;

  function getDB() {
    if (!hasIDB) return null;
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  async function load() {
    if (loaded || !hasIDB) return;
    loaded = true;
    const db = await getDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      const data = await new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      for (const [k, v] of data) store.set(k, v);
    } catch {}
  }

  async function save() {
    if (!hasIDB) return;
    const db = await getDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(Array.from(store.entries()), KEY);
      await new Promise((resolve) => {
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch {}
  }

  async function ensureLoaded() {
    if (!loaded) await load();
  }

  const DEFAULT_MAX = 5000;
  const DEFAULT_TTL_MS = 0; // 0 = no TTL expiry

  function getMax() {
    try {
      const v = root.qwenConfig && root.qwenConfig.tmMaxEntries;
      if (typeof v === 'number') return v;
    } catch {}
    try {
      const envV = parseInt(process.env.QWEN_TM_MAX, 10);
      if (!isNaN(envV)) return envV;
    } catch {}
    return DEFAULT_MAX;
  }

  function getTTL() {
    try {
      const v = root.qwenConfig && root.qwenConfig.tmTTLms;
      if (typeof v === 'number') return v;
    } catch {}
    try {
      const envV = parseInt(process.env.QWEN_TM_TTL, 10);
      if (!isNaN(envV)) return envV;
    } catch {}
    return DEFAULT_TTL_MS;
  }

  function prune(now = Date.now()) {
    const ttl = getTTL();
    const max = getMax();
    if (ttl > 0) {
      for (const [k, v] of Array.from(store.entries())) {
        if (now - v.ts > ttl) {
          store.delete(k);
          metrics.evictionsTTL++;
        }
      }
    }
    if (store.size > max) {
      const arr = Array.from(store.entries()).sort((a, b) => a[1].ts - b[1].ts);
      while (arr.length > max) {
        const [k] = arr.shift();
        store.delete(k);
        metrics.evictionsLRU++;
      }
    }
  }

  async function get(k) {
    await ensureLoaded();
    const now = Date.now();
    const val = store.get(k);
    if (!val) {
      metrics.misses++;
      return null;
    }
    const ttl = getTTL();
    if (ttl > 0 && now - val.ts > ttl) {
      store.delete(k);
      metrics.evictionsTTL++;
      metrics.misses++;
      await save();
      return null;
    }
    metrics.hits++;
    val.ts = now;
    return { k, text: val.text, ts: val.ts };
  }

  async function set(k, text) {
    await ensureLoaded();
    store.set(k, { text, ts: Date.now() });
    metrics.sets++;
    prune();
    await save();
  }

  function stats() { return { ...metrics }; }
  function __resetStats() {
    metrics.hits = metrics.misses = metrics.sets = metrics.evictionsTTL = metrics.evictionsLRU = 0;
    store.clear();
    loaded = true;
    save();
  }

  return { get, set, stats, __resetStats };
}));

