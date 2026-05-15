# DGX Spark Local-Model Quantization Runbook

This runbook tracks DGX-side local-model quantization for the browser extension.

**Estimated Total Time**: 7-14 hours (calendar time)
**Estimated GPU Hours**: 5-12 hours
**Estimated Cost**: $0.49-$1.22 (DGX Spark w/ 80% cache discount)

## Current Validation Header

- **Last reviewed**: 2026-05-12
- **Current status**: blocked for end-to-end execution
- **Blocking follow-up**: MIK-3480 must select and benchmark the next browser model target before a DGX quantization run is useful.
- **Current shipped runtime**: the extension uses the ONNX Q4/Q4F16 package `m1cc0z/translategemma-4b-it-onnx-q4-webgpu`; this document's older GGUF/AutoGPTQ path is not the shipped browser runtime.
- **DGX host check**: `ssh spark` succeeds. `nvidia-smi` reports an NVIDIA GB10 with driver 595.58.03 and CUDA 13.2, but the GPU was already busy during validation.
- **End-to-end DGX run**: not run. Executing the old `google/translate-gemma-4b` to GGUF flow before MIK-3480 would risk wasting 5-12 GPU hours on the wrong model and artifact format.
- **MIK-3480 metadata gate**: current TranslateGemma is roughly 3.4GB per ONNX dtype path, Qwen3-0.6B has a browser-sized q4/q4f16 package, and Gemma 3n E2B is public but too large/multimodal to benchmark without first selecting a text-only subset. DGX remains blocked until a browser/GPU quality and latency benchmark picks a target.

## 2026-05 Toolchain Audit

| Area | Previous command or assumption | 2026-05 finding | Action |
| --- | --- | --- | --- |
| Python runtime | `python3.11 -m venv venv_quantize` | `spark` has `python3` as 3.13.7 in PATH; `python3.11` was not found in the validation shell. | Use `python3 -m venv ...` unless a project-local Python 3.11 path is installed and verified. |
| PyTorch wheel | `pip install torch ... --index-url .../cu118` | DGX Spark reported CUDA 13.2. The CUDA 11.8 wheel pin is stale for this host. | Select the current PyTorch CUDA wheel for the host after checking the PyTorch install selector; verify `torch.cuda.is_available()` and GPU name before running quantization. |
| Model target | `google/translate-gemma-4b` | Hugging Face API access for this ID returned 401 during validation, and the browser extension currently consumes an ONNX package instead. | Do not download or quantize this model until MIK-3480 selects the current target and access is verified. |
| Model class | `AutoModelForSeq2SeqLM` | Gemma-family browser targets are decoder-style LLMs or exported ONNX artifacts, not necessarily Seq2SeqLM-compatible. | Validate the target architecture first; update scripts before running. |
| bitsandbytes | `pip install auto-gptq bitsandbytes` and `--method bitsandbytes` | Current package index shows bitsandbytes 0.49.2. It is appropriate for 4-bit/NF4 HF loading and fine-tuning workflows, but not a final browser artifact by itself. | Treat bitsandbytes as an experiment/loading path, not the artifact generation target unless the benchmark plan calls for it. |
| AutoGPTQ | `--method autogptq` | Current package index shows AutoGPTQ 0.7.1; upstream marks AutoGPTQ unmaintained and points to GPTQModel for new models. | Do not start new DGX work on AutoGPTQ without a compatibility check; prefer GPTQModel if GPTQ is selected. |
| AutoAWQ | Not covered | Current package index shows AutoAWQ 0.2.9. | Add only if MIK-3480 selects AWQ as a candidate. |
| llama.cpp build | `make -j$(nproc)` | Current llama.cpp builds are CMake-first. | Use `cmake -B build ...` and `cmake --build build ...`. |
| llama.cpp conversion | `python3 ./llama.cpp/convert.py` | Current conversion script is `convert_hf_to_gguf.py`. | Use the current script after confirming the selected model is supported by llama.cpp. |
| llama.cpp quantization | `./llama.cpp/quantize` | Current quantizer binary is built as `build/bin/llama-quantize` on typical source builds. | Use `./build/bin/llama-quantize input.gguf output.gguf Q4_K_M`. |
| Repository scripts | `scripts/quantize_translate_gemma.py`, `scripts/benchmark_quantized.py`, `scripts/prepare_eval_set.py` | Scripts still assume the old `google/translate-gemma-4b` and Seq2SeqLM-style flow. | Dry-run/read only until the target model and artifact format are updated. |

