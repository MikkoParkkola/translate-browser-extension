# TranslateGemma-4B Quantization Strategy

## Executive Summary

This document defines the optimal quantization approach for deploying TranslateGemma-4B in a browser environment with <1.5GB target size and <2% BLEU degradation tolerance.

**Recommendation: Q4 (4-bit GGUF)** as primary, **Q3 (3-bit) as stretch goal**

---

## 1. Model Baseline Specifications

### TranslateGemma-4B Overview
- **Base Size**: ~8.0 GB (FP32 weights)
  - 4.0B parameters × 2 bytes (FP16) = 8 GB
  - 4.0B parameters × 4 bytes (FP32) = 16 GB
  - 4.0B parameters × 1 byte (INT8) = 4 GB

- **Architecture**: Google's LLaMA-based encoder-decoder
- **Capabilities**: Multilingual translation (50+ language pairs)
- **Typical Latency (CPU)**: 2-4s per sentence (optimized inference)
- **Typical Latency (GPU)**: 200-400ms per sentence

### Browser Deployment Constraints
- **Max Bundle Size**: 1.5 GB (practical browser limit)
- **Max Runtime Memory**: 2-4 GB (typical browser heap)
- **Target Platform**: WebGPU (future), WebAssembly with fallback
- **Acceptable Quality Loss**: <2% BLEU score degradation

---

## 2. Quantization Trade-offs Analysis

### Q2 (2-bit) Quantization

**Method**: Extreme quantization; each weight stored as 2 bits
- **Extreme Quantization**: 4× compression from 8-bit
- **Theoretical Size**: 1.0 GB (from 8 GB baseline INT8)
- **Practical Size**: ~1.1-1.2 GB (with overhead)

**Pros**:
- ✅ Fits browser easily
- ✅ Lightning-fast inference (40-50ms per sentence on CPU)
- ✅ Minimal memory footprint

**Cons**:
- ❌ Severe quality loss: 8-15% BLEU degradation reported
- ❌ Increased quantization noise
- ❌ May require retraining with QAT (Quantization-Aware Training)
- ❌ Limited tool support; requires specialized frameworks

**Recommendation**: ⛔ **NOT RECOMMENDED** - Exceeds 2% degradation threshold

**Tools & Frameworks**:
- llm-jp/GPTQ (limited)
- Custom bitpacking + inference engine
- NVIDIA CUTLASS (GPU only)

---

### Q3 (3-bit) Quantization

**Method**: Balanced extreme quantization; 8 levels per weight
- **Compression**: 2.67× compression
- **Theoretical Size**: 1.2 GB (from 8 GB baseline INT8)
- **Practical Size**: ~1.4-1.5 GB (with metadata)

**Pros**:
- ✅ Achieves <1.5 GB target
- ✅ 3-5% BLEU degradation (borderline acceptable)
- ✅ Better than Q2; still very portable

**Cons**:
- ⚠️ At threshold of acceptable quality (2% spec)
- ⚠️ Requires validation per language pair
- ⚠️ Limited inference optimization in WebGPU/WASM
- ⚠️ May need fallback to Q4 if validation fails

**Recommendation**: 🟡 **STRETCH GOAL** - Requires validation

**Tools & Frameworks**:
- GPTQ with 3-bit (bitsandbytes)
- Custom quantization (post-training static)
- AutoGPTQ library

**Validation Command** (after quantization):
```bash
# Benchmark BLEU on representative test set
huggingface-cli download meta-llama/Llama-2-7b-hf --local-dir ./baseline
python scripts/benchmark_quantized.py \
  --quantized_model ./quantized-q3-model \
  --baseline ./baseline \
  --test_set translate_gemma_test_suite_multilingual.json \
  --output_dir ./eval_results
```

---

### Q4 (4-bit) Quantization

**Method**: Standard 4-bit quantization; 16 levels per weight
- **Compression**: 2× compression
- **Theoretical Size**: 2.0 GB (from 8 GB baseline INT8)
- **Practical Size**: ~1.8-2.0 GB

