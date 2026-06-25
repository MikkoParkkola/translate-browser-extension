/**
 * MIK-3470 — chrome-builtin LanguageDetector detection path tests.
 *
 * Covers the detection → availability → create ordering, the documented
 * fallback branch, and the cache-key handling for auto-detected requests
 * that the main-world adapter in `service-worker.ts` mirrors.
 *
 * Acceptance criteria (verbatim from ticket MIK-3470):
 *
 * AC.1 (DETECT.1): When provider === 'chrome-builtin' and sourceLang === 'auto',
 * the main-world injected adapter calls LanguageDetector.detect(text) and uses
 * the top-ranked detectedLanguage as the concrete sourceLanguage passed to
 * Translator.availability() / Translator.create(), in the same main-world
 * script (no detection bypass).
 *
 * AC.2 (DETECT.2): A documented fallback path exists for when LanguageDetector
 * is unavailable (availability() not 'available'/'downloadable'), returns
 * confidence below a named threshold constant, returns und, or throws —
 * behavior is explicit in code (e.g. a named MIN_DETECT_CONFIDENCE constant
 * and a code comment describing the fallback) and does not crash the
 * translation.
 *
 * AC.3 (CACHE.3): Existing cache behavior is preserved — the implementation
 * does NOT write a source-language-keyed cache entry for an auto-detected
 * request UNLESS it explicitly stores the validated detected language as the
 * source key.
 */

import { describe, it, expect } from 'vitest';
import {
  detectSourceLanguage,
  resolveCacheSourceLang,
  MIN_DETECT_CONFIDENCE,
  type LanguageDetectorLike,
} from './chrome-builtin-detection';

// ---------------------------------------------------------------------------
// Helpers — lightweight LanguageDetector fakes
// ---------------------------------------------------------------------------

