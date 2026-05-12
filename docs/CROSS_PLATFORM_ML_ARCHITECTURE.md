# Cross-Platform ML Architecture

Review ticket: MIK-3341
Last reviewed: 2026-05-12

## Overview

TRANSLATE! uses browser-first local inference paths. The shipped architecture is
not a single universal model binary; it is a provider matrix that chooses the
most reliable runtime per browser.

Current shipped local paths:

- `chrome-builtin`: Chrome-managed native translation when Chrome exposes the
  Translator API.
- `opus-mt`: stable downloaded local baseline through `@huggingface/transformers`
  and WebAssembly.
- `translategemma`: experimental downloaded model path through
  `@huggingface/transformers`, WebGPU, or WebNN.

The GCQ files in `src/ml/gcq-runtime.ts` and `scripts/quantize-gcq.py` remain a
research runtime. They are useful for WebGPU quantization experiments, but they
are not the canonical shipped translation path.

## Source Data Checked

- MDN WebGPU API, last modified 2026-05-05:
  https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- Can I Use WebGPU support table, usage data for April 2026:
  https://caniuse.com/webgpu
- web.dev WebGPU browser availability note, last updated 2025-11-25:
  https://web.dev/blog/webgpu-supported-major-browsers
- Web platform features explorer for fixed-width WebAssembly SIMD:
  https://web-platform-dx.github.io/web-features-explorer/features/wasm-simd/
- Chrome Translator API documentation:
  https://developer.chrome.com/docs/ai/translator-api
- WebNN browser compatibility reference:
  https://webnn.io/en/api-reference/browser-compatibility/api

## Platform Runtime Matrix

| Platform | Supported runtime decision | Current support signal | Architecture action |
| --- | --- | --- | --- |
| Chrome desktop / Chromium desktop | Prefer `chrome-builtin` when available, then `opus-mt` WASM, then experimental `translategemma` WebGPU/WebNN. | Chrome WebGPU is supported from Chrome 113 on desktop-class platforms. Chrome's Translator API is documented for Chrome 138+ desktop and not mobile. | Keep as the primary local-first path. Continue feature detection for `chrome-builtin`, WebGPU, and WebNN. |
| Firefox desktop | Use `opus-mt` WASM as stable baseline. Treat WebGPU as feature-detected experimental capability. | MDN marks WebGPU as limited availability. Public support tables remain mixed by OS/version, with Firefox support still not safe to assume across every target. | Do not make Firefox WebGPU a default requirement. Keep Firefox on WASM unless capability checks pass. |
| Safari desktop / iOS Safari | Treat Safari WebGPU as possible but not a required deployment baseline. | Can I Use reports Safari 26.x WebGPU as partial on desktop Safari, while iOS Safari 26.x is supported. | Do not use Safari as the primary proof point for GCQ or TranslateGemma until a Safari extension target exists and is tested. |
| Chrome Android | Use mobile WebGPU only behind feature detection. | Chrome Android WebGPU support exists on current versions, but Chrome's Translator API docs say Language Detector and Translator APIs work on desktop and not mobile. | Do not list mobile browser WebGPU as broadly supported for translation. Require fallback to `opus-mt` or cloud. |
| Firefox Android | Do not require WebGPU. | Current support tables list Firefox Android WebGPU as disabled by default. | Keep mobile Firefox out of the WebGPU target set for now. |
| WebAssembly CPU fallback | `opus-mt` remains the safe baseline. | Fixed-width WebAssembly SIMD is Baseline Widely Available, with Chrome 91, Firefox 89, and Safari 16.4 support points listed by Web Platform DX. | Keep `opus-mt` WASM as the stable offline fallback. |
| WebNN | Experimental accelerator for `translategemma`, mostly Chromium-based. | WebNN compatibility references Chromium-based browsers and platform-specific backends such as Core ML on macOS Apple Silicon and Windows ML on Windows 11 24H2+. | Keep WebNN as opportunistic acceleration, not a cross-browser requirement. |
| Native Apple Silicon | Not a browser-extension runtime by itself. | Core ML is available through native platform APIs and through Chromium WebNN backend paths, but the extension does not ship a Core ML model bundle or native helper. | Any Core ML path needs a separate native-helper or Safari-specific architecture decision. |
| NVIDIA GPU / TensorRT | Out of scope for shipped browser extension runtime. | TensorRT is a native/server runtime, not a WebExtension runtime. | Keep for offline conversion or server benchmarking only. |