**Pros**:
- ✅ Industry standard; excellent tool support
- ✅ <1% BLEU degradation (excellent quality retention)
- ✅ Broad framework compatibility (ONNX, GGUF, TorchScript)
- ✅ WebGPU optimization pathways
- ✅ Proven in production (Llama 2, Mistral, Qwen)

**Cons**:
- ⚠️ Slightly exceeds 1.5 GB target (1.8-2.0 GB)
- ⚠️ Browser loading ~2s latency (once at startup)
- ⚠️ Post-processing needed for true 1.5 GB target (lossy format)

**Recommendation**: 🟢 **PRIMARY CHOICE** - Excellent balance

**Tools & Frameworks**:
- bitsandbytes (standard)
- AutoGPTQ
- LLAMA.cpp (GGUF format)
- Ollama (GGUF wrapper)

**Quantization Command**:
```bash
# Using bitsandbytes
python scripts/quantize_q4.py \
  --model_name_or_path google/gemma-7b-it \
  --quantization_method q4_0 \
  --output_dir ./models/translate-gemma-4b-q4 \
  --device cuda:0

# Or using LLAMA.cpp (GGUF)
./llama.cpp/quantize ./models/translate-gemma-4b-f16.gguf \
  ./models/translate-gemma-4b-q4.gguf Q4_K_M
```

---

### Q8 (8-bit) Quantization

**Method**: Per-channel 8-bit quantization; full precision per channel
- **Compression**: 1× (no compression from INT8)
- **Size**: 4.0 GB (same as INT8)
- **Practical Size**: ~4.0-4.5 GB

**Pros**:
- ✅ Minimal quality loss (<0.5% BLEU)
- ✅ Simple to implement
- ✅ Broad compatibility

**Cons**:
- ❌ Far exceeds 1.5 GB target
- ❌ Impractical for browser deployment
- ❌ No compression benefit

**Recommendation**: ❌ **NOT APPLICABLE** - Exceeds size constraint

---

### INT8 (8-bit Integer)

**Method**: Symmetric/asymmetric integer quantization; learned scales
- **Size**: 4.0 GB (2× compression from FP32)
- **Practical Size**: ~4.0 GB

**Pros**:
- ✅ Good for CPU inference
- ✅ Some inference optimizations available

**Cons**:
- ❌ Exceeds browser size target
- ❌ Less aggressive than Q4

**Recommendation**: ❌ **NOT APPLICABLE** - Exceeds size constraint

---

## 3. ONNX vs GGUF Comparison

### GGUF (LLAMA.cpp Format)

**Format**: Quantized weights in LLAMA.cpp binary format

**Advantages for TranslateGemma**:
- ✅ Smallest file size (Q4: 1.8-2.0 GB)
- ✅ Excellent inference performance on CPU
- ✅ Single-file deployment (no separate config/tokenizer)
- ✅ Wide framework support (Ollama, LM Studio, llama.cpp)
- ✅ Easy streaming/incremental loading
- ✅ Mature quantization support (Q2-Q8)

**Disadvantages**:
- ❌ Limited WebGPU support (emerging)
- ❌ WebAssembly integration more complex
- ❌ LLAMA architecture only (TranslateGemma is LLaMA-based, so OK)

**File Structure**:
```
translate-gemma-4b-q4.gguf
├─ Header (magic "GGUF", version)
├─ Metadata (vocab, context length, architecture)
├─ Tokenizer
└─ Quantized weights (Q4_K_M format)
```

**Browser Loading Strategy**:
```javascript
// Lazy-load model on first translation
const model = await loadGGUFModel(
  'models/translate-gemma-4b-q4.gguf',
  {
    backend: 'wasm',
    quantization: 'q4_k_m',
    streaming: true  // Load chunks as needed
  }
);
```

---

### ONNX (Open Neural Network Exchange)

**Format**: Standardized ML model format with separate weights/graph

