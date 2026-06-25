/**
 * Chrome Built-in Language Detection
 *
 * Extracted, unit-testable LanguageDetector logic that mirrors the algorithm
 * the main-world injected adapter in `service-worker.ts` runs in-page before
 * calling `Translator.availability()` / `Translator.create()`.
 *
 * The main-world adapter cannot call into this module (it is serialised by
 * `chrome.scripting.executeScript` and runs in the tab's MAIN world), so the
 * algorithm is duplicated there with a reference to `MIN_DETECT_CONFIDENCE`.
 * This module is the source of truth for the threshold constant and the
 * detection contract.
 */

/**
 * Minimum confidence score (0–1) required from `LanguageDetector` to accept
 * a detected language as the concrete `sourceLanguage` for `Translator`.
 *
 * When the top-ranked detection scores below this threshold the adapter falls
 * back to an explicit error asking the user to choose a source language
 * manually, rather than forwarding a low-confidence guess that could produce
 * a mis-translation.
 */
export const MIN_DETECT_CONFIDENCE = 0.7;

/**
 * Structural type for the Chrome LanguageDetector API surface used by
 * `detectSourceLanguage`.  Kept narrow so tests can supply lightweight fakes.
 */
export interface LanguageDetectorLike {
  availability(): Promise<{ available: 'no' | 'readily' | 'after-download' }>;
  create(): Promise<{
    detect(text: string): Promise<Array<{
      detectedLanguage: string;
      confidence: number;
    }>>;
    destroy?(): void;
  }>;
}

/**
 * Outcome of a `detectSourceLanguage` call.
 *
 * - `ok` — detection succeeded; `language` is the concrete source language.
 * - `fallback` — detection was not usable; `reason` describes why.
 */
export type DetectionResult =
  | { ok: true; language: string }
  | { ok: false; reason: string };

/**
 * Detect the source language of `text` using the Chrome `LanguageDetector` API.
 *
 * Fallback branches (any of these yields `{ ok: false }`):
 * 1. `LanguageDetector.availability()` returns `{ available: 'no' }`.
 * 2. `detect()` returns an empty result array.
 * 3. Top-ranked detection confidence is below `MIN_DETECT_CONFIDENCE`.
 * 4. Top-ranked `detectedLanguage` is `'und'` (undetermined).
 * 5. `LanguageDetector` throws at any step.
 *
 * The detector instance is always destroyed (when it exposes `destroy()`)
 * before the function returns, regardless of outcome.
 */
export async function detectSourceLanguage(
  detector: LanguageDetectorLike,
  text: string,
): Promise<DetectionResult> {
  try {
    const availability = await detector.availability();
    if (availability.available === 'no') {
      return { ok: false, reason: 'LanguageDetector reported unavailable' };
    }

    const instance = await detector.create();
    try {
      const sample = text.slice(0, 500);
      const detections = await instance.detect(sample);
      const best = detections[0];

      if (!best) {
        return { ok: false, reason: 'LanguageDetector returned no results' };
      }

      if (best.confidence < MIN_DETECT_CONFIDENCE) {
        return {
          ok: false,
          reason: `confidence too low (${best.confidence} < ${MIN_DETECT_CONFIDENCE})`,
        };
      }

      if (best.detectedLanguage === 'und') {
        return { ok: false, reason: 'detectedLanguage is und (undetermined)' };
      }

      return { ok: true, language: best.detectedLanguage };
    } finally {
      instance.destroy?.();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}

/**
 * Derive the cache source-language key for a chrome-builtin auto request.
 *
 * Returns `null` when the original request used `sourceLang: 'auto'` and no
 * validated detected language is supplied — the caller MUST NOT write a
 * source-language-keyed cache entry in that case, to avoid polluting the
 * cache with guesses.
 *
 * When a validated detected language IS supplied (from a successful
 * `detectSourceLanguage` call inside the main-world adapter), the cache may
 * store the entry keyed by that concrete language.
 */
export function resolveCacheSourceLang(
  requestedSourceLang: string,
  validatedDetectedLang: string | null | undefined,
): string | null {
  if (requestedSourceLang !== 'auto') {
    return requestedSourceLang;
  }
  return validatedDetectedLang ?? null;
}
