# TRANSLATE! Improvement Plan

> Audit status: reviewed 2026-05-12 for MIK-3339 against the current codebase.
> This file is now a live backlog map, not an untouched idea dump.

## Current Priority Order

### P0: Product Differentiators Still Open

- [ ] **Contextual page-semantic translation** — Track in Linear as MIK-3469. Inject bounded page/section context into TranslateGemma prompts without changing the model. `formatTranslateGemmaPrompt()` remains a prompt-formatting seam; no shipped page-semantic prompt path was found in the current repo.
- [ ] **Screenshot OCR translation overlay** — Track in Linear as MIK-3471. Capture/crop/OCR plumbing exists, but the user-facing region selection, translation, positioned overlay, and cleanup/undo path still need to be wired.

### P1: Performance Work Still Open

- [ ] **WebGPU batch inference** — Track in Linear as MIK-3472. TranslateGemma has WebGPU/WebNN runtime gating, but the specific single-forward-pass batch inference path is still open.
- [ ] **Translation quality indicators** — OPUS-MT/log-prob confidence UI is not shipped. Confidence currently exists for language detection, OCR, and prediction/preload paths, not per-segment translation quality indicators.
- [ ] **Page-level translation memory** — Global IndexedDB segment cache is shipped, but URL/page snapshot memory for instant whole-page revisit is not.

### P2: Research / Deferred

- [ ] **Speculative decoding** — Still a research path. Transformers.js may expose the required generation fields, but there is no shipped OPUS-MT draft + Gemma verify flow.
- [ ] **WebNN NPU acceleration hardening** — Runtime detection and TranslateGemma gating exist, but WebNN should stay deferred until production browser support and model coverage are reliable.

## Shipped Or Superseded Items

- [x] **E2E browser tests with Playwright** — Shipped. Extension load, popup, translation, context menu, WebMCP, CSP/model-loading, WebGPU detection, PDF, and harness flows are covered under `e2e/`; `package.json` wires them through `test:e2e:*`.
- [x] **Smart language detection** — Shipped. `src/core/language-detector.ts` provides fast trigram/script detection; `src/offscreen/language-detection.ts` layers Chrome LanguageDetector, Firefox i18n, franc-min, and script heuristics.
- [x] **Shadow DOM support** — Shipped. `src/content/shadow-dom-walker.ts` walks open/closed shadow roots, observes new roots, and cleans up observers; content DOM utilities consume it.
- [x] **Streaming translation** — Shipped baseline. `src/background/shared/stream-port-handler.ts` streams chunks over `translate-stream`; `e2e/streaming-cancel.harness.spec.ts` covers abort behavior.
- [x] **IndexedDB translation memory** — Shipped. `src/core/translation-cache.ts` implements a 100MB IndexedDB-backed LRU cache with stats and eviction.
- [x] **Inline editing + correction learning** — Shipped. `src/content/correction.ts` makes translated elements editable and saves corrections via `addCorrection`.
- [x] **PDF layout-preserving translation** — Shipped. `src/content/pdf-translator.ts` uses pdf.js text spans, groups them, translates them, and renders a toggleable layout overlay.
- [x] **Video subtitle translation** — Shipped. `src/content/subtitle-translator.ts` supports standard TextTrack cues and YouTube caption segments.
- [x] **SharedWorker migration** — Killed. The original premise is superseded: the service worker/offscreen architecture already gives shared cache/model behavior, and content scripts cannot reliably connect to an extension SharedWorker from page origin.

## Audit Evidence

- E2E and harness scripts: `package.json`
- Trigram detector: `src/core/language-detector.ts`
- Browser/offscreen detector fallback: `src/offscreen/language-detection.ts`
- Shadow DOM walker: `src/content/shadow-dom-walker.ts`
- Streaming port: `src/background/shared/stream-port-handler.ts`
- IndexedDB cache: `src/core/translation-cache.ts`
- Correction learning: `src/content/correction.ts`
- PDF translation: `src/content/pdf-translator.ts`
- Screenshot/OCR plumbing: `src/background/shared/media-handlers.ts`, `src/offscreen/offscreen.ts`
- Subtitle translation: `src/content/subtitle-translator.ts`
- Runtime acceleration checks: `src/offscreen/offscreen.ts`, `src/shared/provider-options.ts`

## Execution Notes

- Each remaining item must be independently committable and must include unit tests or an explicit spike verdict.
- Run `npm run validate:ci` for doc-adjacent changes that touch package metadata or source code. For docs-only updates, at minimum run `npm run format`, targeted tests when relevant, and `git diff --check`.
- Do not add new high-priority improvement items here without creating or linking a Linear issue.
