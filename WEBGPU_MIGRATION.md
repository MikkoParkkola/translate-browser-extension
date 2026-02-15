# WebGPU Migration: Complete

## Model Hosting

Sharded GGUF hosted at: https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded
- 6 shards, Q4_K_M quantization
- Total size: 2.32 GB
- Source: `/home/mikko/models/translategemma-4b-q4km.gguf` split with `llama-gguf-split --split-max-size 500M`

## Problem (SOLVED)
TranslateGemma model loading failed with `RangeError: Array buffer allocation failed` because
the old `llamacpp-worker.js` loaded the entire GGUF model into a single `Uint8Array` (~2.5GB),
exceeding the browser's ~2GB ArrayBuffer limit.

## Solution: @wllama/wllama v2.3.7

Replaced the mock llama.cpp WASM interface with **wllama** -- a real WebAssembly binding for
llama.cpp that supports:

- **Chunked/sharded model loading** -- no single large ArrayBuffer
- **WebGPU acceleration** with automatic WASM CPU fallback
- **Built-in Cache API caching** -- models cached per-shard in browser
- **Parallel shard downloads** (configurable, default 3)
- **Zero dependencies** (11MB package)

## Architecture

```
                Extension
                   |
         localModel.js (singleton)
                   |
      lib/LocalModelManager.js (API surface)
                   |
         llamacpp-worker.js (Web Worker)
                   |
            llama.cpp.js (InferenceEngine wrapper)
                   |
          wllama.bundle.js (@wllama/wllama ESM bundle)
                   |
      +------------+------------+
      |                         |
wllama-single.wasm      wllama-multi.wasm
(single-thread)         (multi-thread)
```

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/llama.cpp.js` | REPLACED | InferenceEngine wrapping wllama |
| `src/llamacpp-worker.js` | REPLACED | Worker using InferenceEngine |
| `src/lib/LocalModelManager.js` | REFACTORED | URL-based sharded loading, wllama cache |
| `src/localModel.js` | UPDATED | Singleton with wllama backend |
| `src/localModelUI.js` | UPDATED | Shard-aware download progress UI |
| `src/manifest.json` | UPDATED | Added wllama assets, HuggingFace CSP |
| `src/wllama.bundle.js` | NEW | @wllama/wllama ESM bundle (from node_modules) |
| `src/wllama-single.wasm` | NEW | Single-thread WASM binary |
| `src/wllama-multi.wasm` | NEW | Multi-thread WASM binary |
| `package.json` | UPDATED | Added @wllama/wllama dependency |
| `scripts/fetch-wasm-assets.sh` | UPDATED | Copies wllama assets on install |

## Key Design Decisions

1. **wllama over web-llm**: Zero deps, native GGUF, smaller package, simpler API for completion
2. **Sharded GGUF**: Model split into <500MB chunks, wllama handles reassembly
3. **Worker-based inference**: All model ops in Web Worker, UI thread stays responsive
4. **URL-based loading**: wllama downloads and caches shards via Cache API
5. **Same API surface**: LocalModelManager exposes same methods as before

## Model URLs

Model shards are loaded from HuggingFace. Update URLs in `LocalModelManager.js`:

```js
const DEFAULT_MODEL_CONFIG = {
  modelUrls: [
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00001-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00002-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00003-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00004-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00005-of-00006.gguf',
    'https://huggingface.co/m1cc0z/translategemma-4b-q4km-sharded/resolve/main/translategemma-4b-q4km-00006-of-00006.gguf',
  ],
};
```

## CSP Changes

Added to `manifest.json` content_security_policy connect-src:
- `https://huggingface.co`
- `https://*.huggingface.co`
- `https://*.hf.co` (CDN redirect domain)

Added to host_permissions:
- `https://huggingface.co/*`
- `https://*.hf.co/*`
