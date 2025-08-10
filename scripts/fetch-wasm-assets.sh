#!/usr/bin/env bash
set -euo pipefail

# Fetch prebuilt WASM assets for the in-extension PDF rewrite engine.
# This script documents recommended sources; update URLs to specific releases as needed.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/src/wasm/vendor"
mkdir -p "$VENDOR_DIR/fonts"

echo "Vendor dir: $VENDOR_DIR"

echo "NOTE: Update the URLs below to exact release artifacts you trust."

# 1) MuPDF (AGPL) — engine (example placeholder URL; replace with actual release)
# curl -L -o "$VENDOR_DIR/mupdf-wasm.wasm" https://example.com/mupdf/mupdf-wasm.wasm
# curl -L -o "$VENDOR_DIR/mupdf.js" https://example.com/mupdf/mupdf.js

# 2) HarfBuzz (MIT) — text shaping (placeholder URLs)
# curl -L -o "$VENDOR_DIR/harfbuzz.wasm" https://example.com/harfbuzz/harfbuzz.wasm
# curl -L -o "$VENDOR_DIR/harfbuzz.js" https://example.com/harfbuzz/harfbuzz.js

# 3) ICU4X Segmenter (Unicode) — line breaking/BiDi (placeholder URLs)
# curl -L -o "$VENDOR_DIR/icu4x_segmenter.wasm" https://example.com/icu4x/segmenter.wasm
# curl -L -o "$VENDOR_DIR/icu4x_segmenter.js" https://example.com/icu4x/segmenter.js

# 4) Noto Fonts (OFL) — minimal subsets
# curl -L -o "$VENDOR_DIR/fonts/NotoSans-Regular.ttf" https://noto-website-2.storage.googleapis.com/pkgs/NotoSans-unhinted.zip

echo "Downloaded placeholders. Replace placeholder URLs with real ones and rerun."