function createDetector(
  overrides: Partial<{
    availability: 'no' | 'readily' | 'after-download';
    detections: Array<{ detectedLanguage: string; confidence: number }>;
    detectError: Error;
    createError: Error;
    availabilityError: Error;
  }> = {},
): LanguageDetectorLike & { destroyCalled: boolean } {
  let destroyCalled = false;
  const availability = overrides.availability ?? 'readily';
  const detections = overrides.detections ?? [{ detectedLanguage: 'en', confidence: 0.95 }];

  return {
    destroyCalled,
    availability() {
      if (overrides.availabilityError) {
        return Promise.reject(overrides.availabilityError);
      }
      return Promise.resolve({ available: availability });
    },
    create() {
      if (overrides.createError) {
        return Promise.reject(overrides.createError);
      }
      return Promise.resolve({
        detect(_text: string) {
          if (overrides.detectError) {
            return Promise.reject(overrides.detectError);
          }
          return Promise.resolve(detections);
        },
        destroy() {
          destroyCalled = true;
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// AC.1 (DETECT.1) — detect → availability → create ordering
// ---------------------------------------------------------------------------

describe('AC.1 (DETECT.1): LanguageDetector.detect before Translator.create', () => {
  it('calls availability() then create() then detect() in order and returns top-ranked detectedLanguage', async () => {
    const callOrder: string[] = [];
    const detector: LanguageDetectorLike = {
      availability() {
        callOrder.push('availability');
        return Promise.resolve({ available: 'readily' });
      },
      create() {
        callOrder.push('create');
        return Promise.resolve({
          detect(text: string) {
            callOrder.push(`detect(${text.length})`);
            return Promise.resolve([
              { detectedLanguage: 'fr', confidence: 0.92 },
              { detectedLanguage: 'en', confidence: 0.05 },
            ]);
          },
          destroy() {},
        });
      },
    };

    const result = await detectSourceLanguage(detector, 'Bonjour le monde');

    expect(result).toEqual({ ok: true, language: 'fr' });
    expect(callOrder).toEqual(['availability', 'create', 'detect(16)']);
  });

  it('uses the top-ranked detection (index 0) as the concrete source language', async () => {
    const detector = createDetector({
      detections: [
        { detectedLanguage: 'de', confidence: 0.88 },
        { detectedLanguage: 'en', confidence: 0.10 },
      ],
    });

    const result = await detectSourceLanguage(detector, 'Hallo Welt');

    expect(result).toEqual({ ok: true, language: 'de' });
  });

  it('slices the input text to at most 500 chars for the detect sample', async () => {
    let receivedSample = '';
    const detector: LanguageDetectorLike = {
      availability: () => Promise.resolve({ available: 'readily' }),
      create: () =>
        Promise.resolve({
          detect(text: string) {
            receivedSample = text;
            return Promise.resolve([{ detectedLanguage: 'en', confidence: 0.9 }]);
          },
        }),
    };

    const longText = 'a'.repeat(1000);
    await detectSourceLanguage(detector, longText);

    expect(receivedSample.length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// AC.2 (DETECT.2) — fallback path for LanguageDetector failures
// ---------------------------------------------------------------------------

describe('AC.2 (DETECT.2): fallback path when LanguageDetector is unavailable or unreliable', () => {
  it('MIN_DETECT_CONFIDENCE is exported as a named threshold constant', () => {
    expect(typeof MIN_DETECT_CONFIDENCE).toBe('number');
    expect(MIN_DETECT_CONFIDENCE).toBeGreaterThan(0);
    expect(MIN_DETECT_CONFIDENCE).toBeLessThanOrEqual(1);
  });

  it('returns fallback when availability() reports "no"', async () => {
    const detector = createDetector({ availability: 'no' });

    const result = await detectSourceLanguage(detector, 'Hello');

    expect(result).toEqual({ ok: false, reason: 'LanguageDetector reported unavailable' });
  });

  it('returns fallback when availability() throws', async () => {
    const detector = createDetector({
      availabilityError: new Error('API not initialized'),
    });

    const result = await detectSourceLanguage(detector, 'Hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('API not initialized');
    }
  });

  it('returns fallback when create() throws', async () => {
    const detector = createDetector({
      createError: new Error('Model download failed'),
    });

    const result = await detectSourceLanguage(detector, 'Hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Model download failed');
    }
  });

  it('returns fallback when detect() throws', async () => {
    const detector = createDetector({
      detectError: new Error('Internal detector crash'),
    });

    const result = await detectSourceLanguage(detector, 'Hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Internal detector crash');
    }
  });

  it('returns fallback when confidence is below MIN_DETECT_CONFIDENCE threshold', async () => {
    const detector = createDetector({
      detections: [{ detectedLanguage: 'en', confidence: MIN_DETECT_CONFIDENCE - 0.01 }],
    });

    const result = await detectSourceLanguage(detector, 'Hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('confidence too low');
      expect(result.reason).toContain(String(MIN_DETECT_CONFIDENCE));
    }
  });

  it('accepts detection when confidence equals MIN_DETECT_CONFIDENCE exactly', async () => {
    const detector = createDetector({
      detections: [{ detectedLanguage: 'en', confidence: MIN_DETECT_CONFIDENCE }],
    });

    const result = await detectSourceLanguage(detector, 'Hello');

    expect(result).toEqual({ ok: true, language: 'en' });
  });

  it('returns fallback when detect() returns empty results', async () => {
    const detector = createDetector({ detections: [] });

    const result = await detectSourceLanguage(detector, 'Hello');

    expect(result).toEqual({ ok: false, reason: 'LanguageDetector returned no results' });
  });

  it('returns fallback when detectedLanguage is "und" (undetermined)', async () => {
    const detector = createDetector({
      detections: [{ detectedLanguage: 'und', confidence: 0.99 }],
    });

    const result = await detectSourceLanguage(detector, '???');

    expect(result).toEqual({ ok: false, reason: 'detectedLanguage is und (undetermined)' });
  });

  it('does not crash the caller — always resolves (never rejects) on detector failure', async () => {
    const detector = createDetector({
      detectError: new Error('catastrophic failure'),
    });

    const result = await detectSourceLanguage(detector, 'text');

    expect(result.ok).toBe(false);
  });

  it('calls destroy() on the detector instance even when detect() throws', async () => {
    let destroyCalled = false;
    const detector: LanguageDetectorLike = {
      availability: () => Promise.resolve({ available: 'readily' }),
      create: () =>
        Promise.resolve({
          detect: () => Promise.reject(new Error('boom')),
          destroy() {
            destroyCalled = true;
          },
        }),
    };

    await detectSourceLanguage(detector, 'text');

    expect(destroyCalled).toBe(true);
  });

  it('calls destroy() on the detector instance after successful detection', async () => {
    let destroyCalled = false;
    const detector: LanguageDetectorLike = {
      availability: () => Promise.resolve({ available: 'readily' }),
      create: () =>
        Promise.resolve({
          detect: () =>
            Promise.resolve([{ detectedLanguage: 'en', confidence: 0.95 }]),
          destroy() {
            destroyCalled = true;
          },
        }),
    };

    await detectSourceLanguage(detector, 'text');

    expect(destroyCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC.3 (CACHE.3) — cache-key derivation for auto-detected requests
// ---------------------------------------------------------------------------

describe('AC.3 (CACHE.3): cache-key derivation for auto source-language requests', () => {
  it('does NOT write a source-language-keyed cache entry for an auto request without validated detected language', () => {
    const cacheKey = resolveCacheSourceLang('auto', null);
    expect(cacheKey).toBeNull();
  });

  it('does NOT write a source-language-keyed cache entry for an auto request with undefined detected language', () => {
    const cacheKey = resolveCacheSourceLang('auto', undefined);
    expect(cacheKey).toBeNull();
  });

  it('uses the validated detected language as the source key when provided for an auto request', () => {
    const cacheKey = resolveCacheSourceLang('auto', 'fr');
    expect(cacheKey).toBe('fr');
  });

  it('preserves the explicit source language when sourceLang is not auto', () => {
    expect(resolveCacheSourceLang('en', null)).toBe('en');
    expect(resolveCacheSourceLang('de', undefined)).toBe('de');
    expect(resolveCacheSourceLang('ja', 'fr')).toBe('ja');
  });
});
