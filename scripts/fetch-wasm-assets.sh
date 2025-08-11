#!/usr/bin/env bash
set -euo pipefail

# Fetch prebuilt WASM assets for the in-extension PDF rewrite engine.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/src/wasm/vendor"
mkdir -p "$VENDOR_DIR/fonts"

echo "Vendor dir: $VENDOR_DIR"

# 1) MuPDF
echo "Downloading MuPDF..."
curl -L -o "$VENDOR_DIR/mupdf.wasm" https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.wasm
curl -L -o "$VENDOR_DIR/mupdf.engine.js" https://unpkg.com/mupdf@1.26.4/dist/mupdf.js

# 2) HarfBuzz
echo "Downloading HarfBuzz..."
curl -L -o "$VENDOR_DIR/hb.wasm" https://unpkg.com/harfbuzzjs@0.4.8/hb.wasm
curl -L -o "$VENDOR_DIR/hb.js" https://unpkg.com/harfbuzzjs@0.4.8/hb.js

# 3) pdf-lib
echo "Downloading pdf-lib..."
curl -L -o "$VENDOR_DIR/pdf-lib.js" https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js

# 4) Noto Fonts
echo "Downloading Noto Fonts..."
curl -L -o "$VENDOR_DIR/fonts/NotoSans-Regular.ttf" "https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf"
curl -L -o "$VENDOR_DIR/fonts/NotoSans-Bold.ttf" "https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf"

# The icu4x_segmenter is bundled with the extension, so we don't download it.

echo "All assets downloaded successfully."
