#!/usr/bin/env bash
set -euo pipefail

# Fetch prebuilt WASM assets for the in-extension PDF rewrite engine.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/src/wasm/vendor"
mkdir -p "$VENDOR_DIR/fonts"

echo "Vendor dir: $VENDOR_DIR"

# 1) MuPDF
echo "Downloading MuPDF..."
curl -L -o "$VENDOR_DIR/mupdf-wasm.wasm" https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.wasm
# Some upstream wrappers still look for mupdf.wasm; provide both names.
cp "$VENDOR_DIR/mupdf-wasm.wasm" "$VENDOR_DIR/mupdf.wasm"
curl -L -o "$VENDOR_DIR/mupdf-wasm.js" https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.js
curl -L -o "$VENDOR_DIR/mupdf.engine.js" https://unpkg.com/mupdf@1.26.4/dist/mupdf.js

# 2) PDFium
echo "Downloading PDFium..."
curl -L -o "$VENDOR_DIR/pdfium.wasm" https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.wasm
curl -L -o "$VENDOR_DIR/pdfium.js" https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.js

# 3) HarfBuzz
echo "Downloading HarfBuzz..."
curl -L -o "$VENDOR_DIR/hb.wasm" https://unpkg.com/harfbuzzjs@0.4.8/hb.wasm
curl -L -o "$VENDOR_DIR/hb.js" https://unpkg.com/harfbuzzjs@0.4.8/hb.js

# 4) ICU4X segmenter
echo "Downloading ICU4X segmenter..."
# Prebuilt ICU4X segmenter shipped with repository; no download needed

# 5) pdf-lib and wrappers
echo "Downloading pdf-lib and wrappers..."
curl -L -o "$VENDOR_DIR/pdf-lib.js" https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js
# Overlay and simple engine wrappers are included in the repository

# 6) Noto Fonts
echo "Downloading Noto Fonts..."
curl -L -o "$VENDOR_DIR/fonts/NotoSans-Regular.ttf" "https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf"
curl -L -o "$VENDOR_DIR/fonts/NotoSans-Bold.ttf" "https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf"

echo "All assets downloaded successfully."

# 7) wllama WASM binaries (for local model inference)
echo "Copying wllama WASM assets..."
WLLAMA_DIR="$ROOT_DIR/node_modules/@wllama/wllama/esm"
if [ -d "$WLLAMA_DIR" ]; then
  cp "$WLLAMA_DIR/single-thread/wllama.wasm" "$ROOT_DIR/src/wllama-single.wasm"
  cp "$WLLAMA_DIR/multi-thread/wllama.wasm" "$ROOT_DIR/src/wllama-multi.wasm"
  cp "$WLLAMA_DIR/index.min.js" "$ROOT_DIR/src/wllama.bundle.js"
  echo "wllama assets copied."
else
  echo "WARNING: wllama not found in node_modules. Run 'npm install' first."
fi
