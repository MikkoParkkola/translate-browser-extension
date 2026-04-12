# OPUS-MT WebGPU Spike

## Scope

- Upgrade `@huggingface/transformers` to the v4 runtime.
- Keep OPUS-MT on the current safe default: `wasm + q8`.
- Allow explicit WebGPU probing behind `VITE_OPUS_MT_WEBGPU_PROBE=true`.

## What this spike changes

- Chrome offscreen OPUS-MT path uses the same runtime policy as Firefox.
- Firefox background OPUS-MT path now also defaults to `wasm + q8`.
- Shared OPUS-MT runtime selection keeps q8 fixed and only opts into WebGPU when the probe flag is enabled and support is detected.
- Transformers.js v4 enables `env.useWasmCache = true` so compiled WASM artifacts can be reused between loads.
- Extension packaging now copies the ONNX Runtime `ort-wasm*` loader/runtime files from `onnxruntime-web/dist`, which v4 imports dynamically at runtime.

## Probe contract

Set `VITE_OPUS_MT_WEBGPU_PROBE=true` only for manual evaluation builds.

- `false` or unset: force `wasm + q8`
- `true`: try `webgpu + q8` when supported, otherwise stay on `wasm + q8`

## Manual GO / KILL checklist

GO only if all of the following hold for a representative pair such as `en ↔ fi`:

1. output is not degenerate or repetitive
2. first load completes within the existing OPUS-MT timeout budget
3. warm runs remain stable across repeated translations

KILL the WebGPU path if output regresses, model load becomes flaky, or the runtime still falls back unpredictably.

## Current browser findings

Observed on this macOS machine in Chromium with a real extension build:

- `checkWebGPU` reports `supported=true` and `fp16=true`
- probe-enabled build (`VITE_OPUS_MT_WEBGPU_PROBE=true`) now loads and translates after the packaging fix
- first probe translation took about 79s cold, and a same-session offline follow-up completed in about 0.5s
- the probe output quality is not yet trustworthy enough to ship by default: a two-sentence input returned only the second translated sentence
- the default v4 `wasm + q8` path is currently not safe on this machine: ONNX Runtime session creation fails with `Missing required scale: model.shared.weight_merged_0_scale`

Current recommendation: keep this PR draft and do not enable v4 OPUS-MT by default until the WASM regression and WebGPU quality issue are both explained.
