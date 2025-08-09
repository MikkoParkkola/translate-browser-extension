#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
WORKDIR=$(mktemp -d)
echo "Using workdir: $WORKDIR"

pushd "$WORKDIR" >/dev/null
git clone --depth=1 https://github.com/ArtifexSoftware/mupdf.git
cd mupdf
echo "Building MuPDF (wasm) via emscripten container..."
docker run --rm -v "$PWD":/src -w /src emscripten/emsdk:latest bash -lc "make generate && make wasm -j$(nproc || echo 2)"

# Locate artifacts
echo "Locating MuPDF wasm/js artifacts..."
FOUND_WASM=$(ls -1 **/*.wasm 2>/dev/null | grep -E '/(build|platform)/' | head -n1 || true)
FOUND_JS=$(ls -1 **/*.js 2>/dev/null | grep -E 'mupdf.*\.js$' | head -n1 || true)

if [[ -z "$FOUND_WASM" || -z "$FOUND_JS" ]]; then
  echo "Failed to locate MuPDF wasm/js artifacts." >&2
  exit 1
fi

echo "Found wasm: $FOUND_WASM"
echo "Found js:   $FOUND_JS"

mkdir -p "$ROOT_DIR/src/wasm/vendor"
cp "$FOUND_WASM" "$ROOT_DIR/src/wasm/vendor/mupdf.wasm"
cp "$FOUND_JS" "$ROOT_DIR/src/wasm/vendor/mupdf.js"
popd >/dev/null
rm -rf "$WORKDIR"
echo "MuPDF artifacts copied to src/wasm/vendor/."

