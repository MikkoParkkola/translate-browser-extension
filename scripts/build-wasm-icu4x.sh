#!/usr/bin/env bash
set -euo pipefail

# Build ICU4X segmenter (WASM) for line breaking/BiDi.
# Requirements:
# - Rust + wasm-pack (or cargo + wasm32-unknown-unknown target)
# - ICU4X sources (unicode-org/icu4x)
# - Docker optional
#
# Output:
# - src/wasm/vendor/icu4x_segmenter.wasm
# - src/wasm/vendor/icu4x_segmenter.js

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/src/wasm/vendor"
mkdir -p "$VENDOR_DIR"

echo "This script documents how to build a minimal ICU4X segmenter WASM shim."
echo "Use ICU4X crates (icu_segmenter) and expose a tiny JS/WASM API for UAX#14 + BiDi."

cat <<'EOS'
Suggested steps:
1) git clone https://github.com/unicode-org/icu4x.git
2) Create a small Rust crate that depends on icu_segmenter and exposes WASM bindings:
   - Use wasm-bindgen or wasm-pack to export functions like:
     fn line_break_points(text: &str, locale: &str) -> Vec<usize>
     fn bidi_levels(text: &str, para_level: u8) -> Vec<u8>
3) Build with wasm-pack:
   wasm-pack build --release --target web
4) Copy the generated wasm/js into src/wasm/vendor/ as icu4x_segmenter.wasm/js
EOS

echo "Build guidance printed. Please follow steps to produce icu4x_segmenter.wasm/js."