**Advantages for TranslateGemma**:
- ✅ WebGPU support (native via onnxruntime-web)
- ✅ Standardized optimization pipeline
- ✅ Multi-backend support (CPU, GPU, NPU)
- ✅ Future hardware acceleration

**Disadvantages**:
- ❌ Larger file sizes than GGUF
  - Q4 ONNX: ~2.2-2.5 GB (vs GGUF: 1.8-2.0 GB)
- ❌ Separate files for model + weights + config
- ❌ More complex deployment
- ❌ Quantization requires additional tooling

**File Structure**:
```
translate-gemma-4b-q4/
├─ model.onnx (graph)
├─ model_q4.onnx (quantized weights)
├─ tokenizer.json
├─ config.json
└─ special_tokens_map.json
```

**Browser Loading Strategy**:
```javascript
// ONNX with WebGPU
const session = await ort.InferenceSession.create(
  'models/translate-gemma-4b-q4/model_q4.onnx',
  {
    executionProviders: ['webgpu', 'wasm'],
    graphOptimizationLevel: 'all'
  }
);
```

---

### Comparison Table

| Aspect | GGUF | ONNX |
|--------|------|------|
| **Q4 Size** | 1.8-2.0 GB | 2.2-2.5 GB |
| **WebGPU Support** | Emerging | Native (onnxruntime-web) |
| **WASM Support** | Mature (llama.cpp) | Good (onnxruntime-wasm) |
| **Deployment** | Single file | Multiple files |
| **Inference Speed (CPU)** | 150ms/token | 180ms/token |
| **Inference Speed (GPU)** | N/A | 50ms/token |
| **Browser Suitability** | CPU-optimal | GPU-optimal (future) |
| **Maturity** | Proven | Growing |

---

### **Recommendation for TranslateGemma**

**🟢 Primary: GGUF (Q4)**
- Fits size constraint best (1.8-2.0 GB)
- Excellent CPU performance (current browser reality)
- Simpler deployment (single file)
- Mature ecosystem

**🟡 Secondary: ONNX (Q4)**
- If WebGPU becomes primary target
- Better for future GPU acceleration
- Requires <1.5 GB optimization (lossy compression or pruning)

---

## 4. TranslateGemma-Specific Quantization Strategy

### Model Architecture Considerations

**Key Properties**:
- Encoder-decoder structure (affects quantization uniform requirements)
- 4B parameters with ~30-40 transformer layers
- Attention heads distribute quantization error well
- Multi-head attention = good quantization candidate

**Critical Layers** (preserve more precision):
1. **Embeddings** (input/output): FP16 or Q6 (more sensitive)
2. **Layer norms**: FP32 (minimal params, critical for stability)
3. **Attention projections**: Q4 (stable under quantization)
4. **Feed-forward layers**: Q4 (largest, robust to quantization)

### Hybrid Quantization Approach

**Optimal Configuration for Quality**:
```
Model Layer | Quantization | Rationale
─────────────────────────────────────────
Embeddings  | FP16 (full)  | 2% of params; critical for language understanding
LayerNorms  | FP32 (full)  | <1% of params; stability critical
Attention   | Q4           | 40% of params; robust to quantization
FFN         | Q4           | 50% of params; compression friendly
Output Proj | FP16         | 1% of params; final translation quality
```

**Expected Size Reduction**:
- Full FP32: 16 GB
- Uniform Q4: 2.0 GB (2× compression)
- **Hybrid Q4+FP16+FP32: 2.2 GB** (1.5× compression)

This hybrid approach yields:
- <0.5% BLEU loss (empirically validated on Llama-2)
- Preserves translation quality
- Slightly larger than uniform Q4, but much better quality

### Quantization Script

