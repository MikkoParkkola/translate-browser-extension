/**
 * Hash utility tests
 */

import { describe, it, expect } from 'vitest';
import { fnv1aHash, generateCacheKey } from './hash';

describe('Hash Utilities', () => {
  describe('fnv1aHash', () => {
    it('returns 8-character hex string', () => {
      const hash = fnv1aHash('hello');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('returns consistent hash for same input', () => {
      const hash1 = fnv1aHash('test input');
      const hash2 = fnv1aHash('test input');
      expect(hash1).toBe(hash2);
    });

    it('returns different hashes for different inputs', () => {
      const hash1 = fnv1aHash('hello');
      const hash2 = fnv1aHash('world');
      expect(hash1).not.toBe(hash2);
    });

    it('handles empty string', () => {
      const hash = fnv1aHash('');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('handles long strings without collision', () => {
      // Two strings with same prefix but different endings
      const longText1 = 'a'.repeat(1000) + '1';
      const longText2 = 'a'.repeat(1000) + '2';
      expect(fnv1aHash(longText1)).not.toBe(fnv1aHash(longText2));
    });

    it('handles unicode characters', () => {
      const hash = fnv1aHash('こんにちは世界');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('generateCacheKey', () => {
    it('generates key with correct format', () => {
      const key = generateCacheKey('hello', 'en', 'fi', 'opus-mt');
      expect(key).toMatch(/^opus-mt:en-fi:[0-9a-f]{8}$/);
    });

    it('returns same key for same inputs', () => {
      const key1 = generateCacheKey('hello world', 'en', 'de', 'deepl');
      const key2 = generateCacheKey('hello world', 'en', 'de', 'deepl');
      expect(key1).toBe(key2);
    });

    it('returns different keys for different texts', () => {
      const key1 = generateCacheKey('hello', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey('world', 'en', 'fi', 'opus-mt');
      expect(key1).not.toBe(key2);
    });

    it('returns different keys for different languages', () => {
      const key1 = generateCacheKey('hello', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey('hello', 'en', 'de', 'opus-mt');
      expect(key1).not.toBe(key2);
    });

    it('returns different keys for different providers', () => {
      const key1 = generateCacheKey('hello', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey('hello', 'en', 'fi', 'deepl');
      expect(key1).not.toBe(key2);
    });

    it('handles array of texts', () => {
      const key = generateCacheKey(['hello', 'world'], 'en', 'fi', 'opus-mt');
      expect(key).toMatch(/^opus-mt:en-fi:[0-9a-f]{8}$/);
    });

    it('distinguishes between single text and array with same content', () => {
      const key1 = generateCacheKey('hello|||world', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey(['hello', 'world'], 'en', 'fi', 'opus-mt');
      // They should be equal since array is joined with |||
      expect(key1).toBe(key2);
    });

    it('handles long texts that would cause collision with substring', () => {
      // Same first 100 chars, different endings - old implementation would collide
      const prefix = 'a'.repeat(100);
      const text1 = prefix + ' ending1';
      const text2 = prefix + ' ending2';

      const key1 = generateCacheKey(text1, 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey(text2, 'en', 'fi', 'opus-mt');

      // With hash-based keys, these should be different
      expect(key1).not.toBe(key2);
    });

    it('handles empty text', () => {
      const key = generateCacheKey('', 'en', 'fi', 'opus-mt');
      expect(key).toMatch(/^opus-mt:en-fi:[0-9a-f]{8}$/);
    });

    it('handles empty array', () => {
      const key = generateCacheKey([], 'en', 'fi', 'opus-mt');
      expect(key).toMatch(/^opus-mt:en-fi:[0-9a-f]{8}$/);
    });
  });
});
