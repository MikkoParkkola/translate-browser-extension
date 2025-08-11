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
curl -L -o "$VENDOR_DIR/mupdf-wasm.js" https://unpkg.com/mupdf@1.26.4/dist/mupdf-wasm.js
curl -L -o "$VENDOR_DIR/mupdf.engine.js" https://unpkg.com/mupdf@1.26.4/dist/mupdf.js

# 2) PDFium
echo "Downloading PDFium..."
curl -L -o "$VENDOR_DIR/pdfium.wasm" https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.wasm
curl -L -o "$VENDOR_DIR/pdfium.js" https://unpkg.com/pdfium-wasm@0.0.2/dist/pdfium.js
curl -L -o "$VENDOR_DIR/pdfium.engine.js" https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/pdfium.engine.js

# 3) HarfBuzz
echo "Downloading HarfBuzz..."
curl -L -o "$VENDOR_DIR/hb.wasm" https://unpkg.com/harfbuzzjs@0.4.8/hb.wasm
curl -L -o "$VENDOR_DIR/hb.js" https://unpkg.com/harfbuzzjs@0.4.8/hb.js

# 4) ICU4X segmenter
echo "Downloading ICU4X segmenter..."
curl -L -o "$VENDOR_DIR/icu4x_segmenter.wasm" https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/icu4x_segmenter.wasm
curl -L -o "$VENDOR_DIR/icu4x_segmenter.js" https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/icu4x_segmenter.js

# 5) pdf-lib and wrappers
echo "Downloading pdf-lib and wrappers..."
curl -L -o "$VENDOR_DIR/pdf-lib.js" https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js
curl -L -o "$VENDOR_DIR/overlay.engine.js" https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/overlay.engine.js
curl -L -o "$VENDOR_DIR/simple.engine.js" https://raw.githubusercontent.com/alibaba/Qwen-translator-extension/main/src/wasm/vendor/simple.engine.js

# 6) Noto Fonts
echo "Downloading Noto Fonts..."
curl -L -o "$VENDOR_DIR/fonts/NotoSans-Regular.ttf" "https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf"
curl -L -o "$VENDOR_DIR/fonts/NotoSans-Bold.ttf" "https://fonts.gstatic.com/s/notosans/v39/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf"

echo "All assets downloaded successfully."