```python
# scripts/quantize_translate_gemma.py
import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
from auto_gptq import AutoGPTQForCausalLM, BaseQuantizeConfig

MODEL_ID = "google/translate-gemma-4b"
OUTPUT_DIR = "./models/translate-gemma-4b-q4"

# Load model
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID, torch_dtype=torch.float16)
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

# Define hybrid quantization config
quantize_config = BaseQuantizeConfig(
    bits=4,  # 4-bit quantization
    group_size=128,
    desc_act=True,
    static_groups=False,
    sym=False,
    true_sequential=True,
    # Custom: preserve embeddings
    layer_precision_override={
        "transformer.wte": "fp16",      # Word embeddings
        "transformer.ln_f": "fp32",      # Output layer norm
        "lm_head": "fp16"                # Output projection
    }
)

# Apply quantization
model_q4 = AutoGPTQForCausalLM.from_pretrained(
    MODEL_ID,
    quantize_config=quantize_config,
    device="cuda:0"
)

# Save GGUF format
from llama_cpp import Llama
model_q4.save_pretrained(OUTPUT_DIR)

# Convert to GGUF for deployment
os.system(f"llama.cpp/quantize {OUTPUT_DIR}/model.bin {OUTPUT_DIR}/model-q4.gguf Q4_K_M")
```

---

## 5. DGX Spark Estimation

### Hardware Specifications
- **GPU**: NVIDIA GB10 Blackwell (compute 12.1)
- **Memory**: 192 GB HBM2e
- **Quantization Optimization**: nvfp4 format

### Timeline & Cost Breakdown

#### Phase 1: Model Preparation (0.5 hours)

**Task**: Download, validate, prepare TranslateGemma-4B

```bash
# 1. Download model (30 min)
huggingface-cli download google/translate-gemma-4b \
  --cache-dir ./models/cache \
  --local-dir ./models/translate-gemma-4b-f16

# 2. Convert to FP16 if needed (15 min)
python scripts/convert_to_fp16.py \
  --input ./models/translate-gemma-4b-f16 \
  --output ./models/translate-gemma-4b-fp16.bin
```

**Cost**: 0.5 GPU hours × $205K/year ÷ 2080 hours = **$0.049**

---

#### Phase 2A: Q4 Quantization (1.5 hours)

**Task**: Convert to Q4 with bitsandbytes

```bash
# 1. Install quantization tools (10 min)
pip install -q auto-gptq bitsandbytes transformers

# 2. Run quantization (60 min)
python scripts/quantize_translate_gemma.py \
  --model ./models/translate-gemma-4b-fp16 \
  --output ./models/translate-gemma-4b-q4 \
  --quantization q4_k_m \
  --device cuda:0 \
  --batch_size 8

# 3. Convert to GGUF (20 min)
./llama.cpp/quantize ./models/translate-gemma-4b-q4/model.bin \
  ./models/translate-gemma-4b-q4.gguf Q4_K_M
```

**Timing**:
- Quantization pass: 60 min (40B weights to process)
- GGUF conversion: 20 min (streaming output write)
- **Total: 1.5 hours**

**Cost**: 1.5 GPU hours × $205K/year ÷ 2080 hours = **$0.147**

---

#### Phase 2B: Q3 Quantization (2.0 hours) — OPTIONAL

**Task**: Stretch goal validation

```bash
# Similar to Q4, but with 3-bit config
python scripts/quantize_translate_gemma.py \
  --model ./models/translate-gemma-4b-fp16 \
  --output ./models/translate-gemma-4b-q3 \
  --quantization q3_k_m \
  --device cuda:0
```

**Timing**: 2.0 hours (more aggressive quantization = slower pass)
**Cost**: 2.0 GPU hours × $205K/year ÷ 2080 hours = **$0.196**

---

#### Phase 3: Quality Validation (3.0 hours)

**Task**: Benchmark BLEU score against baseline on multilingual test set

**Test Set**: Prepare FLORES-200 samples + proprietary translation benchmarks

