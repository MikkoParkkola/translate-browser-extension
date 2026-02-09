# TRANSLATE! Innovation Report — Moonshot Ideas

## State-of-Art Map (February 2026)

### Current TRANSLATE! Architecture (Already Ahead of Most)
| Capability | Status | Notes |
|---|---|---|
| OPUS-MT local inference | ✅ Shipping | 76 direct + 50 pivot language pairs |
| TranslateGemma 4B | ✅ Shipping | Q4 ONNX WebGPU, any-to-any, user's own quantized model |
| Chrome Translator API | ✅ Integrated | Chrome 138+, zero cold start |
| WebGPU acceleration | ✅ Shipping | Auto-fallback to WASM |
| Cloud providers | ✅ 4 providers | DeepL, OpenAI, Anthropic, Google Cloud |
| Predictive model preloading | ✅ Shipping | Browsing pattern learning |
| Correction learning | ✅ Typed | Message types exist, UI partially built |
| OCR image extraction | ✅ Typed | Tesseract.js integration |
| Profiling/instrumentation | ✅ Comprehensive | 16 timing categories, p50/p95/p99 |

### Competitor Landscape
| Product | Tech | Local? | Quality | Gap |
|---|---|---|---|---|
| **Google Translate ext** | Cloud API | No | Good | Privacy, offline |
| **DeepL extension** | Cloud API | No | Excellent | Privacy, offline, cost |
| **Firefox built-in** | Bergamot (WASM) | Yes | Decent | No WebGPU, no LLM |
| **Edge Translator** | Cloud API | No | Good | Privacy, offline |
| **Immersive Translate** | Multi-provider | Partial | Varies | No local LLM |
| **TRANSLATE!** | OPUS-MT + Gemma + Chrome API | **Yes** | Good-Excellent | **Already leading** |

### Bleeding Edge Tech Available Now (🟢Shipping / 🟡Origin Trial / 🔴Experimental)

| Technology | Status | Impact |
|---|---|---|
| **Chrome Translator API** | 🟢 Chrome 138+ | Zero-download translation |
| **Chrome Language Detector API** | 🟢 Chrome 138+ | Sub-ms detection, no deps |
| **WebGPU compute shaders** | 🟢 Chrome/Edge | 5-10x faster tensor ops |
| **Transformers.js v3 WebGPU** | 🟢 Production | fp16 inference in browser |
| **ONNX Runtime Web + WebGPU** | 🟢 Production | Q4/Q8 quantized model inference |
| **WebNN API** | 🟡 Chrome 134+ OT | Hardware-accelerated ML via NPU/GPU |
| **Speculative decoding** | 🔴 Research | 2-3x faster autoregressive |
| **LoRA adapters in browser** | 🔴 Research | Model personalization at ~1MB |
| **SharedArrayBuffer in ext** | 🟢 Available | Multi-threaded WASM |

---

## MOONSHOT IDEAS (Ranked by Impact × Feasibility)

---

### 🚀 MOONSHOT 1: PDF Layout-Preserving Translation (MARKET GAP)

**The Problem**: No browser extension properly translates PDFs while preserving layout, fonts, tables, headers, footers, and formatting. Every attempt breaks the visual structure. This is the #1 unmet need in the market.

**Why It's Hard**: PDFs are not semantic documents — they're positioned glyphs. Text extraction loses structure. Re-rendering with different-length translated text breaks columns, tables, and visual hierarchy.

**The Approach**:
1. **pdf.js extraction with position metadata**: Extract text blocks WITH their exact (x, y, width, height, font, size, color) from PDF rendering
2. **Structural analysis**: Use heuristics + ML to identify: paragraphs, headers, table cells, captions, footnotes, page numbers, sidebars
3. **Block-level translation**: Translate each structural block independently, preserving context via surrounding blocks
4. **Adaptive re-rendering**: For each translated block:
   - If text fits: same font size, same position
   - If text overflows: reduce font size (min 80% original), then line-break within bounds
   - Tables: adjust column widths proportionally
5. **Overlay approach**: Render translated text as an overlay layer on the original PDF canvas, with toggle to show/hide original
6. **Export**: Generate translated PDF using pdf-lib with preserved structure

**Key Insight**: Don't try to recreate the PDF. Overlay translated text on the original rendering. The user sees the translated version with identical layout, and can toggle to see the original.

**Technology**:
- pdf.js (already in browser) for rendering + text extraction with positions
- Canvas overlay for translated text with font matching
- pdf-lib for exportable translated PDF
- Structural heuristics (column detection, table grid detection)

