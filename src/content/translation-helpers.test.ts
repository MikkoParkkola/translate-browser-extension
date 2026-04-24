/**
 * Tests for src/content/translation-helpers.ts
 *
 * Focus: error classification for retry + Chrome Built-in fallback.
 * These regexes gate user-visible behavior — a miss means we fail the batch
 * wholesale on SPAs (trainline, gmail) where the target frame tears down
 * mid-injection.
 */

import { describe, it, expect } from 'vitest';
import {
  isTransientError,
  isChromeBuiltinTransientError,
  CHROME_BUILTIN_TRANSIENT_RE,
} from './translation-helpers';

describe('isTransientError', () => {
  it('classifies network + timeout + infra errors as transient (legacy patterns)', () => {
    expect(isTransientError('Request timeout')).toBe(true);
    expect(isTransientError('network error')).toBe(true);
    expect(isTransientError('ECONNRESET')).toBe(true);
    expect(isTransientError('fetch failed')).toBe(true);
    expect(isTransientError('Service worker disconnected')).toBe(true);
    expect(isTransientError('Offscreen document not available')).toBe(true);
    expect(isTransientError('Loading model, please wait')).toBe(true);
  });

  it('classifies Chrome Built-in frame-destroy errors as transient (regression: trainline SPA)', () => {
    // Exact error strings observed in production on thetrainline.com
    expect(isTransientError('Frame with ID 0 was removed.')).toBe(true);
    expect(isTransientError('Chrome Translator returned no result')).toBe(true);
    expect(isTransientError('Frame 42 was removed')).toBe(true);
    expect(isTransientError('Frame abc detached')).toBe(true);
  });

  it('does NOT classify fatal errors as transient', () => {
    expect(isTransientError('Language pair not supported: en-xx')).toBe(false);
    expect(isTransientError('Invalid API key')).toBe(false);
    expect(isTransientError('Extension context invalidated')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isTransientError('TIMEOUT')).toBe(true);
    expect(isTransientError('FRAME WITH ID 0 WAS REMOVED')).toBe(true);
  });
});

describe('isChromeBuiltinTransientError', () => {
  it('matches only Chrome Built-in frame/result failure modes', () => {
    expect(isChromeBuiltinTransientError('Frame with ID 0 was removed.')).toBe(true);
    expect(isChromeBuiltinTransientError('Frame 1 was removed')).toBe(true);
    expect(isChromeBuiltinTransientError('Frame 7 detached')).toBe(true);
    expect(isChromeBuiltinTransientError('Chrome Translator returned no result')).toBe(true);
    expect(isChromeBuiltinTransientError('No active tab for Chrome Translator')).toBe(true);
  });

  it('does NOT match general network errors (narrower than isTransientError)', () => {
    expect(isChromeBuiltinTransientError('Request timeout')).toBe(false);
    expect(isChromeBuiltinTransientError('fetch failed')).toBe(false);
    expect(isChromeBuiltinTransientError('ECONNRESET')).toBe(false);
  });

  it('does NOT match fatal Chrome Translator errors (API missing, unsupported pair)', () => {
    expect(isChromeBuiltinTransientError('Chrome Translator API not available (requires Chrome 138+)')).toBe(false);
    expect(isChromeBuiltinTransientError('Language pair not supported: en-xx')).toBe(false);
  });

  it('exposes the raw regex for reuse', () => {
    expect(CHROME_BUILTIN_TRANSIENT_RE).toBeInstanceOf(RegExp);
    expect(CHROME_BUILTIN_TRANSIENT_RE.flags).toContain('i');
  });
});
