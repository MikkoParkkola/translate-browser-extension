# Translate Extension: WASM → WebGPU Migration

> Historical note: this handoff refers to a removed `localModel` / `llama.cpp` prototype. It is kept for research context only; the shipped local runtime is the offscreen TranslateGemma path.

## Problem
TranslateGemma model loading fails with `RangeError: Array buffer allocation failed` because:
- `llamacpp-worker.js` loads entire GGUF model into single `Uint8Array` (line 23)
- Browser ArrayBuffer limit ~2GB, TranslateGemma Q4 is ~2.5GB
- `llama.cpp.js` is a PLACEHOLDER/mock (not real llama.cpp WASM)
- Service worker dies → "message channel closed" cascade

## Solution: web-llm (WebGPU)
Use https://github.com/nicedayfor/web-llm or https://github.com/nicedayfor/wllama

### Key changes needed:
1. **Replace `src/llama.cpp.js`** (284 lines, mock) → web-llm WebGPU engine
2. **Replace `src/llamacpp-worker.js`** (239 lines) → WebGPU worker with chunked model loading
3. **Update `src/lib/LocalModelManager.js`** (718 lines) → WebGPU model management, sharded downloads
4. **Update `src/localModel.js`** → WebGPU-aware singleton
5. **Update manifest.json** → Add WebGPU permissions if needed

### Architecture:
- `n_gpu_layers: 99` (full GPU offload via WebGPU)
- Sharded GGUF format (split into <500MB chunks for streaming download)
- Progress callback for download UI
- Fallback to WASM CPU if WebGPU unavailable

## Codebase
- Location: `spark:~/translate-browser-extension/`
- Also: `spark:~/transformers.js/` (may have relevant code)
- Build: webpack (`webpack.config.js`)
- Tests: Jest + Playwright (167+ test files)

## Files to modify
- `src/llama.cpp.js` - REPLACE entirely
- `src/llamacpp-worker.js` - REPLACE entirely  
- `src/lib/LocalModelManager.js` - Major refactor
- `src/localModel.js` - Update for WebGPU
- `src/localModelUI.js` - Update download progress for sharded
- `package.json` - Add web-llm dependency
- `src/manifest.json` - Permissions