**Effort**: High (2-3 weeks for MVP)
**Impact**: MASSIVE — literally no competitor does this well
**ROI**: This alone could make TRANSLATE! the #1 translation extension

---

### 🚀 MOONSHOT 2: Speculative Decoding with Draft Models

**The Idea**: Use OPUS-MT (small, fast, ~170MB) as a "draft" model to generate candidate translations, then verify/correct with TranslateGemma 4B in a single forward pass. This gives OPUS-MT speed with near-Gemma quality.

**How It Works**:
1. OPUS-MT generates full draft translation (fast, parallel)
2. TranslateGemma evaluates all draft tokens in ONE forward pass (parallelizable, unlike autoregressive generation)
3. Where Gemma agrees: keep draft token (free)
4. Where Gemma disagrees: use Gemma's token, continue from there
5. Result: 2-4x speedup over pure Gemma, with Gemma-level quality

**Why This Is Revolutionary**: Nobody is doing speculative decoding in a browser extension. The architecture is uniquely suited because we already have both model tiers loaded.

**Effort**: Medium (1-2 weeks)
**Impact**: 2-4x faster high-quality translation
**Feasibility**: 🟡 Requires custom inference loop, but Transformers.js exposes logits

---

### 🚀 MOONSHOT 3: Cross-Tab Translation Memory with SharedWorker

**The Idea**: Replace the offscreen document with a SharedWorker that persists across ALL tabs. Translation memory, loaded models, and inference engines are shared. Tab A translates Finnish→English? Tab B gets that translation instantly from shared memory.

**Architecture**:
```
Tab A (content script) ─┐
Tab B (content script) ─┼─→ SharedWorker (models + cache + inference)
Tab C (content script) ─┘    ├── OPUS-MT pipelines (shared GPU memory)
                              ├── TranslateGemma (shared, single instance)
                              ├── Translation memory (shared IndexedDB)
                              └── Model prediction engine (shared patterns)
```

**Benefits**:
- Models loaded ONCE, shared across all tabs (saves 170MB-3.6GB per model per tab)
- Translation cache is instantly shared (translate on one tab, cached for all)
- SharedWorker survives tab closes (persists while any tab is open)
- Eliminates offscreen document lifecycle issues (MV3 service worker suspension)

**Effort**: Medium-High (2 weeks)
**Impact**: Huge UX improvement + massive memory savings
**Feasibility**: 🟢 SharedWorker is shipping in all browsers, Chrome is deprecating offscreen docs

---

### 🚀 MOONSHOT 4: WebNN Hardware Acceleration (NPU Path)

**The Idea**: Use the Web Neural Network API (WebNN) to run translation models on dedicated Neural Processing Units (NPUs) found in modern Intel/Qualcomm/Apple chips. NPUs are 10-50x more power efficient than GPU for ML inference.

**Why Now**: Chrome 134+ has WebNN in Origin Trial. Intel Meteor Lake, Qualcomm Snapdragon X, and Apple M-series all have NPUs. By mid-2026, most new laptops will have NPUs.

**Implementation**:
```typescript
// Detection and tiered execution
const executionTier = await detectBestBackend();
// Priority: NPU (WebNN) > GPU (WebGPU) > CPU (WASM)

if (navigator.ml) {
  // WebNN path - runs on NPU, near-zero battery impact
  const context = await navigator.ml.createContext({ deviceType: 'npu' });
  // Load ONNX model via WebNN
} else if (navigator.gpu) {
  // Existing WebGPU path
} else {
  // WASM fallback
}
```

**Effort**: Medium (1-2 weeks once WebNN ships)
**Impact**: Translation with ~0 battery impact, 10-50x more efficient
**Feasibility**: 🟡 WebNN is Origin Trial, not yet stable

---

### 🚀 MOONSHOT 5: Contextual Translation with Page Semantics

**The Idea**: Instead of translating text nodes independently, analyze the full page semantics first — headings, navigation, article body, sidebar, comments — and translate each with appropriate register and context.

**How**:
1. **Semantic analysis**: Identify page sections (article, nav, footer, comments, ads)
2. **Context injection**: For each translation batch, include surrounding context:
   - Article title as context for body paragraphs
   - Previous paragraph for continuity
   - Section heading for register (formal in article, casual in comments)
3. **Register adaptation**: TranslateGemma prompt engineering per section type
4. **Terminology consistency**: Extract key terms from the page, translate once, enforce across all occurrences

**Example**:
```
// Instead of:
translate("Bank") → "Pankki" (financial institution)
translate("Bank") → "Ranta" (river bank) — wrong on finance page!

// With context:
translate("Bank", context="Financial quarterly report") → "Pankki" (correct both times)
```

