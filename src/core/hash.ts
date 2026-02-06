/**
 * Hash utilities for cache keys.
 * FNV-1a hash - fast and good distribution for string keys.
 */

/**
 * FNV-1a hash for strings.
 * Returns 8-character hex string.
 */
export function fnv1aHash(input: string): string {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  // Convert to unsigned 32-bit integer and then to hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generate cache key for translation.
 * Uses FNV-1a hash to prevent collisions from truncation.
 */
export function generateCacheKey(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: string
): string {
  const normalizedText = Array.isArray(text) ? text.join('|||') : text;
  const hash = fnv1aHash(normalizedText);
  return `${provider}:${sourceLang}-${targetLang}:${hash}`;
}
