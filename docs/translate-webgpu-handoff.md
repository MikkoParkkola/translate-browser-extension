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
