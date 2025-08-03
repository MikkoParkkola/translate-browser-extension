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
  --app-name "Qwen Translator" \
  --bundle-identifier "com.example.qwentranslator.macos" \
  --project-location "$OUT_DIR" \
  --macos-only

# Convert for iOS and iPadOS
xcrun safari-web-extension-converter "$SRC_DIR" \
  --app-name "Qwen Translator" \
  --bundle-identifier "com.example.qwentranslator.ios" \
  --project-location "$OUT_DIR" \
  --ios-only