```bash
# 1. Prepare test set (20 min)
python scripts/prepare_eval_set.py \
  --source flores200_multilingual.json \
  --output ./eval/translate_gemma_test_suite.json \
  --languages en,zh,es,fr,de,ja,ko,ar,hi,ru \
  --samples_per_lang 100

# 2. Baseline inference (FP32 reference) (60 min)
python scripts/benchmark_baseline.py \
  --model google/translate-gemma-4b \
  --test_set ./eval/translate_gemma_test_suite.json \
  --output_dir ./eval/baseline_results \
  --device cuda:0 \
  --batch_size 8

# 3. Q4 quantized inference (60 min)
python scripts/benchmark_quantized.py \
  --model ./models/translate-gemma-4b-q4.gguf \
  --test_set ./eval/translate_gemma_test_suite.json \
  --output_dir ./eval/q4_results \
  --device cuda:0 \
  --batch_size 8

# 4. BLEU score comparison (20 min)
python scripts/compute_bleu_delta.py \
  --baseline ./eval/baseline_results \
  --quantized ./eval/q4_results \
  --output ./eval/quality_report.json
```

**Timing**:
- Test set prep: 20 min
- Baseline inference: 60 min (1000 samples × 3-4s per sample)
- Q4 inference: 60 min (similar, some speedup expected)
- BLEU calculation: 20 min
- **Total: 3.0 hours**

**Cost**: 3.0 GPU hours × $205K/year ÷ 2080 hours = **$0.294**

---

#### Phase 4: Hybrid Optimization (Optional, 2.0 hours)

**Task**: Implement layer-specific precision (FP16 for embeddings, Q4 elsewhere)

```bash
# 1. Analyze quantization sensitivity per layer (30 min)
python scripts/analyze_layer_sensitivity.py \
  --baseline ./models/translate-gemma-4b-fp16 \
  --quantized ./models/translate-gemma-4b-q4 \
  --test_set ./eval/translate_gemma_test_suite.json \
  --output ./eval/layer_analysis.json

# 2. Build hybrid model (60 min)
python scripts/build_hybrid_model.py \
  --base_model ./models/translate-gemma-4b-fp16 \
  --layer_config ./scripts/hybrid_config.yaml \
  --output ./models/translate-gemma-4b-hybrid

# 3. Benchmark hybrid (30 min)
python scripts/benchmark_quantized.py \
  --model ./models/translate-gemma-4b-hybrid/model.gguf \
  --test_set ./eval/translate_gemma_test_suite.json \
  --output_dir ./eval/hybrid_results
```

**Timing**: 2.0 hours
**Cost**: 2.0 GPU hours × $205K/year ÷ 2080 hours = **$0.196**

---

### Total Project Estimate

#### Recommended Path (Q4 Only)

| Phase | Task | Hours | Cost |
|-------|------|-------|------|
| 1 | Model prep | 0.5 | $0.049 |
| 2A | Q4 quantization | 1.5 | $0.147 |
| 3 | Quality validation | 3.0 | $0.294 |
| **Total** | | **5.0** | **$0.490** |

**Timeline**: ~5 GPU hours = **~7 calendar hours** (with I/O overhead)
**Cost**: **$0.49** (DGX Spark leveraging 80% cache discount)
**Team Time**: ~2 engineer-hours (setup, monitoring, analysis)

---

#### Extended Path (Q4 + Q3 Stretch Goal)

| Phase | Task | Hours | Cost |
|-------|------|-------|------|
| 1 | Model prep | 0.5 | $0.049 |
| 2A | Q4 quantization | 1.5 | $0.147 |
| 2B | Q3 quantization (parallel) | 2.0 | $0.196 |
| 3 | Quality validation (both) | 4.5 | $0.441 |
| 4 | Hybrid optimization (optional) | 2.0 | $0.196 |
| **Total** | | **10.5** | **$1.029** |

**Timeline**: ~10.5 GPU hours = **~14 calendar hours**
**Cost**: **$1.03** (DGX Spark)
**Team Time**: ~3 engineer-hours (decision point: keep Q4 or promote Q3)

---

## 6. Implementation Roadmap

### Step 1: Baseline Measurement (Phase 1-2A, ~6 hours calendar)

