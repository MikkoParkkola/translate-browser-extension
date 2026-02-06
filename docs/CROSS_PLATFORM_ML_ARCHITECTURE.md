# Cross-Platform ML Architecture

## Overview

This project uses a custom quantization format optimized for cross-platform ML inference in browsers.

## Supported Platforms

- Desktop Browser (WebGPU)
- Mobile Browser (WebGPU)
- Apple Silicon (CoreML conversion)
- NVIDIA GPU (TensorRT conversion)
- CPU (SIMD kernels)

## Model Variants

| Variant | Target | Approximate Size |
|---------|--------|------------------|
| Standard | Desktop | ~1.4 GB |
| Fine | Desktop (quality) | ~1.6 GB |
| Nano | Mobile | ~950 MB |
| Pico | Mobile (compact) | ~700 MB |

## Usage

```bash
# Quantize model
python scripts/quantize-gcq.py /path/to/onnx output.gcq

# Load in browser
import { gcqRuntime } from './ml/gcq-runtime';
await gcqRuntime.init();
const model = await gcqRuntime.loadModel('/models/model.gcq');
```

## Files

| File | Purpose |
|------|---------|
| `scripts/quantize-gcq.py` | Model converter |
| `src/ml/gcq-runtime.ts` | WebGPU runtime |

---

*Internal documentation available separately*