## Revised Platform Decisions

### Desktop Browser

Desktop Chromium remains the strongest browser-local ML target because it has
the most mature combination of:

- Chrome built-in translation for Chrome 138+.
- WebGPU support on desktop-class Chromium versions.
- WebNN experimentation in Chromium-based browsers.
- WebAssembly SIMD fallback for OPUS-MT.

Firefox desktop must stay feature-detected. Even where WebGPU is available on a
given Firefox/OS combination, the extension cannot assume it for every Firefox
installation. Firefox support therefore remains:

1. `opus-mt` WASM baseline.
2. WebGPU/WebNN only when runtime checks succeed.
3. Cloud provider fallback when configured by the user.

### Mobile Browser

The previous `Mobile Browser (WebGPU)` line was too broad. Mobile WebGPU is not
a uniform deployment target:

- Chrome Android can support WebGPU on current devices, but hardware and OS
  constraints still matter.
- Firefox Android is not a WebGPU baseline.
- Chrome built-in Translator API is documented for desktop, not mobile.
- iOS Safari has WebGPU support in Safari 26.x, but this repo does not currently
  ship or test a Safari extension target.

Mobile architecture should therefore be stated as `feature-detected WebGPU with
non-GPU fallback`, not `WebGPU` as a platform guarantee.

### Apple Silicon

Apple Silicon should be treated as two separate paths:

- Browser path: Chromium WebNN/Core ML backend if the browser exposes it and the
  model format is compatible.
- Native path: Core ML or MLX through a native helper or separate app.

The browser extension does not currently have a native Core ML model conversion
or execution path. Any claim that Apple Silicon is supported through Core ML
needs a follow-up architecture issue before implementation.

### CPU

CPU remains viable for the stable OPUS-MT path because WebAssembly SIMD is
widely available. It is not viable as a default path for very large models such
as TranslateGemma because the current implementation rejects TranslateGemma when
neither WebGPU nor WebNN is available.

## Model Variants

The GCQ variants are research artifacts, not shipped provider guarantees.

| Variant | Intended target | Current status |
| --- | --- | --- |
| Standard | Desktop WebGPU research | Requires browser WebGPU and GCQ model artifact validation. |
| Fine | Desktop quality research | Requires quality and memory validation before user-facing claims. |
| Nano | Mobile research | Do not treat as mobile-supported until tested on Chrome Android and iOS Safari targets. |
| Pico | Compact mobile research | Same mobile caveat as Nano. |

## Usage

GCQ research usage:

```bash
# Quantize model
python scripts/quantize-gcq.py /path/to/onnx output.gcq
```

```ts
// Load in a browser context with WebGPU support.
import { gcqRuntime } from './ml/gcq-runtime';

await gcqRuntime.init();
const model = await gcqRuntime.loadModel('/models/model.gcq');
```

Production provider usage should continue to use the canonical provider paths
documented in `docs/PROVIDERS.md` and `docs/ARCHITECTURE.md`.

## Files

| File | Purpose | Status |
| --- | --- | --- |
| `scripts/quantize-gcq.py` | GCQ model converter | Research |
| `src/ml/gcq-runtime.ts` | WebGPU GCQ runtime | Research |
| `src/offscreen/translategemma.ts` | TranslateGemma browser runtime | Experimental shipped path |
| `src/providers/opus-mt-local.ts` | OPUS-MT browser runtime | Stable shipped path |
| `src/shared/provider-options.ts` | Provider/runtime metadata | Canonical UI/background metadata |

## Follow-Up

This review changes the architecture wording for two decisions:

1. `Mobile Browser (WebGPU)` is no longer a platform guarantee. It is a
   feature-detected candidate with required fallback.
2. `Apple Silicon (CoreML conversion)` is not part of the browser extension
   runtime unless implemented through WebNN or a native helper.

Follow-up issue: MIK-3467 defines whether GCQ should remain a browser-only
research path or become a native-helper architecture with explicit Core ML /
TensorRT targets.
