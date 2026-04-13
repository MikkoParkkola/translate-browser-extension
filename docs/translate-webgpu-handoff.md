# OPUS-MT WebGPU Spike

## Scope

- Upgrade `@huggingface/transformers` to the v4 runtime.
- Keep OPUS-MT on the current safe default: `wasm + q8`, but retry `wasm + fp32` after q8 load failures to isolate quantization-only regressions.
- Allow explicit WebGPU probing behind `VITE_OPUS_MT_WEBGPU_PROBE=true`.

## What this spike changes

- Chrome offscreen OPUS-MT path uses the same runtime policy as Firefox.
- Firefox background OPUS-MT path now also defaults to `wasm + q8`.
- Shared OPUS-MT runtime selection keeps q8 fixed, only opts into WebGPU when the probe flag is enabled and support is detected, and now retries `wasm + fp32` after q8 load failures for diagnosis.
- Transformers.js v4 enables `env.useWasmCache = true` so compiled WASM artifacts can be reused between loads.
- The Vite build now patches the published `transformers.web.js` bundle so a failed browser-side ONNX session load does not poison later fallback attempts in the same extension context.
- Extension packaging now copies the ONNX Runtime `ort-wasm*` loader/runtime files from `onnxruntime-web/dist`, which v4 imports dynamically at runtime.
- Probe builds now log OPUS-MT input/output sentence counts and head/tail excerpts so two-sentence truncation is easier to reproduce and compare across runtimes.

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
- the first retry investigation found an upstream Transformers.js v4 web-bundle bug: after one failed ONNX session load, `webInitChain` stays rejected and later fallback attempts inherit the same failure instead of starting a fresh load
- after patching that published web bundle during the Vite build, the same Chrome offscreen probe succeeded via the intended `wasm + fp32` fallback (`Hello world. I like apples. This is a test.` → `Hallo Welt. Ich mag Äpfel. Dies ist ein Test.`)
- a normal extension-page `type: 'translate'` request now also succeeds on the same build in about 50s cold, which confirms the workaround is active on the user-facing Chrome background/offscreen path as well

Current recommendation: keep this PR draft until the WebGPU truncation issue is understood well enough to decide whether v4 can ship with the new `q8 -> fp32` fallback path and its current cold-start cost.
