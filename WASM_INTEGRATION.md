WASM Text-Rewrite Integration Plan

Goal
- Replace text objects in PDFs inside the extension using a WASM engine (MuPDF/PDFium) with HarfBuzz + ICU4X and embedded Noto fonts. Fully language‑agnostic, vector‑accurate, selectable text.

Artifacts to vendor under src/wasm/vendor/
- Engine: mupdf.js + mupdf.wasm (or pdfium.js + pdfium.wasm)
- Shaping: harfbuzz.js + harfbuzz.wasm
- Line breaking/BiDi: icu4x_segmenter.js + icu4x_segmenter.wasm
- Fonts: Noto subsets in fonts/ (regular + bold at minimum; CJK/Arabic/Indic optional, loaded lazily)

Expected wrapper API
- import baseURL from engine.js; implement and export:
  - async function init({ baseURL }) -> engine
  - engine.rewrite(buffer, cfg, onProgress) -> Blob
    - Parse PDF → extract text runs/regions → translate (batched) → shape (HarfBuzz) → break lines (ICU4X) → rewrite content streams → embed fonts → emit ToUnicode → produce new PDF.

Integration points
- src/wasm/engine.js: loader; checks vendor presence; exposes rewritePdf()
- src/wasm/pipeline.js: prefers WASM when cfg.useWasmEngine=true and vendor present; otherwise falls back to overlay pipeline (temporary)
- src/pdfViewer.html: toggles to enable WASM and auto‑open after save
- src/pdfViewer.js: progress overlay and download/open wiring

Testing
- Use src/qa/compare.html to render original vs translated and inspect diffs
- Manual checks: selection/search, headings, TOC, multi‑column pages

Performance
- Load WASM/assets lazily on first use
- Translate in large chunks with safety caps; reuse cache
- Shape per script; cache shaped glyph runs per font/language

