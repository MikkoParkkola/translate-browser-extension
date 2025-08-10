Building WASM Engine Artifacts

Goal
- Produce browser‑ready WASM artifacts for the in‑extension PDF rewrite engine:
  - MuPDF: `src/wasm/vendor/mupdf.wasm`, `src/wasm/vendor/mupdf.js`
  - ICU4X Segmenter: `src/wasm/vendor/icu4x_segmenter.wasm`, `src/wasm/vendor/icu4x_segmenter.js`

Prerequisites
- Docker (recommended) or local Emscripten SDK + Rust/wasm‑pack
- GitHub Actions optional (CI build)

Quick Local Build (Docker)
1) MuPDF (AGPL)
   - Pull Emscripten SDK image:
     docker pull emscripten/emsdk:latest
   - Clone MuPDF:
     git clone --depth=1 https://github.com/ArtifexSoftware/mupdf.git
   - Enter the repo and build the wasm target (consult MuPDF docs; target names vary by version):
     docker run --rm -v "$PWD":/src -w /src emscripten/emsdk:latest bash -lc "make generate && make wasm"
   - Copy resulting wasm/js artifacts to:
    src/wasm/vendor/mupdf.wasm
     src/wasm/vendor/mupdf.js

2) ICU4X Segmenter (Unicode License)
   - Install Rust toolchain + wasm‑pack OR use a Rust container image.
   - Create a small Rust crate that depends on `icu_segmenter` and exports wasm via wasm‑bindgen:
     functions: `line_break_points(text, locale)` and optional `bidi_levels(text, para_level)`
   - Build for web target:
     wasm-pack build --release --target web
   - Copy artifacts to:
     src/wasm/vendor/icu4x_segmenter.wasm
     src/wasm/vendor/icu4x_segmenter.js

GitHub Actions (CI) Build
- See `.github/workflows/build-wasm.yml` for a reference workflow to:
  - Build MuPDF with emscripten
  - Build ICU4X segmenter with wasm‑pack
  - Upload artifacts or commit vendor files on release/tag

Verification
- Load the extension and open:
  - `src/qa/engine-status.html` for live file presence + sizes
  - Viewer header shows Engine: Ready when all files exist and the wrapper exports rewrite()

Notes
- HarfBuzz (hb.wasm/js) and PDFium (pdfium.wasm/js) are already vendored.
- Fonts: NotoSans Regular/Bold vendored; add more Noto subsets (CJK/Arabic/Indic) as needed for coverage.

