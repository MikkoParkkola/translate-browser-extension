/**
 * IndexedDB-based translation cache with LRU eviction.
 * Stores translations keyed by hash of (text + sourceLang + targetLang + provider).
 */

import type { TranslationProviderId } from '../types';
import { createLogger } from './logger';

const log = createLogger('TranslationCache');

/** Cache entry stored in IndexedDB */
export interface CacheEntry {
  key: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  provider: TranslationProviderId;
  translation: string;
  timestamp: number;
  size: number;
}

/** Cache statistics */
export interface TranslationCacheStats {
  entries: number;
  totalSize: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
}

const DB_NAME = 'translate-extension-cache';
const DB_VERSION = 1;
const STORE_NAME = 'translations';
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Simple FNV-1a hash for cache keys.
 * Fast and good distribution for string keys.
 */
function hashKey(text: string, sourceLang: string, targetLang: string, provider: string): string {
  const input = `${text}|${sourceLang}|${targetLang}|${provider}`;
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  // Convert to unsigned 32-bit integer and then to hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Calculate the approximate size of a cache entry in bytes.
 */
function calculateEntrySize(text: string, translation: string): number {
  // Each character in JS is 2 bytes (UTF-16)
  // Add overhead for metadata (~100 bytes for key, langs, timestamps)
  return (text.length + translation.length) * 2 + 100;
}

/**
 * Translation cache using IndexedDB with LRU eviction.
 */
export class TranslationCache {
  private db: IDBDatabase | null = null;
  private dbReady: Promise<IDBDatabase>;
  private hits = 0;
  private misses = 0;
  private readonly maxSize: number;

  constructor(maxSizeBytes: number = MAX_CACHE_SIZE_BYTES) {
    this.maxSize = maxSizeBytes;
    this.dbReady = this.openDatabase();
  }

  /**
   * Open or create the IndexedDB database.
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      // Check if IndexedDB is available
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        log.error(' Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        log.info(' Database opened successfully');
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store with key as primary key
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });

          // Index for timestamp-based LRU queries
          store.createIndex('timestamp', 'timestamp', { unique: false });

          log.info(' Object store created');
        }
      };
    });
  }

  /**
   * Get a cached translation.
   */
  async get(
    text: string,
    sourceLang: string,
    targetLang: string,
    provider: TranslationProviderId
  ): Promise<string | null> {
    try {
      const db = await this.dbReady;
      const key = hashKey(text, sourceLang, targetLang, provider);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        transaction.onerror = () => {
          log.error(' Transaction error (get):', transaction.error);
          this.misses++;
          reject(transaction.error);
        };

        transaction.onabort = () => {
          log.error(' Transaction aborted (get):', transaction.error);
          this.misses++;
          reject(transaction.error || new Error('Transaction aborted'));
        };

        request.onerror = () => {
          this.misses++;
          reject(request.error);
        };

        request.onsuccess = () => {
          const entry = request.result as CacheEntry | undefined;

          if (entry) {
            this.hits++;

            // Update timestamp for LRU (touch the entry)
            entry.timestamp = Date.now();
            store.put(entry);

            resolve(entry.translation);
          } else {
            this.misses++;
            resolve(null);
          }
        };
      });
    } catch (error) {
      this.misses++;
      log.error(' Get error:', error);
      return null;
    }
  }

  /**
   * Store a translation in the cache.
   */
  async set(
    text: string,
    sourceLang: string,
    targetLang: string,
    provider: TranslationProviderId,
    translation: string
  ): Promise<void> {
    try {
      const db = await this.dbReady;
      const key = hashKey(text, sourceLang, targetLang, provider);
      const size = calculateEntrySize(text, translation);

      // Check if we need to evict entries
      await this.evictIfNeeded(size);

      const entry: CacheEntry = {
        key,
        text,
        sourceLang,
        targetLang,
        provider,
        translation,
        timestamp: Date.now(),
        size,
      };

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);

        transaction.onerror = () => {
          log.error(' Transaction error (set):', transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          log.error(' Transaction aborted (set):', transaction.error);
          reject(transaction.error || new Error('Transaction aborted'));
        };

        request.onerror = () => {
          log.error(' Set error:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          resolve();
        };
      });
    } catch (error) {
      log.error(' Set error:', error);
      // Don't throw - caching failures should not break translation
    }
  }

  /**
   * Evict oldest entries if adding newSize would exceed maxSize.
   */
  private async evictIfNeeded(newSize: number): Promise<void> {
    const stats = await this.getStats();

    if (stats.totalSize + newSize <= this.maxSize) {
      return; // No eviction needed
    }

    const db = await this.dbReady;
    const targetSize = this.maxSize * 0.8; // Evict to 80% capacity
    let currentSize = stats.totalSize;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');

      transaction.onerror = () => {
        log.error(' Transaction error (evict):', transaction.error);
        reject(transaction.error);
      };

      transaction.onabort = () => {
        log.error(' Transaction aborted (evict):', transaction.error);
        reject(transaction.error || new Error('Transaction aborted'));
      };

      // Cursor in ascending order (oldest first)
      const request = index.openCursor();

      request.onerror = () => {
        reject(request.error);
      };

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor && currentSize > targetSize) {
          const entry = cursor.value as CacheEntry;
          currentSize -= entry.size;
          cursor.delete();
          console.log(`[TranslationCache] Evicted entry, new size: ${currentSize}`);
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  /**
   * Clear all cached translations.
   */
  async clear(): Promise<void> {
    try {
      const db = await this.dbReady;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        transaction.onerror = () => {
          log.error(' Transaction error (clear):', transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          log.error(' Transaction aborted (clear):', transaction.error);
          reject(transaction.error || new Error('Transaction aborted'));
        };

        request.onerror = () => {
          reject(request.error);
        };

        request.onsuccess = () => {
          this.hits = 0;
          this.misses = 0;
          log.info(' Cache cleared');
          resolve();
        };
      });
    } catch (error) {
      log.error(' Clear error:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<TranslationCacheStats> {
    try {
      const db = await this.dbReady;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        transaction.onerror = () => {
          log.error(' Transaction error (stats):', transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          log.error(' Transaction aborted (stats):', transaction.error);
          reject(transaction.error || new Error('Transaction aborted'));
        };

        let entries = 0;
        let totalSize = 0;
        let oldestTimestamp: number | null = null;
        let newestTimestamp: number | null = null;

        const request = store.openCursor();

        request.onerror = () => {
          reject(request.error);
        };

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

          if (cursor) {
            const entry = cursor.value as CacheEntry;
            entries++;
            totalSize += entry.size;

            if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
              oldestTimestamp = entry.timestamp;
            }
            if (newestTimestamp === null || entry.timestamp > newestTimestamp) {
              newestTimestamp = entry.timestamp;
            }

            cursor.continue();
          } else {
            // Done iterating
            const total = this.hits + this.misses;
            resolve({
              entries,
              totalSize,
              maxSize: this.maxSize,
              hits: this.hits,
              misses: this.misses,
              hitRate: total > 0 ? this.hits / total : 0,
              oldestTimestamp,
              newestTimestamp,
            });
          }
        };
      });
    } catch (error) {
      log.error(' Stats error:', error);
      return {
        entries: 0,
        totalSize: 0,
        maxSize: this.maxSize,
        hits: this.hits,
        misses: this.misses,
        hitRate: 0,
        oldestTimestamp: null,
        newestTimestamp: null,
      };
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance for use across the extension
let cacheInstance: TranslationCache | null = null;

/**
 * Get the singleton translation cache instance.
 */
export function getTranslationCache(): TranslationCache {
  if (!cacheInstance) {
    cacheInstance = new TranslationCache();
  }
  return cacheInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetTranslationCache(): void {
  if (cacheInstance) {
    cacheInstance.close();
    cacheInstance = null;
  }
}