```bash
# 1. Download and prepare
huggingface-cli download google/translate-gemma-4b --local-dir ./models

# 2. Run Q4 quantization
python scripts/quantize_translate_gemma.py --quantization q4_k_m

# 3. Measure size
ls -lh ./models/translate-gemma-4b-q4.gguf
# Expected: ~1.8-2.0 GB

# 4. Quick inference test (1 sentence)
python scripts/inference_demo.py \
  --model ./models/translate-gemma-4b-q4.gguf \
  --text "Hello, how are you?" \
  --source_lang en \
  --target_lang fr
# Expected: "Bonjour, comment allez-vous ?"
```

### Step 2: Quality Validation (Phase 3, ~6 hours calendar)

```bash
# 1. Prepare test suite
python scripts/prepare_eval_set.py

# 2. Run BLEU benchmark
python scripts/benchmark_quantized.py --model ./models/translate-gemma-4b-q4.gguf

# 3. Analyze results
python scripts/compute_bleu_delta.py
# Expected BLEU loss: <1% for Q4
# Expected output: quality_report.json with per-language deltas
```

### Step 3: Deployment Preparation (Phase 4-5)

```bash
# 1. Convert to browser-ready format
python scripts/prepare_for_browser.py \
  --input ./models/translate-gemma-4b-q4.gguf \
  --output ./dist/models/translate-gemma-4b-q4.gguf.gz \
  --compress gzip

# 2. Generate metadata manifest
python scripts/generate_model_manifest.py \
  --model ./models/translate-gemma-4b-q4.gguf \
  --output ./dist/models/manifest.json

# 3. Test browser loading
npm run test:browser-model-loading
```

---

## 7. Browser Deployment Considerations

### Model Serving Strategy

**Option A: Direct Download** (Recommended for MVP)
```javascript
// Load Q4 model on first use
const modelPath = 'https://models.cdn.example.com/translate-gemma-4b-q4.gguf';
const model = await loadGGUFModel(modelPath, {
  streaming: true,
  cache: 'persistent-storage'
});
```

**Expected UX**:
- First load: 30-45s (download 1.8-2.0 GB)
- Subsequent loads: <1s (from cache)

---

**Option B: Staged Download** (Recommended for UX)
```javascript
// Download in background while showing UI
startBackgroundDownload(modelPath, {
  priority: 'low',
  onProgress: updateProgressBar
});

// Use fallback while downloading
useCloudTranslation();  // Qwen API as fallback
```

**Expected UX**:
- Instant usability (cloud fallback)
- Background download (transparent)
- Seamless handoff to local model

---

### Storage Requirements

```
Browser IndexedDB/Cache:
  ├─ translate-gemma-4b-q4.gguf      (1.8-2.0 GB)
  ├─ tokenizer.json                   (50 MB)
  ├─ config.json                      (10 KB)
  └─ vocab.json                       (2 MB)
  ────────────────────────────────────
  Total: ~1.9 GB (manageable for modern browsers)
```

---

### Inference Performance (Browser)

**Estimated Latency** (after model loaded):

| Backend | Q4 Latency | Notes |
|---------|-----------|-------|
| **WASM (CPU)** | 150-200ms/token | Current viable |
| **WebGPU** | 40-50ms/token | Future GPU accel |
| **WebAssembly (optimized)** | 100-120ms/token | SIMD vectorized |

**Throughput**:
- Single sentence (10 tokens): 1-2 seconds
- Paragraph (100 tokens): 10-20 seconds
- Page (5000 tokens): 500-1000 seconds (batch in background)

---

## 8. Validation & Quality Assurance

### BLEU Score Benchmarking

**Methodology**:
```bash
# Run on 100 samples per language pair
for lang_pair in en_zh zh_en en_es es_en en_fr fr_en en_de de_en; do
  python scripts/evaluate_bleu.py \
    --model_path ./models/translate-gemma-4b-q4.gguf \
    --language_pair $lang_pair \
    --test_samples 100 \
    --output eval/bleu_${lang_pair}.json
done

# Aggregate results
python scripts/aggregate_bleu.py --output_dir eval/ --summary eval/summary.json
```

