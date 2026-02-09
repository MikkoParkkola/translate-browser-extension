# TRANSLATE! Improvement Plan

## Priority Order (by impact x effort ratio)

### Phase 1: Bulletproof Foundation
- [ ] **E2E browser tests with Playwright** — Zero integration tests currently. Add Chrome extension loading, page translation, undo, hover, selection, dynamic content. MUST before any architecture changes.
- [ ] **Smart language detection (trigram)** — Fast in-content-script language detector. Eliminates `sourceLang: 'auto'` round-trip. Enables cache hits for auto-detected pages. ~50 lines, no deps.
- [ ] **Shadow DOM support** — TreeWalker into shadowRoot for Web Components (YouTube, GitHub, SPAs).

### Phase 2: Performance & Architecture
- [ ] **Streaming translation** — Pipe partial batch results back as they complete. Massive perceived latency improvement.
- [ ] **IndexedDB translation memory** — Replace chrome.storage.local (5MB limit) with IndexedDB. Unlimited cache, sub-ms lookups, proper indexes.
- [ ] **WebGPU batch inference** — Single tensor forward pass instead of N pipeline calls. 3-5x throughput.

### Phase 3: UX & Intelligence
- [ ] **Inline editing + correction learning** — Make translated text contenteditable, save corrections on blur, auto-apply next time.
- [ ] **Translation quality indicators** — Show OPUS-MT log-prob confidence per segment. Low confidence = subtle underline.
- [ ] **Page-level translation memory** — Remember translations per-URL. Instant on revisit.

### Phase 4: Future Architecture
- [ ] **SharedWorker migration** — Replace offscreen doc (being deprecated) with SharedWorker for better lifecycle. Cross-tab model sharing, persistent inference engine, eliminates MV3 suspension issues.

### Phase 5: Moonshot Features (ALL SPIKES COMPLETE — see docs/INNOVATION_REPORT.md)
- [ ] **Contextual page-semantic translation** [GO P0] — Inject page structure context into TranslateGemma prompts. `formatTranslateGemmaPrompt()` is a template string, zero model changes. Prompt engineering + DOM section analysis.
- [ ] **Screenshot OCR translation** [GO P0] — captureVisibleTab + Tesseract.js v7 (in deps) + translate + overlay. OCRImageMessage types exist. Wire the pipeline.
- [ ] **PDF layout-preserving translation** [GO P1] — pdf.js `getTextContent()` returns `{str, transform[6], width, height, fontName}` per text span (validated). Add `pdfjs-dist` (~2.5MB). Overlay translated text at original coordinates. Toggle original/translated.
- [ ] **Video subtitle translation** [GO P1] — TextTrack.cues accessible from content script. YouTube: `.ytp-caption-segment` DOM scraping. MVP: standard `<track>` + YouTube. Netflix/Disney+ deferred (EME complexity).
- [ ] **Speculative decoding** [GO P2] — Transformers.js has `output_scores` + `return_dict_in_generate` in GenerationConfig, `scores.push` pattern (8x). Pass `{output_scores:true}` to generate(). OPUS-MT draft + Gemma verify.
- [ ] ~~SharedWorker migration~~ [KILLED] — Content scripts run in PAGE origin, can't connect to extension SharedWorker. Cross-tab cache already works via service worker Map. Single offscreen doc already shares models. Zero value.
- [ ] ~~LoRA personal translation style~~ [KILLED] — Transformers.js lacks LoRA. Correction data collecting for future.
- [ ] **WebNN NPU acceleration** [DEFERRED] — Not production-ready. Architecture ready (add `'webnn'` to execution tier enum).

## Execution Notes
- Each item is independently committable
- Phase 1 items are prerequisites for safe Phase 2 changes
- All changes must pass: `npx tsc --noEmit && npx vitest run && npm run build`
- 798 existing tests must remain green