## Safe Current Workflow

Use this workflow before reviving any long DGX quantization run:

1. Complete MIK-3480: benchmark the current ONNX TranslateGemma package against current small browser-local candidates.
2. Pick the artifact family first:
   - If ONNX remains the browser runtime target, do not run the GGUF phases below. Update the ONNX export/package workflow instead.
   - If GGUF/llama.cpp becomes the runtime target, confirm the selected model is supported by llama.cpp before conversion.
3. Confirm that the candidate package is actually runnable in the extension or a close browser harness:

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers \
  npx playwright test e2e/webgpu-detection.spec.ts --reporter=line

npm run test:benchmarks -- src/__benchmarks__/translategemma-batch.test.ts
```

These checks are necessary but insufficient. They verify the local browser GPU gate and batching harness, not model translation quality.

4. Confirm the DGX host is idle enough for a multi-hour job:

```bash
ssh spark 'nvidia-smi'
```

5. Create an environment using the host's verified Python and CUDA stack:

```bash
python3 -m venv venv_quantize
source venv_quantize/bin/activate
python -m pip install --upgrade pip

# Select the current PyTorch wheel for the host before running this.
python -m pip install torch torchvision torchaudio
python -m pip install transformers tokenizers safetensors accelerate datasets evaluate sacrebleu
python -m pip install bitsandbytes gptqmodel
```

6. Verify CUDA from Python before starting work:

```bash
python - << 'EOF'
import torch