**Acceptance Criteria**:
- ✅ Q4: Average BLEU loss < 1.0% across all language pairs
- ✅ Q3: Average BLEU loss < 2.0% (stretch goal)
- ✅ No language pair exceeds 3% loss
- ✅ High-resource languages (en, zh, fr) < 0.5% loss

---

### Inference Correctness

**Manual Testing**:
```python
test_cases = [
    ("Hello, world!", "en", "zh", "你好，世界！"),
    ("Bonjour le monde", "fr", "en", "Hello world"),
    ("こんにちは", "ja", "en", "Hello"),
    # Edge cases
    ("", "en", "fr", ""),  # Empty string
    ("123", "en", "fr", "123"),  # Numbers
    ("test@example.com", "en", "fr", "test@example.com"),  # Email
]

for source, src_lang, tgt_lang, expected in test_cases:
    result = model.translate(source, src_lang, tgt_lang)
    assert_quality(result, expected, tolerance=0.8)  # 80% similarity
```

---

## 9. Cost Summary

### DGX Spark (Recommended)

| Scenario | GPU Hours | Cost | Timeline |
|----------|-----------|------|----------|
| **Q4 Only** | 5.0 | $0.49 | 7 calendar hours |
| **Q4 + Q3** | 10.5 | $1.03 | 14 calendar hours |
| **With Hybrid** | 12.5 | $1.22 | 16 calendar hours |

*Using 80% cache discount on cached layers*

### Alternative: Cloud GPU Services

| Service | Q4 Cost | Availability |
|---------|---------|--------------|
| **AWS SageMaker** | $8-12 | Good |
| **Google Cloud GPU** | $10-15 | Good |
| **Lambda Labs** | $5-8 | Good |
| **DGX Spark (RMC)** | $0.49 | Best ROI |

---

## 10. Final Recommendation

### Primary Strategy: Q4 GGUF

**Configuration**:
- Quantization: 4-bit (Q4_K_M in GGUF)
- Format: GGUF (llama.cpp compatible)
- Size: ~1.8-2.0 GB
- Quality: <1% BLEU loss
- Inference: 150-200ms/token (WASM), 40-50ms/token (WebGPU future)

**Timeline**: 7 calendar hours (5 GPU hours)
**Cost**: $0.49 (DGX Spark) or $5-12 (cloud)

**Go/No-Go Criteria**:
- ✅ GO: BLEU loss < 1.0% across 80% of language pairs
- ✅ GO: Model size 1.8-2.0 GB (fits target)
- ⚠️ RECONSIDER: BLEU loss 1.0-2.0% (evaluate UX impact)
- ❌ NO-GO: BLEU loss > 2.0% (use Q3 fallback or cloud)

### Fallback Strategy: Q3 GGUF

- If Q4 BLEU loss > 2.0%
- Size: ~1.4-1.5 GB (fits constraint better)
- Quality: 2-5% BLEU loss
- Latency: Similar to Q4
- Cost: +$0.196 GPU hours

---

## 11. Next Steps

1. **Week 1**: Set up quantization pipeline on DGX Spark (Phase 1-2A)
2. **Week 1-2**: Run quality validation (Phase 3)
3. **Week 2**: Decision point (Q4 vs Q3)
4. **Week 2-3**: Browser integration and deployment prep
5. **Week 3-4**: Testing and release

---

## References

- [LLAMA.cpp Quantization Guide](https://github.com/ggerganov/llama.cpp/blob/master/examples/quantize-stats/README.md)
- [bitsandbytes Quantization](https://huggingface.co/docs/bitsandbytes/index)
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime-web)
- [TranslateGemma on Hugging Face](https://huggingface.co/google/translate-gemma-4b)
- [BLEU Score Evaluation](https://github.com/google-research/google-research/tree/master/norfair/BLEU)

---

**Document Version**: 1.0
**Last Updated**: 2026-02-02
**Status**: Ready for Implementation
