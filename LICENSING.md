Licensing Overview

Short version
- This extension is now licensed under AGPL-3.0-or-later to allow bundling MuPDF (AGPL) and related WASM components for true in-extension PDF text rewriting.

Why AGPL?
- MuPDF is AGPL-licensed. When we distribute its binaries (WASM) with our extension, the overall distribution must comply with AGPL. AGPL ensures full source availability of the combined work.

What about other engines?
- PDFium is BSD-licensed and can be used instead of MuPDF. If we later switch to a BSD-only stack, we can revisit the project’s license. For now, AGPL guarantees compliance when MuPDF is present.

Source availability
- This repository contains all source code necessary to build and run the extension. Vendor WASM blobs are included under `src/wasm/vendor/` and originate from upstream projects listed in `src/wasm/vendor/README.md`.

Third-party notices
- MuPDF: AGPL-3.0-or-later
- HarfBuzz: Old MIT
- ICU4X: Unicode License
- Noto Fonts: SIL Open Font License (OFL)

If you redistribute this extension, ensure that the above third-party licenses are included and that you comply with AGPL terms (including offering source code for your distribution).