**Effort**: Medium (1-2 weeks)
**Impact**: Dramatically better translation quality, especially for ambiguous terms
**Feasibility**: 🟢 TranslateGemma already supports context in prompts

---

### 🚀 MOONSHOT 6: Real-Time Video Subtitle Translation

**The Idea**: Intercept video subtitle tracks (WebVTT, SRT, embedded captions) and translate them in real-time, displayed as translated subtitles overlaid on the video.

**How**:
1. Detect `<track>` elements and TextTrack API cues
2. Hook into `cuechange` events
3. Translate each cue as it appears (pre-translate upcoming cues in buffer)
4. Render translated subtitle overlay via CSS custom element
5. Support: YouTube (auto-captions), Netflix, streaming sites

**Extension for YouTube specifically**:
- YouTube exposes captions via `ytInitialPlayerResponse` or TimedText API
- Pre-fetch full transcript → batch translate → sync to video timeline
- Show dual subtitles (original + translated) for language learners

**Effort**: Medium (1-2 weeks)
**Impact**: High — video is 80% of web content, subtitle translation is garbage everywhere
**Feasibility**: 🟢 TextTrack API is standard, YouTube has accessible captions

---

### 🚀 MOONSHOT 7: LoRA-Based Personal Translation Style

**The Idea**: Let users fine-tune a tiny LoRA adapter (~1-5MB) on their corrections. After enough corrections, the model adapts to the user's preferred style, terminology, and tone.

**How**:
1. User corrections are already tracked (AddCorrection messages exist)
2. After N corrections (e.g., 50+), offer to "train your personal style"
3. Generate training pairs from corrections: (source + machine_translation + user_correction)
4. Train a LoRA adapter for TranslateGemma (4-bit, rank-4, ~1MB)
5. Load adapter at inference time: base model + LoRA merge
6. Result: TranslateGemma that translates in YOUR style

**Why Now**: Transformers.js is adding LoRA adapter support. ONNX Runtime supports LoRA weight merging.

**Effort**: High (3-4 weeks, depends on Transformers.js LoRA readiness)
**Impact**: Revolutionary personalization — no competitor offers this
**Feasibility**: 🔴 Requires training infrastructure and Transformers.js LoRA support

---

### 🚀 MOONSHOT 8: Multilingual OCR + Screenshot Translation

**The Idea**: Point-and-click screenshot translation. User draws a selection rectangle on any part of the screen (including images, canvas, SVG), OCR extracts text, translates it, and overlays the translation.

**Already partially built**: OCRImageMessage type exists, Tesseract.js is integrated.

**Enhancement**:
1. Content script adds "screenshot mode" (crosshair cursor)
2. User draws rectangle over any page element
3. Capture via `html2canvas` or Chrome `captureVisibleTab` API
4. OCR with Tesseract.js (already integrated)
5. Translate extracted text
6. Overlay translated text in-place with matching font/color

**Use cases**: Images with text, canvas-rendered content, PDF viewers, screenshots of apps

**Effort**: Low-Medium (1 week, OCR infrastructure already exists)
**Impact**: Unique capability — translate ANY visual text on screen
**Feasibility**: 🟢 Core tech already integrated

---

---

## FAIL-FAST VALIDATION RESULTS

### Validation Evidence

