# Ternary Bonsai 4B Evaluation

GitHub issue: #511
Date: 2026-05-12
Result: NO-GO for direct replacement of the current in-browser translation model.

## Scope

Issue #511 asked whether PrismML Ternary Bonsai 4B can replace the current WebGPU
translation model. The target gates were translation quality parity, browser
WebGPU throughput, GPU-process memory, cold-start time, and an explicit ship or
document-gaps decision.

This evaluation stops at the runtime-fit gate because the available public
artifacts do not match the extension's current browser model runtime.

## Sources Checked

- PrismML announcement: https://prismml.com/news/ternary-bonsai
- MLX artifact: https://huggingface.co/prism-ml/Ternary-Bonsai-4B-mlx-2bit
- GGUF artifact: https://huggingface.co/prism-ml/Ternary-Bonsai-4B-gguf
- Demo repository: https://github.com/PrismML-Eng/Bonsai-demo

## Current Extension Runtime

The shipped local paths are browser-first:

- `opus-mt` runs through the Chrome offscreen document or Firefox background
  page using `@huggingface/transformers`.
- `translategemma` is an experimental `@huggingface/transformers` path that
  loads `m1cc0z/translategemma-4b-it-onnx-q4-webgpu` through direct model and
  tokenizer APIs.
- `chrome-builtin` uses Chrome's native page translation APIs when available.

The extension does not currently embed native `llama.cpp`, MLX, or a GGUF
runtime. Those surfaces were previously removed from shipped entry points.

## Artifact Fit

| Artifact | Runtime | Size claim | Extension fit |
| --- | --- | --- | --- |
| `prism-ml/Ternary-Bonsai-4B-mlx-2bit` | MLX / MLX Swift | 1.05 GiB packed 2-bit | Not loadable by the browser extension. It targets Apple MLX runtimes, not `@huggingface/transformers` WebGPU or WebNN. |
| `prism-ml/Ternary-Bonsai-4B-gguf` | GGUF Q2_0 | 1,020 MiB packed Q2_0 | Not loadable by the browser extension. The model card says Q2_0 requires PrismML's `llama.cpp` fork and is not yet mainline `llama.cpp`. |
| `prism-ml/Ternary-Bonsai-4B-unpacked` | FP16 base artifact | 8.04 GB FP16 lineage | Too large for the current browser-local path and not the claimed low-memory ternary deployment artifact. |

## Gate Status

| Issue #511 gate | Status | Reason |
| --- | --- | --- |
| Run through the current translation test harness | Blocked before benchmark | There is no `@huggingface/transformers` ONNX/WebGPU artifact or provider adapter for Ternary Bonsai 4B. |
| BLEU / chrF / COMET vs current custom 4B | Blocked before benchmark | A CLI benchmark through MLX or `llama.cpp` would measure a native helper path, not the shipped browser extension path. |
| WebGPU tokens/sec in Chrome, Edge, and Firefox | Blocked before benchmark | The public artifacts target MLX or GGUF Q2_0. No browser WebGPU kernel/runtime is available in this repo. |
| GPU-process peak memory <= 1.5 GB | Blocked before benchmark | The packed artifact is near the size target, but browser GPU memory cannot be measured without a browser-loadable runtime. |
| Cold-start extension install to first translation <= 5s | Blocked before benchmark | There is no extension-loadable artifact, and the current model acquisition/runtime path is different. |
| Decision gate | NO-GO | Do not ship Ternary Bonsai 4B as a v5.0 replacement without a browser-compatible runtime. |

## Decision

Do not replace TranslateGemma or OPUS-MT with Ternary Bonsai 4B in the current
extension architecture.

The model may still be worth tracking, but only behind a separate runtime
decision. Any follow-up should choose one of these paths explicitly:

1. Browser-native path: wait for or build a `@huggingface/transformers`,
   ONNX Runtime Web, WebLLM, or MLC-compatible artifact with ternary kernels.
2. Native-helper path: introduce a companion process or native messaging host
   around PrismML's `llama.cpp` fork or MLX. This is a product and security
   architecture change, not a direct model swap.
3. Offline CLI-only benchmark: benchmark the GGUF or MLX model as research
   evidence, while keeping it separate from the shipped extension readiness
   decision.

## Benchmark Handoff If Runtime Fit Changes

If a browser-compatible artifact appears, run the same gates as #511:

1. Add a provider adapter that can load the artifact from the extension
   offscreen or Firefox background runtime.
2. Run the 5,038-test translation harness and require at least 95 percent
   parity.
3. Compare BLEU, chrF, and COMET against the current custom 4B on a held-out
   FLORES-200 subset.
4. Measure Chrome, Edge, and Firefox WebGPU throughput with a target of at
   least 30 tokens/sec.
5. Measure browser GPU-process peak memory with a target of at most 1.5 GB.
6. Measure install-to-first-translation cold start with a target of at most 5s.

Until those prerequisites are true, treating Ternary Bonsai 4B as a shipped
replacement would create a runtime mismatch rather than a validated
optimization.
