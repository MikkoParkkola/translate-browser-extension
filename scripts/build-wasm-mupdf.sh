#!/usr/bin/env bash
set -euo pipefail

# Build MuPDF (WASM) suitable for browser use via Emscripten.
# Requirements:
# - Docker (recommended) or local Emscripten SDK
# - Git
#
# Output:
# - src/wasm/vendor/mupdf-wasm.wasm
# - src/wasm/vendor/mupdf-wasm.js (loader wrapper you may provide or adapt)
#
# Note: MuPDF is AGPL-licensed; ensure compliance when distributing.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/src/wasm/vendor"
mkdir -p "$VENDOR_DIR"

echo "This script outlines building MuPDF WASM with Emscripten."
echo "For a turnkey build, use the official MuPDF build instructions with EMSDK."
echo "Artifacts should be copied to: $VENDOR_DIR/mupdf-wasm.wasm and $VENDOR_DIR/mupdf-wasm.js"

cat <<'EOS'
Suggested steps:
1) Install EMSDK (or use Docker with emscripten/emsdk image)
2) Clone MuPDF:
   git clone --depth=1 https://github.com/ArtifexSoftware/mupdf.git
3) Build WASM target (see MuPDF docs; enable wasm/js target):
   make generate
   # then build wasm target per upstream instructions (varies by version)
4) Copy the resulting wasm/js artifacts into src/wasm/vendor/ as mupdf-wasm.wasm and mupdf-wasm.js (also duplicate the wasm file as mupdf.wasm for compatibility)
5) Ensure that src/wasm/vendor/mupdf-wasm.js implements init({baseURL}) and rewrite(buffer,cfg,onProgress)
EOS

echo "Build guidance printed. Please follow steps to produce mupdf-wasm.wasm/js."

