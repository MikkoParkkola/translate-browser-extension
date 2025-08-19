#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"
OUT_DIR="$SCRIPT_DIR/../safari"

mkdir -p "$OUT_DIR"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required to build Safari extensions." >&2
  exit 1
fi

# Convert for macOS
xcrun safari-web-extension-converter "$SRC_DIR" \
  --app-name "TRANSLATE! by Mikko" \
  --bundle-identifier "com.example.translatebymikko.macos" \
  --project-location "$OUT_DIR" \
  --macos-only

# Convert for iOS and iPadOS
xcrun safari-web-extension-converter "$SRC_DIR" \
  --app-name "TRANSLATE! by Mikko" \
  --bundle-identifier "com.example.translatebymikko.ios" \
  --project-location "$OUT_DIR" \
  --ios-only

# Ensure vendor WASM assets are copied into each generated extension bundle
find "$OUT_DIR" -type d -name "*Extension" | while read -r extDir; do
  rsync -a "$SRC_DIR/wasm" "$extDir/"
done