| # | Moonshot | Riskiest Assumption | Test | Result |
|---|---------|---------------------|------|--------|
| 1 | **PDF Translation** | pdf.js gives text positions | `sessionPdf.js` exists (IndexedDB PDF storage), but NO pdf.js dep in package.json, NO `getTextContent`/`getViewport` calls in src/ | **PIVOT** — Need to add pdf.js. Existing code only stores PDFs as base64 blobs, no text extraction. Core approach valid but requires new dependency. |
| 2 | **Speculative Decoding** | Transformers.js exposes logits from generate() | Checked: `model.generate()` is called with basic params only. No `output_scores`, no `return_dict_in_generate`, no logits access | **PIVOT** — Transformers.js generate() CAN pass `output_scores: true` (it's in the API). Need to verify it works with Gemma3ForCausalLM in ONNX Runtime Web. Feasible but unproven in-browser. |
| 3 | **SharedWorker Migration** | Chrome is deprecating offscreen docs | Checked Chrome docs: **Offscreen API is NOT being deprecated**. SharedWorker is NOT mentioned as alternative. Offscreen can spawn workers. | **KILL original premise. PIVOT to enhancement** — Keep offscreen, add SharedWorker inside it for cross-tab cache sharing. Don't migrate wholesale. |
| 4 | **WebNN NPU** | WebNN API is available in extensions | Zero references to `navigator.ml` or `WebNN` in codebase. WebNN was in Origin Trial Chrome 134, status uncertain for 2026. | **DEFER** — Not yet production-ready. Monitor. Don't invest now. |
| 5 | **Contextual Semantics** | TranslateGemma prompt accepts context | Verified: `formatTranslateGemmaPrompt()` is a template string. Can inject context directly into the prompt. Zero code changes to model loading needed. | **GO** — Lowest risk, highest quality improvement. Just prompt engineering + page analysis. |
| 6 | **Video Subtitles** | Can access TextTrack from content script | Zero `TextTrack`/`webvtt`/`cuechange` references in src/. Standard DOM API, should be accessible from content script. YouTube uses custom player. | **GO with caveat** — Standard TextTrack works. YouTube needs specific extraction (timedtext API or DOM scraping). MVP on standard `<track>` first. |
| 7 | **LoRA Personalization** | Transformers.js supports LoRA adapters | Zero `LoRA`/`lora`/`adapter` references in codebase. Transformers.js LoRA support is experimental/undocumented. | **KILL for now** — Dependency doesn't exist yet. Revisit when Transformers.js ships LoRA. Correction data is already collected (future-ready). |
| 8 | **Screenshot OCR** | Tesseract.js + captureVisibleTab work | `tesseract.js: ^7.0.0` in deps. Zero `captureVisibleTab` references in src/. OCRImageMessage type exists. | **GO** — All building blocks exist. Need to wire captureVisibleTab (requires `activeTab` permission) + Tesseract + translation + overlay. |

### FINAL Validated Priority Matrix (All Spikes Complete)

| # | Moonshot | Verdict | Priority | Key Evidence |
|---|---------|---------|----------|-------------|
| 5 | **Contextual Page Semantics** | **GO** | **P0** | `formatTranslateGemmaPrompt()` is template string. Zero model changes. |
| 8 | **Screenshot OCR Translation** | **GO** | **P0** | tesseract.js v7 in deps, OCRImageMessage typed, just wire it |
| 1 | **PDF Layout-Preserving Translation** | **GO** | **P1** | pdf.js `getTextContent()` returns `{str, transform[6], width, height, fontName}` per span. Overlay approach validated. Need `pdfjs-dist` dep (~2.5MB). |
| 6 | **Video Subtitle Translation** | **GO** | **P1** | TextTrack.cues accessible from content script. YouTube: `.ytp-caption-segment` DOM. MVP: standard `<track>` + YouTube. Netflix/Disney+ deferred (EME). |
| 2 | **Speculative Decoding** | **GO** | **P2** | Transformers.js has `output_scores=false` (default) + `return_dict_in_generate=false` in GenerationConfig. `scores.push` pattern found (8 occurrences). Logits collection IS implemented. Pass `{output_scores: true}` to generate(). |
| 3 | **SharedWorker Migration** | **KILLED** | **--** | Content scripts run in PAGE origin, cannot connect to extension SharedWorker. Service worker already provides cross-tab cache (in-memory Map). Single offscreen doc already shares models across tabs. SharedWorker adds ZERO architectural value. |
| 4 | **WebNN NPU** | **DEFER** | **P3** | Not production-ready. Monitor. |
| 7 | **LoRA Personalization** | **KILLED** | **--** | Transformers.js lacks LoRA support. Correction data already collecting. |

### Kill Report
- **SharedWorker**: Killed because cross-tab sharing already works. Service worker has shared LRU cache. Single offscreen doc shares GPU models. Content scripts can't connect to SharedWorker anyway (wrong origin). Zero value.
- **LoRA**: Killed because dependency doesn't exist. Correction data collecting for future.

## Recommended Execution Order (FINAL — All Validated)

1. **Contextual page semantics** — Zero risk. Prompt engineering only. Immediate quality leap.
2. **Screenshot OCR** — Tesseract.js v7 installed, types exist. Wire captureVisibleTab + OCR + translate + overlay.
3. **PDF translation** — Add pdfjs-dist. Extract text with positions. Canvas overlay. Market differentiator.
4. **Video subtitles** — Standard `<track>` + YouTube `.ytp-caption-segment`. New market.
5. **Speculative decoding** — Pass `output_scores: true` to generate(). OPUS-MT draft + Gemma verify.
6. **WebNN** — When Chrome ships it stable. Architecture ready (just add `'webnn'` to execution tier).

---

*Generated: 2026-02-09 | Based on codebase analysis + bleeding edge tech mapping*
