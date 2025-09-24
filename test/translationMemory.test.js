/**
 * Tests for Translation Memory integration
 */

// Mock IndexedDB for testing
const mockIndexedDB = {
  open: jest.fn().mockReturnValue({
    result: { createObjectStore: jest.fn() },
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null
  })
};

global.indexedDB = mockIndexedDB;

// Ensure we're in Node.js environment for module.exports
global.module = { exports: {} };

// Import the Translation Memory module
require('../src/lib/translationMemory.js');
const { TranslationMemory, getTranslationMemory } = module.exports;

describe('Translation Memory', () => {
  let tm;

  beforeEach(() => {
    tm = new TranslationMemory({
      dbName: 'test-tm',
      maxEntries: 100,
      defaultTTL: 1000 // 1 second for testing
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should initialize Translation Memory correctly', async () => {
    expect(tm).toBeDefined();
    expect(tm.cache).toBeInstanceOf(Map);
    expect(tm.accessOrder).toBeInstanceOf(Map);
    expect(tm.maxEntries).toBe(100);
  });

  test('should create consistent cache keys', () => {
    const key1 = tm.createKey('en', 'es', 'Hello World');
    const key2 = tm.createKey('en', 'es', 'hello world');
    const key3 = tm.createKey('en', 'es', ' Hello World ');

    expect(key1).toBe('en:es:hello world');
    expect(key2).toBe('en:es:hello world');
    expect(key3).toBe('en:es:hello world');
  });

  test('should store and retrieve translations', async () => {
    const sourceText = 'Hello World';
    const translatedText = 'Hola Mundo';

    // Store translation
    await tm.set('en', 'es', sourceText, translatedText, 'qwen');

    // Retrieve translation
    const result = await tm.get('en', 'es', sourceText);

    expect(result).toBeDefined();
    expect(result.text).toBe(translatedText);
    expect(result.source).toBe('en');
    expect(result.target).toBe('es');
    expect(result.provider).toBe('qwen');
    expect(result.cached).toBe(true);
  });

  test('should return null for non-existent translations', async () => {
    const result = await tm.get('en', 'es', 'Non-existent text');
    expect(result).toBeNull();
  });

  test('should update access order on retrieval', async () => {
    await tm.set('en', 'es', 'Test', 'Prueba', 'qwen');

    const initialAccess = tm.accessOrder.get('en:es:test');

    // Wait a bit and retrieve again
    await new Promise(resolve => setTimeout(resolve, 10));
    await tm.get('en', 'es', 'Test');

    const updatedAccess = tm.accessOrder.get('en:es:test');
    expect(updatedAccess).toBeGreaterThan(initialAccess);
  });

  test('should track metrics correctly', async () => {
    const initialStats = tm.getStats();
    expect(initialStats.hits).toBe(0);
    expect(initialStats.misses).toBe(0);
    expect(initialStats.sets).toBe(0);

    // Store a translation
    await tm.set('en', 'es', 'Hello', 'Hola', 'qwen');
    expect(tm.getStats().sets).toBe(1);

    // Hit
    await tm.get('en', 'es', 'Hello');
    expect(tm.getStats().hits).toBe(1);

    // Miss
    await tm.get('en', 'es', 'Goodbye');
    expect(tm.getStats().misses).toBe(1);
  });

  test('should enforce cache size limit with LRU eviction', async () => {
    // Create TM with small limit
    const smallTM = new TranslationMemory({ maxEntries: 3 });

    // Add entries exceeding limit
    await smallTM.set('en', 'es', 'One', 'Uno', 'qwen');
    await smallTM.set('en', 'es', 'Two', 'Dos', 'qwen');
    await smallTM.set('en', 'es', 'Three', 'Tres', 'qwen');
    await smallTM.set('en', 'es', 'Four', 'Cuatro', 'qwen');

    // Cache should be limited
    expect(smallTM.cache.size).toBeLessThanOrEqual(3);
    expect(smallTM.getStats().evictionsLRU).toBeGreaterThan(0);
  });

  test('should handle TTL expiration', async () => {
    // Create TM with very short TTL
    const shortTM = new TranslationMemory({ defaultTTL: 50 }); // 50ms

    await shortTM.set('en', 'es', 'Expire', 'Expirar', 'qwen');

    // Should be available immediately
    let result = await shortTM.get('en', 'es', 'Expire');
    expect(result).toBeDefined();

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should be expired
    result = await shortTM.get('en', 'es', 'Expire');
    expect(result).toBeNull();
    expect(shortTM.getStats().evictionsTTL).toBeGreaterThan(0);
  });

  test('should clear all translations', async () => {
    await tm.set('en', 'es', 'Hello', 'Hola', 'qwen');
    await tm.set('en', 'fr', 'Hello', 'Bonjour', 'qwen');

    expect(tm.cache.size).toBe(2);

    await tm.clear();

    expect(tm.cache.size).toBe(0);
    expect(tm.accessOrder.size).toBe(0);
  });

  test('should handle cleanup of expired entries', async () => {
    const shortTM = new TranslationMemory({ defaultTTL: 50 });

    await shortTM.set('en', 'es', 'Expire1', 'Expirar1', 'qwen');
    await shortTM.set('en', 'es', 'Expire2', 'Expirar2', 'qwen');

    expect(shortTM.cache.size).toBe(2);

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 100));

    // Cleanup should remove expired entries
    const cleaned = await shortTM.cleanup();
    expect(cleaned).toBe(2);
    expect(shortTM.cache.size).toBe(0);
  });
});

describe('Global Translation Memory Factory', () => {
  test('should create singleton instance', () => {
    const tm1 = getTranslationMemory();
    const tm2 = getTranslationMemory();

    expect(tm1).toBe(tm2);
  });

  test('should pass options to constructor on first call', () => {
    const tm = getTranslationMemory({
      maxEntries: 5000,
      defaultTTL: 7 * 24 * 60 * 60 * 1000
    });

    expect(tm.maxEntries).toBe(5000);
    expect(tm.defaultTTL).toBe(7 * 24 * 60 * 60 * 1000);
  });
});