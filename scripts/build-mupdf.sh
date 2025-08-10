#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
WORKDIR=$(mktemp -d)
echo "Using workdir: $WORKDIR"

pushd "$WORKDIR" >/dev/null
git clone --depth=1 https://github.com/ArtifexSoftware/mupdf.git
cd mupdf
echo "Building MuPDF (wasm) via emscripten container..."
docker run --rm -v "$PWD":/src -w /src emscripten/emsdk:latest bash -lc "set -e; apt-get update && apt-get install -y pkg-config python3 nodejs npm brotli; cd platform/wasm; npm install -s; BUILD=small DEFINES='-DTOFU -DTOFU_CJK_EXT -DNO_ICC' FEATURES='brotli=no mujs=no extract=no xps=no svg=no html=no' bash tools/build.sh"

# Copy artifacts from platform/wasm/dist
echo "Copying MuPDF wasm/js artifacts..."
mupd=platform/wasm/dist
if [[ ! -f "$mupd/mupdf-wasm.wasm" || ! -f "$mupd/mupdf-wasm.js" ]]; then
  echo "MuPDF wasm artifacts not found in platform/wasm/dist" >&2
  exit 1
fi
mkdir -p "$ROOT_DIR/src/wasm/vendor"
cp "$mupd/mupdf-wasm.wasm" "$ROOT_DIR/src/wasm/vendor/mupdf-wasm.wasm"
cp "$mupd/mupdf-wasm.js" "$ROOT_DIR/src/wasm/vendor/mupdf.js"
popd >/dev/null
rm -rf "$WORKDIR"
echo "MuPDF artifacts copied to src/wasm/vendor/."