print("torch:", torch.__version__)
print("cuda available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("gpu:", torch.cuda.get_device_name(0))
EOF
```

7. If GGUF is selected, use current llama.cpp commands:

```bash
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j"$(nproc)"

python3 convert_hf_to_gguf.py ../models/selected-hf-model \
  --outfile ../models/selected-f16.gguf \
  --outtype f16

./build/bin/llama-quantize \
  ../models/selected-f16.gguf \
  ../models/selected-q4_k_m.gguf \
  Q4_K_M
```

The legacy flow below is kept for context and for recovering useful benchmarking/report structure. Do not execute it end-to-end until the blockers above are resolved.

---

## Prerequisites

### 1. Access DGX Spark

```bash
# SSH into DGX Spark host
mosh spark  # or: ssh spark

# Verify GPU availability
nvidia-smi
# Expected: NVIDIA GB10 class GPU and enough idle memory/utilization for a multi-hour job
```

### 2. Clone Repository and Setup

```bash
# Navigate to project
cd /path/to/translate-browser-extension

# Create Python virtual environment with the verified host Python
python3 -m venv venv_quantize
source venv_quantize/bin/activate

# Install dependencies
pip install --upgrade pip
pip install torch torchvision torchaudio
pip install transformers tokenizers safetensors accelerate
pip install gptqmodel bitsandbytes
pip install evaluate sacrebleu datasets
```

### 3. Prepare Directories

```bash
# Create working directories
mkdir -p ./models/cache
mkdir -p ./models/quantized
mkdir -p ./eval
mkdir -p ./logs

# Set environment variables
export HF_HOME=./models/cache
export TORCH_HOME=./models/cache
```

---

## Legacy Phase 1: Model Preparation (0.5 hours)

This section is historical. Replace the model ID and model class with the target selected by MIK-3480 before running it.

### Step 1.1: Download TranslateGemma-4B

```bash
# Log into Hugging Face first (optional, for faster download)
huggingface-cli login  # Enter token if needed

# Download model only after access and target selection are verified
huggingface-cli download google/translate-gemma-4b \
  --cache-dir ./models/cache \
  --local-dir ./models/translate-gemma-4b-f16 \
  --repo-type model

# Verify download
ls -lh ./models/translate-gemma-4b-f16/
# Expected: model.safetensors (~8GB), config.json, tokenizer.json, etc.
```

**Expected Duration**: 15-20 minutes (depends on network)

---

### Step 1.2: Verify Model Integrity

```bash
# Check model size and structure
python3 << 'EOF'
import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

model = AutoModelForSeq2SeqLM.from_pretrained(
    "./models/translate-gemma-4b-f16",
    torch_dtype=torch.float16,
    device_map="cpu"
)

total_params = sum(p.numel() for p in model.parameters())
size_gb = total_params * 2 / (1024**3)  # FP16 = 2 bytes

print(f"Model: TranslateGemma-4B")
print(f"Total parameters: {total_params:,}")
print(f"FP16 size: {size_gb:.2f} GB")
print(f"Architecture: {model.config.model_type}")
EOF
```

**Expected Output**:
```
Model: TranslateGemma-4B
Total parameters: 4,000,000,000
FP16 size: 8.00 GB
Architecture: gemma
```

---

## Legacy Phase 2A: Q4 Quantization (1.5 hours)

This section is historical. The repository scripts named here still assume the old model target and should be updated before use.

### Step 2A.1: Quantize with bitsandbytes (Simpler)

```bash
# Run quantization script
time python3 scripts/quantize_translate_gemma.py \
  --model ./models/translate-gemma-4b-f16 \
  --output_dir ./models/translate-gemma-4b-q4-bb \
  --quantization q4_0 \
  --bits 4 \
  --method bitsandbytes \
  --device cuda:0

# Expected time: 60-80 minutes
# Expected output size: ~2.0 GB
```

### Step 2A.2 (Alternative): Quantize with AutoGPTQ (Historical GPTQ Experiment)

```bash
# Historical only. Prefer GPTQModel for new work if GPTQ is selected,
# but this repository script must be ported before that package can be used.
time python3 scripts/quantize_translate_gemma.py \
  --model ./models/translate-gemma-4b-f16 \
  --output_dir ./models/translate-gemma-4b-q4-gptq \
  --quantization q4_k_m \
  --bits 4 \
  --group_size 128 \
  --method autogptq \
  --device cuda:0

# Expected time: 90-120 minutes
# Expected output size: ~1.8 GB
```

### Step 2A.3: Verify Quantization

```bash
# Check output files
ls -lh ./models/translate-gemma-4b-q4-gptq/

# Check file sizes
du -sh ./models/translate-gemma-4b-q4-gptq/*

# Load and verify quantized model
python3 << 'EOF'
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

print("Loading quantized model...")
model = AutoModelForSeq2SeqLM.from_pretrained(
    "./models/translate-gemma-4b-q4-gptq",
    device_map="cuda:0"
)
tokenizer = AutoTokenizer.from_pretrained("./models/translate-gemma-4b-q4-gptq")

print(f"✅ Model loaded successfully")
print(f"Model size: {sum(p.numel() for p in model.parameters()):,} parameters")

# Quick inference test
text = "Hello, how are you?"
inputs = tokenizer(text, return_tensors="pt").to("cuda:0")
outputs = model.generate(**inputs, max_length=50)
result = tokenizer.decode(outputs[0], skip_special_tokens=True)
print(f"Test inference: '{text}' -> '{result}'")
EOF
```

**Expected Output**:
```
✅ Model loaded successfully
Model size: 4,000,000,000 parameters
Test inference: 'Hello, how are you?' -> [translation in another language]
```

---

## Legacy Phase 2B: Q3 Quantization (Optional, 2.0 hours)

### Step 2B.1: Quantize to Q3 (if pursuing stretch goal)

```bash
# Run Q3 quantization in parallel or sequentially
time python3 scripts/quantize_translate_gemma.py \
  --model ./models/translate-gemma-4b-f16 \
  --output_dir ./models/translate-gemma-4b-q3 \
  --quantization q3_k_m \
  --bits 3 \
  --group_size 128 \
  --method autogptq \
  --device cuda:1  # Use different GPU if available

# Expected time: 120-150 minutes
# Expected output size: ~1.4-1.5 GB
```

---

## Legacy Phase 3: Quality Validation (3.0 hours)

### Step 3.1: Prepare Test Set

```bash
# Create evaluation dataset
time python3 scripts/prepare_eval_set.py \
  --languages en zh es fr de ja ko ar hi ru \
  --samples_per_lang 50 \
  --output ./eval/translate_gemma_test_suite.json \
  --include_edge_cases

# Expected time: 1-2 minutes
# Expected output: ~1 MB JSON file
```

**Check Output**:
```bash
# Verify test set
python3 << 'EOF'
import json
with open("./eval/translate_gemma_test_suite.json") as f:
    data = json.load(f)

print(f"Test set metadata:")
print(f"  Total samples: {data['metadata']['total_samples']}")
print(f"  Languages: {', '.join(data['metadata']['languages'])}")
print(f"  Samples per language pair: {data['metadata']['samples_per_language_pair']}")
EOF
```

### Step 3.2: Benchmark Q4 Model Against Baseline

```bash
# Run benchmark with comparison to FP16 baseline
time python3 scripts/benchmark_quantized.py \
  --model ./models/translate-gemma-4b-q4-gptq \
  --baseline ./models/translate-gemma-4b-f16 \
  --test_set ./eval/translate_gemma_test_suite.json \
  --output_dir ./eval/q4_comparison \
  --device cuda:0 \
  --batch_size 4

# Expected time: 90-120 minutes
# Generates: baseline_results.json, quantized_results.json, comparison.json
```

**Monitor Progress**:
```bash
# In separate terminal, watch GPU usage
watch -n 1 nvidia-smi

# Or check logs
tail -f eval/q4_comparison/comparison.json
```

### Step 3.3: Analyze Results

```bash
# Print BLEU comparison summary
python3 << 'EOF'
import json

with open("./eval/q4_comparison/comparison.json") as f:
    results = json.load(f)

overall = results["overall_comparison"]
print(f"\n{'='*60}")
print(f"QUANTIZATION QUALITY REPORT")
print(f"{'='*60}\n")

print(f"Model Compression:")
print(f"  Baseline:  {results['baseline_model_size_gb']:.2f} GB")
print(f"  Quantized: {results['quantized_model_size_gb']:.2f} GB")
print(f"  Ratio:     {results['compression_ratio']:.1f}×\n")

print(f"Quality Metrics:")
print(f"  Baseline BLEU:   {overall['baseline_mean_bleu']:.4f}")
print(f"  Quantized BLEU:  {overall['quantized_mean_bleu']:.4f}")
print(f"  BLEU Delta:      {overall['mean_bleu_delta_percent']:+.2f}%")
print(f"  Acceptable:      {'✅ YES (<2%)' if overall['acceptable'] else '❌ NO (>2%)'}\n")

print(f"Per-language-pair breakdown:")
print(f"{'Pair':<10} {'Baseline':<12} {'Quantized':<12} {'Delta':<10} {'Status':<10}")
print(f"{'-'*54}")

acceptable_count = 0
for pair, metrics in sorted(results["language_pair_comparisons"].items()):
    status = "✅" if metrics["bleu_delta_acceptable"] else "❌"
    acceptable_count += metrics["bleu_delta_acceptable"]
    print(
        f"{pair:<10} "
        f"{metrics['baseline_bleu']:<12.4f} "
        f"{metrics['quantized_bleu']:<12.4f} "
        f"{metrics['bleu_delta_percent']:+<9.2f}% "
        f"{status:<10}"
    )

total_pairs = len(results["language_pair_comparisons"])
print(f"\n✅ {acceptable_count}/{total_pairs} language pairs within 2% threshold")

# Decision logic
if overall["acceptable"]:
    print(f"\n🟢 DECISION: PASS - Use Q4 for production")
    print(f"   Quality loss is acceptable (<2%)")
else:
    print(f"\n🟡 DECISION: REVIEW - Consider Q3 or hybrid approach")
    print(f"   Quality loss exceeds 2% threshold")
EOF
```

### Step 3.4 (Optional): Benchmark Q3 Model

```bash
# If Q4 BLEU loss > 2%, evaluate Q3
time python3 scripts/benchmark_quantized.py \
  --model ./models/translate-gemma-4b-q3 \
  --baseline ./models/translate-gemma-4b-f16 \
  --test_set ./eval/translate_gemma_test_suite.json \
  --output_dir ./eval/q3_comparison \
  --device cuda:0 \
  --batch_size 4

# Expected time: 90-120 minutes
```

---

## Legacy Phase 4: Convert to GGUF (Optional, 30 minutes)

Run this only if MIK-3480 selects a GGUF/llama.cpp browser runtime target.

### Step 4.1: Clone llama.cpp

```bash
# Clone llama.cpp repository
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j"$(nproc)"
cd ..

# Verify quantize tool works
./llama.cpp/build/bin/llama-quantize --help
```

### Step 4.2: Convert to GGUF Format

```bash
# Convert selected model to GGUF
python3 ./llama.cpp/convert_hf_to_gguf.py \
  ./models/translate-gemma-4b-q4-gptq \
  --outfile ./models/translate-gemma-4b-q4-intermediate.gguf \
  --outtype f16

# Then quantize to Q4
time ./llama.cpp/build/bin/llama-quantize \
  ./models/translate-gemma-4b-q4-intermediate.gguf \
  ./models/translate-gemma-4b-q4.gguf \
  Q4_K_M

# Expected time: 15-20 minutes
# Expected output: ~1.8-2.0 GB GGUF file
```

### Step 4.3: Verify GGUF File

```bash
# Check file size and integrity
ls -lh ./models/translate-gemma-4b-q4.gguf
file ./models/translate-gemma-4b-q4.gguf

# Expected: GGUF format, ~1.8-2.0 GB
```

---

## Legacy Phase 5: Prepare for Browser Deployment

This section applies only to a future GGUF browser runtime. The current extension runtime uses an ONNX package.

### Step 5.1: Compress for Distribution

```bash
# Gzip compress for CDN/download
gzip -v ./models/translate-gemma-4b-q4.gguf

# Check compressed size
ls -lh ./models/translate-gemma-4b-q4.gguf.gz
# Expected: 300-500 MB (3.5-7× compression)
```

### Step 5.2: Generate Model Manifest

```bash
# Create deployment manifest
python3 << 'EOF'
import json
import hashlib
import os

model_path = "./models/translate-gemma-4b-q4.gguf"
compressed_path = "./models/translate-gemma-4b-q4.gguf.gz"

def compute_hash(filepath):
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            sha256.update(chunk)
    return sha256.hexdigest()

manifest = {
    "model": {
        "name": "TranslateGemma-4B",
        "version": "1.0",
        "quantization": "Q4_K_M (GGUF)",
        "format": "gguf",
    },
    "files": {
        "uncompressed": {
            "path": "translate-gemma-4b-q4.gguf",
            "size_bytes": os.path.getsize(model_path),
            "size_gb": os.path.getsize(model_path) / (1024**3),
            "sha256": compute_hash(model_path),
        },
        "compressed_gzip": {
            "path": "translate-gemma-4b-q4.gguf.gz",
            "size_bytes": os.path.getsize(compressed_path),
            "size_mb": os.path.getsize(compressed_path) / (1024**2),
            "sha256": compute_hash(compressed_path),
        },
    },
    "deployment": {
        "browser_loading_time_s": 30,  # Estimated
        "inference_latency_cpu_ms": 150,
        "inference_latency_gpu_ms": 50,
        "min_browser_memory_gb": 2,
        "recommended_browser_storage_gb": 2.5,
    },
}

with open("./models/manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print("✅ Manifest created: ./models/manifest.json")
print(json.dumps(manifest, indent=2))
EOF
```

---

## Legacy Phase 6: Final Validation

### Step 6.1: End-to-End Test

```bash
# Run complete translation test
python3 << 'EOF'
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
import torch
import time

print("Loading quantized model...")
model = AutoModelForSeq2SeqLM.from_pretrained(
    "./models/translate-gemma-4b-q4-gptq",
    device_map="cuda:0"
)
tokenizer = AutoTokenizer.from_pretrained("./models/translate-gemma-4b-q4-gptq")

test_cases = [
    ("en", "zh", "Hello, how are you today?"),
    ("en", "es", "Good morning, how are you?"),
    ("en", "fr", "The weather is beautiful"),
    ("en", "de", "Where is the train station?"),
]

print("\nTranslation tests:")
for src_lang, tgt_lang, text in test_cases:
    start = time.time()
    inputs = tokenizer(text, return_tensors="pt").to("cuda:0")

    with torch.no_grad():
        outputs = model.generate(**inputs, max_length=100)

    result = tokenizer.decode(outputs[0], skip_special_tokens=True)
    elapsed = (time.time() - start) * 1000

    print(f"\n  [{src_lang}→{tgt_lang}] {elapsed:.0f}ms")
    print(f"    Input:  {text}")
    print(f"    Output: {result}")
EOF
```

### Step 6.2: Generate Summary Report

```bash
# Create final report
cat > ./eval/QUANTIZATION_REPORT.md << 'EOF'
# TranslateGemma-4B Quantization Report

## Configuration
- Model: google/translate-gemma-4b
- Quantization: Q4_K_M (GGUF)
- Method: AutoGPTQ
- Target: Browser deployment
- Date: $(date)

## Results Summary

### Model Size
- Original (FP16): 8.0 GB
- Quantized (Q4): 1.8-2.0 GB
- Compression: 4-5×
- GGUF Compressed: ~400-500 MB (gzipped)

### Quality Metrics
- BLEU Loss: < 1% (excellent)
- Languages Tested: 10
- Acceptable Language Pairs: ✅

### Performance
- Inference Latency (CPU): 150-200 ms/token
- Inference Latency (GPU): 40-50 ms/token
- Memory Required: 2-4 GB
- Browser Load Time: ~30s first use, <1s cached

## Status: HISTORICAL EXPECTED OUTPUT ONLY

This report template does not grant deployment approval. A current run must use the
model target and artifact format selected by MIK-3480.

EOF

cat ./eval/QUANTIZATION_REPORT.md
```

---

## Monitoring & Troubleshooting

### Monitor GPU Usage

```bash
# Terminal 1: Run quantization
python3 scripts/quantize_translate_gemma.py ...

# Terminal 2: Monitor GPU
watch -n 0.5 'nvidia-smi --query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total --format=csv,noheader,nounits'

# Expected: GPU Util >90%, Memory 30-40GB used
```

### Common Issues

**Issue**: `CUDA out of memory`
```bash
# Solution 1: Reduce batch size
--batch_size 2

# Solution 2: Use different GPU
--device cuda:1

# Solution 3: Use CPU (slow but works)
--device cpu
```

**Issue**: `Model download fails`
```bash
# Solution: Use local cache and timeout
export HF_DATASETS_TIMEOUT=600
huggingface-cli download google/translate-gemma-4b --cache-dir ./models/cache --resume-download
```

**Issue**: `BLEU score calculation fails`
```bash
# Solution: Install sacrebleu
pip install sacrebleu

# Or use approximate scoring
python3 scripts/benchmark_quantized.py --use_fallback_bleu
```

---

## Cost Analysis

### DGX Spark (Recommended)

```
Phase 1 (Model prep):      0.5 GPU hours × $98.56/hr = $49.28
Phase 2A (Q4):             1.5 GPU hours × $98.56/hr = $147.84
Phase 3 (Validation):      3.0 GPU hours × $98.56/hr = $295.68
──────────────────────────────────────────────────────
Subtotal (Q4 only):        5.0 GPU hours            = $492.80

With 80% cache discount (accumulated):
Phase 1:                   $49.28 → $12.32
Phase 2A:                  $147.84 → $29.57
Phase 3:                   $295.68 → $59.14
──────────────────────────────────────────────────────
Total (Q4 only):                                    = $101.03

Additional (Q3 stretch):   2.0 GPU hours × $24.64/hr = $49.28
──────────────────────────────────────────────────────
Total (Q4 + Q3):                                    = $150.31
```

### Alternative Cloud Services

| Provider | Q4 Cost | Time |
|----------|---------|------|
| AWS SageMaker | $8-12 | 8-10 hrs |
| Google Cloud GPU | $10-15 | 8-10 hrs |
| Lambda Labs | $5-8 | 7-9 hrs |
| DGX Spark (best) | ~$0.49-1.03 | 7-14 hrs |

---

## Legacy Success Criteria

- **Phase 1 Complete**: Selected model downloads and loads
- **Phase 2A Complete**: Selected quantization method produces the expected artifact size
- **Phase 3 Complete**: BLEU/quality loss stays within the threshold set by MIK-3480
- **Phase 4 Complete**: Artifact conversion succeeds if GGUF is selected
- **Phase 5 Complete**: Browser manifest is generated only for the selected runtime format
- **Phase 6 Complete**: End-to-end tests pass on DGX and in the browser extension

All criteria passing is necessary, but release approval still requires a current browser-extension validation run.

---

## Next Steps After Completion

1. **Upload to CDN**: Push `translate-gemma-4b-q4.gguf.gz` to model CDN
2. **Update Extension**: Reference model URL in extension config
3. **Browser Testing**: Load model in extension and test translations
4. **Performance Testing**: Benchmark in browser (WASM/WebGPU backends)
5. **Release**: Ship with fallback to cloud API during download

---

**Created**: 2026-02-02
**Owner**: @mikko
**Status**: Blocked pending MIK-3480 target selection and a fresh DGX end-to-end run
