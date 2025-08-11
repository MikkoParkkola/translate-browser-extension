WASM Vendor Assets

Place the following prebuilt assets in this folder to enable true PDF text rewriting in the extension:

Required
 - MuPDF or PDFium (WASM build)
  - mupdf-wasm.js with mupdf-wasm.wasm (copy to mupdf.wasm locally if compatibility is required; repository omits the duplicate)
  - or pdfium.js with pdfium.wasm
- HarfBuzz (WASM) for text shaping
  - hb.js, hb.wasm (from harfbuzzjs releases)
- ICU4X Segmenter (WASM) for line breaking and BiDi
  - icu4x_segmenter.js, icu4x_segmenter.wasm
- Fonts (Noto subsets), e.g.:
  - fonts/NotoSans-Regular.ttf
  - fonts/NotoSans-Bold.ttf
  - fonts/NotoSerif-Regular.ttf
  - fonts/NotoSansCJK-Regular.otf (optional large)
  - fonts/NotoNaskhArabic-Regular.ttf (optional)
  - fonts/NotoSansDevanagari-Regular.ttf (optional)

Engine wrapper API (expected by engine.js)
- File: mupdf.engine.js must export an async `init({ baseURL })` returning an object with:
  - async rewrite(buffer, cfg, onProgress): Promise<Blob>
    - buffer: ArrayBuffer of the input PDF
    - cfg: { targetLanguage, sourceLanguage, debug, ... }
    - onProgress: fn({ phase: 'rewrite'|'shape'|'embed'|'write', page, total })
    - returns a Blob of the rewritten PDF

Notes
- baseURL is the URL to this vendor folder; use it to locate .wasm files and font assets.
- The wrapper may itself load harfbuzz/icu4x/font files as needed.
- Keep asset sizes minimal; load fonts lazily by script detection where possible.
