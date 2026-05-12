# Transformers.js v4 WebGPU Spike

GitHub issue: [#508](https://github.com/MikkoParkkola/translate-browser-extension/issues/508)

## Current Implementation

- `@huggingface/transformers` is upgraded to the v4 runtime (`^4.2.0`).
- OPUS-MT production defaults remain `wasm + q8`.
- `VITE_OPUS_MT_WEBGPU_PROBE=true` enables an explicit OPUS-MT probe path:
  1. try `webgpu + q8` when browser WebGPU is detected
  2. fall back to `wasm + q8` if the probe load fails
- Both Chrome offscreen and Firefox background paths enable `env.useWasmCache = true`.
- Extension packaging copies the ONNX Runtime `ort-wasm*` loader/runtime files from `onnxruntime-web/dist`, which v4 imports dynamically at runtime.
- `npm run spike:transformers-v4` runs a local measurement harness for model load time, inference time, estimated output tokens/sec, memory delta, and offline cache checks.

## Measurement Harness

Warm/cache smoke:

```bash
npm run spike:transformers-v4 -- --device=cpu
```

Offline follow-up after one successful warm run:

```bash
npm run spike:transformers-v4 -- --device=cpu --offline
```

WebGPU probe:

```bash
npm run spike:transformers-v4 -- --device=webgpu
```

The Node runtime used by the local CLI does not expose `navigator.gpu`, and Transformers.js v4 maps the local Node fallback to `cpu` rather than browser `wasm`. Use the CLI for cache/quality smoke checks; use the production extension probe flag for real browser WebGPU/WASM validation:

```bash
VITE_OPUS_MT_WEBGPU_PROBE=true npm run build
```

Then load `dist/` unpacked and translate a small `en -> de` or `en -> fi` sample.

## GO / KILL Criteria

GO only if all of these hold for representative `en <-> fi` and `en <-> de` samples:

- WebGPU inference loads without corrupting the extension runtime.
- Single-sentence translation completes in less than 2 seconds on a warm model.
- Offline follow-up works after the first model download.
- Output is not degenerate, repetitive, or truncated.
- WASM fallback still succeeds when WebGPU load fails.

KILL or keep probe-only if any of these occur:

- WebGPU output regresses relative to the current WASM path.
- Model load is flaky across browser restarts.
- Browser memory usage is too high for typical extension users.
- Firefox or Safari requires flags or implementation-specific behavior that cannot be made ergonomic.

## Open Browser Matrix

The repeatable harness and probe flag are now in place. Before shipping WebGPU as a default path, run and record:

| Browser | Required check |
| --- | --- |
| Chrome/Edge | Probe build, warm/cold load, offline follow-up, quality sample |
| Firefox | Probe build with WebGPU flag state documented |
| Safari | Probe build or documented unsupported status |

Until that matrix is recorded, OPUS-MT WebGPU remains experimental and disabled by default.

## Local Node Smoke Result

Run on 2026-05-12 with `Xenova/opus-mt-en-de`, `device=cpu`, `dtype=q8`, and input `Hello world. I like apples.`

| Mode | Result |
| --- | --- |
| Cold online | load `37422ms`, inference `116ms`, estimated `60.49 tok/s`, output `Hallo Welt. Ich mag Äpfel.` |
| Offline after cache warm | load `470ms`, inference `136ms`, estimated `51.54 tok/s`, same output |
| WebGPU from Node | blocked because this Node runtime exposes no `navigator.gpu` |
