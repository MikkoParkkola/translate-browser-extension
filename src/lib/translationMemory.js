/**
 * Translation Memory (TM) System
 * Provides persistent storage and retrieval of translations across sessions
 * Features: IndexedDB persistence, Chrome Storage sync, LRU eviction, hit/miss metrics
 */

class TranslationMemory {
  constructor(options = {}) {
    this.dbName = options.dbName || 'qwen-translation-memory';
    this.storeName = options.storeName || 'translations';
    this.syncKey = options.syncKey || 'qwen-tm-sync';
    this.maxEntries = options.maxEntries || 10000;
    this.defaultTTL = options.defaultTTL || 7 * 24 * 60 * 60 * 1000; // 1 week
    this.syncEnabled = options.syncEnabled !== false;

    // In-memory cache for fast access
    this.cache = new Map();
    this.accessOrder = new Map(); // For LRU tracking

    // Metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictionsLRU: 0,
      evictionsTTL: 0,
      dbErrors: 0,
      syncErrors: 0
    };

    this.db = null;
    this.dbPromise = null;
    this.initPromise = this.initialize();
  }

  /**
   * Initialize the Translation Memory system
   */
  async initialize() {
    try {
      // Initialize IndexedDB
      await this.initDB();

      // Load existing translations into memory cache
      await this.loadFromDB();

      // Load from Chrome Storage if sync enabled
      if (this.syncEnabled) {
        await this.loadFromSync();
      }

      console.log('[TM] Translation Memory initialized successfully');
      return true;
    } catch (error) {
      console.error('[TM] Failed to initialize Translation Memory:', error);
      return false;
    }
  }

  /**
   * Initialize IndexedDB connection
   */
  async initDB() {
    if (typeof indexedDB === 'undefined') {
      console.warn('[TM] IndexedDB not available, using memory-only cache');
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        this.metrics.dbErrors++;
        console.error('[TM] IndexedDB open failed:', request.error);
        resolve(); // Continue without DB
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object store with compound index
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('source_target', ['source', 'target'], { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('provider', 'provider', { unique: false });
        }
      };
    });
  }

  /**
   * Load translations from IndexedDB into memory cache
   */
  async loadFromDB() {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      return new Promise((resolve) => {
        request.onsuccess = () => {
          const records = request.result || [];
          const now = Date.now();
          let loaded = 0;
          let expired = 0;

          for (const record of records) {
            // Check if entry has expired
            if (record.expiresAt && now > record.expiresAt) {
              expired++;
              this.metrics.evictionsTTL++;
              // Remove expired entry from DB
              this.deleteFromDB(record.key);
              continue;
            }

            this.cache.set(record.key, {
              text: record.translation,
              source: record.source,
              target: record.target,
              provider: record.provider,
              timestamp: record.timestamp,
              expiresAt: record.expiresAt
            });

            this.accessOrder.set(record.key, record.timestamp);
            loaded++;
          }

          console.log(`[TM] Loaded ${loaded} translations from IndexedDB (${expired} expired entries cleaned)`);
          resolve();
        };

        request.onerror = () => {
          this.metrics.dbErrors++;
          console.error('[TM] Failed to load from IndexedDB:', request.error);
          resolve();
        };
      });
    } catch (error) {
      this.metrics.dbErrors++;
      console.error('[TM] Error loading from IndexedDB:', error);
    }
  }

  /**
   * Load translations from Chrome Storage sync
   */
  async loadFromSync() {
    if (!this.syncEnabled || typeof chrome === 'undefined' || !chrome.storage?.sync) {
      return;
    }

    try {
      const result = await new Promise((resolve) => {
        chrome.storage.sync.get({ [this.syncKey]: [] }, resolve);
      });

      const syncData = result[this.syncKey] || [];
      let syncLoaded = 0;

      for (const entry of syncData) {
        const key = this.createKey(entry.source, entry.target, entry.original);

        // Only load if not already in cache (IndexedDB takes priority)
        if (!this.cache.has(key)) {
          this.cache.set(key, {
            text: entry.translation,
            source: entry.source,
            target: entry.target,
            provider: entry.provider || 'sync',
            timestamp: entry.timestamp || Date.now(),
            expiresAt: entry.expiresAt
          });
          syncLoaded++;
        }
      }

      console.log(`[TM] Loaded ${syncLoaded} translations from Chrome Storage sync`);
    } catch (error) {
      this.metrics.syncErrors++;
      console.error('[TM] Failed to load from Chrome Storage sync:', error);
    }
  }

  /**
   * Create a consistent cache key for translation lookup
   */
  createKey(sourceLanguage, targetLanguage, text) {
    const normalizedText = (text || '').trim().toLowerCase();
    return `${sourceLanguage}:${targetLanguage}:${normalizedText}`;
  }

  /**
   * Get translation from memory cache
   */
  async get(sourceLanguage, targetLanguage, text) {
    await this.initPromise;

    const key = this.createKey(sourceLanguage, targetLanguage, text);
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check if entry has expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.metrics.evictionsTTL++;
      this.metrics.misses++;

      // Remove from DB as well
      this.deleteFromDB(key);
      return null;
    }

    // Update access order for LRU
    this.accessOrder.set(key, Date.now());
    this.metrics.hits++;

    return {
      text: entry.text,
      source: entry.source,
      target: entry.target,
      provider: entry.provider,
      cached: true
    };
  }

  /**
   * Store translation in memory cache and persistent storage
   */
  async set(sourceLanguage, targetLanguage, originalText, translatedText, provider = 'unknown') {
    await this.initPromise;

    const key = this.createKey(sourceLanguage, targetLanguage, originalText);
    const now = Date.now();
    const expiresAt = now + this.defaultTTL;

    const entry = {
      text: translatedText,
      source: sourceLanguage,
      target: targetLanguage,
      provider: provider,
      timestamp: now,
      expiresAt: expiresAt
    };

    // Store in memory cache
    this.cache.set(key, entry);
    this.accessOrder.set(key, now);
    this.metrics.sets++;

    // Enforce cache size limit with LRU eviction
    await this.enforceCacheLimit();

    // Store in IndexedDB
    this.saveToDB(key, originalText, entry);

    // Optionally sync to Chrome Storage
    if (this.syncEnabled) {
      this.saveToSync();
    }

    return true;
  }

  /**
   * Enforce cache size limit using LRU eviction
   */
  async enforceCacheLimit() {
    if (this.cache.size <= this.maxEntries) {
      return;
    }

    // Sort by access order (oldest first)
    const sortedEntries = Array.from(this.accessOrder.entries())
      .sort((a, b) => a[1] - b[1]);

    // Remove oldest entries
    const toRemove = this.cache.size - this.maxEntries + 100; // Remove extra for buffer
    for (let i = 0; i < toRemove && i < sortedEntries.length; i++) {
      const [key] = sortedEntries[i];
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.metrics.evictionsLRU++;
    }

    console.log(`[TM] LRU evicted ${toRemove} entries, cache size: ${this.cache.size}`);
  }

  /**
   * Save translation to IndexedDB
   */
  async saveToDB(key, originalText, entry) {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const record = {
        key: key,
        original: originalText,
        translation: entry.text,
        source: entry.source,
        target: entry.target,
        provider: entry.provider,
        timestamp: entry.timestamp,
        expiresAt: entry.expiresAt
      };

      store.put(record);
    } catch (error) {
      this.metrics.dbErrors++;
      console.error('[TM] Failed to save to IndexedDB:', error);
    }
  }

  /**
   * Delete translation from IndexedDB
   */
  async deleteFromDB(key) {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.delete(key);
    } catch (error) {
      this.metrics.dbErrors++;
      console.error('[TM] Failed to delete from IndexedDB:', error);
    }
  }

  /**
   * Save translations to Chrome Storage sync (limited subset)
   */
  async saveToSync() {
    if (!this.syncEnabled || typeof chrome === 'undefined' || !chrome.storage?.sync) {
      return;
    }

    try {
      // Only sync most recent and frequently used translations (max 100)
      const sortedEntries = Array.from(this.cache.entries())
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, 100);

      const syncData = sortedEntries.map(([key, entry]) => ({
        original: key.split(':').slice(2).join(':'), // Extract original text from key
        translation: entry.text,
        source: entry.source,
        target: entry.target,
        provider: entry.provider,
        timestamp: entry.timestamp,
        expiresAt: entry.expiresAt
      }));

      await new Promise((resolve) => {
        chrome.storage.sync.set({ [this.syncKey]: syncData }, resolve);
      });

      console.log(`[TM] Synced ${syncData.length} translations to Chrome Storage`);
    } catch (error) {
      this.metrics.syncErrors++;
      console.error('[TM] Failed to sync to Chrome Storage:', error);
    }
  }

  /**
   * Clear all translations
   */
  async clear() {
    await this.initPromise;

    // Clear memory cache
    this.cache.clear();
    this.accessOrder.clear();

    // Clear IndexedDB
    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        store.clear();
      } catch (error) {
        this.metrics.dbErrors++;
        console.error('[TM] Failed to clear IndexedDB:', error);
      }
    }

    // Clear Chrome Storage sync
    if (this.syncEnabled && typeof chrome !== 'undefined' && chrome.storage?.sync) {
      try {
        await new Promise((resolve) => {
          chrome.storage.sync.remove([this.syncKey], resolve);
        });
      } catch (error) {
        this.metrics.syncErrors++;
        console.error('[TM] Failed to clear Chrome Storage sync:', error);
      }
    }

    console.log('[TM] Translation Memory cleared');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.metrics.hits + this.metrics.misses > 0
      ? this.metrics.hits / (this.metrics.hits + this.metrics.misses)
      : 0;

    return {
      ...this.metrics,
      cacheSize: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100,
      maxEntries: this.maxEntries,
      dbAvailable: !!this.db,
      syncEnabled: this.syncEnabled
    };
  }

  /**
   * Manually trigger cleanup of expired entries
   */
  async cleanup() {
    await this.initPromise;

    const now = Date.now();
    let cleaned = 0;

    // Clean memory cache
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        this.metrics.evictionsTTL++;
        cleaned++;
      }
    }

    // Clean IndexedDB
    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const index = store.index('timestamp');
        const request = index.openCursor();

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const record = cursor.value;
            if (record.expiresAt && now > record.expiresAt) {
              cursor.delete();
              cleaned++;
            }
            cursor.continue();
          }
        };
      } catch (error) {
        this.metrics.dbErrors++;
        console.error('[TM] Failed to cleanup IndexedDB:', error);
      }
    }

    console.log(`[TM] Cleaned up ${cleaned} expired translations`);
    return cleaned;
  }
}

// Global Translation Memory instance
let globalTM = null;

// Factory function to create or get global TM instance
function getTranslationMemory(options = {}) {
  if (!globalTM) {
    globalTM = new TranslationMemory(options);
  }
  return globalTM;
}

// Export for different environments
if (typeof window !== 'undefined') {
  window.TranslationMemory = {
    TranslationMemory,
    getTranslationMemory,
    globalTM: () => globalTM
  };
} else if (typeof self !== 'undefined') {
  // Service worker context
  self.TranslationMemory = {
    TranslationMemory,
    getTranslationMemory,
    globalTM: () => globalTM
  };
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TranslationMemory,
    getTranslationMemory
  };
}