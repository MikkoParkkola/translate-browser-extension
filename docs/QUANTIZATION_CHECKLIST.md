# TranslateGemma-4B Quantization Project Checklist

## Pre-Execution Checklist

### Infrastructure Setup
- [ ] DGX Spark access confirmed (mosh/ssh working)
- [ ] NVIDIA GB10 Blackwell GPU available (nvidia-smi shows it)
- [ ] 200GB+ free storage on DGX Spark
- [ ] Network connectivity tested (can download 8GB models)
- [ ] Python 3.11+ available

### Software Requirements
- [ ] Python virtual environment created and activated
- [ ] PyTorch installed with CUDA support (`torch.cuda.is_available()` = True)
- [ ] transformers library installed (>=4.35)
- [ ] bitsandbytes installed
- [ ] auto-gptq installed
- [ ] sacrebleu and evaluate installed for benchmarking

### Repository Setup
- [ ] Clone/access to translate-browser-extension repo
- [ ] Scripts directory exists with .py files
- [ ] Eval directory exists (created scripts/prepare_eval_set.py)
- [ ] Models directory exists (will hold large files)
- [ ] Logs directory exists for tracking

### Documentation
- [ ] Read QUANTIZATION_STRATEGY.md (full technical)
- [ ] Read DGX_QUANTIZATION_RUNBOOK.md (execution steps)
- [ ] Understand success criteria
- [ ] Identified any blockers

---

## Phase 1: Model Preparation

### Model Download (0.5 hours)

- [ ] Created cache directories (`./models/cache`, `./models/quantized`, `./eval`)
- [ ] Set environment variables: `HF_HOME`, `TORCH_HOME`
- [ ] Ran: `huggingface-cli download google/translate-gemma-4b --local-dir ./models/translate-gemma-4b-f16`
- [ ] Model downloaded successfully (~8GB)
- [ ] Verified files exist:
  - [ ] `model.safetensors` (~8GB)
  - [ ] `config.json`
  - [ ] `tokenizer.json`
  - [ ] `generation_config.json`

### Model Verification

- [ ] Loaded model with: `AutoModelForSeq2SeqLM.from_pretrained("./models/translate-gemma-4b-f16")`
- [ ] Model loads without errors
- [ ] Confirmed parameters: 4,000,000,000 (4B)
- [ ] Confirmed FP16 size: ~8.00 GB
- [ ] Tokenizer loads: `AutoTokenizer.from_pretrained("./models/translate-gemma-4b-f16")`
- [ ] Quick inference test passes (test sentence translates)

### GPU Memory Check

- [ ] Ran nvidia-smi before quantization
- [ ] Available VRAM: >40GB (for quantization)
- [ ] Recorded baseline metrics for comparison

---

## Phase 2A: Q4 Quantization

### Environment Setup

- [ ] Method chosen: AutoGPTQ (better for 4-bit)
- [ ] Device: cuda:0 (or alternative if multi-GPU)
- [ ] Output directory prepared: `./models/translate-gemma-4b-q4-gptq`
- [ ] Logging enabled (monitor GPU throughout)

### Quantization Execution

- [ ] Started quantization with:
  ```
  python3 scripts/quantize_translate_gemma.py \
    --model ./models/translate-gemma-4b-f16 \
    --output_dir ./models/translate-gemma-4b-q4-gptq \
    --quantization q4_k_m \
    --bits 4 \
    --method autogptq \
    --device cuda:0
  ```
- [ ] Quantization started (watch GPU usage with nvidia-smi)
- [ ] Monitor progress:
  - [ ] Watched GPU utilization >90%
  - [ ] Watched memory usage 30-40GB
  - [ ] Expected duration: 60-90 minutes
- [ ] Quantization completed without errors
- [ ] Recorded completion time

### Output Verification

- [ ] Checked output files:
  ```
  ls -lh ./models/translate-gemma-4b-q4-gptq/
  ```
- [ ] Files present:
  - [ ] `model.safetensors` or similar (~1.8-2.0 GB)
  - [ ] `config.json`
  - [ ] `tokenizer.json`
  - [ ] `generation_config.json`
  - [ ] `quantization_metadata.json`
- [ ] Model size confirmed: **1.8-2.0 GB** (not exceeding 2.0 GB)
- [ ] Compression ratio: **4.0-4.4×** (8GB → 1.8-2.0 GB)

### Quantized Model Loading Test

- [ ] Loaded quantized model:
  ```
  from transformers import AutoModelForSeq2SeqLM
  model = AutoModelForSeq2SeqLM.from_pretrained("./models/translate-gemma-4b-q4-gptq", device_map="cuda:0")
  ```
- [ ] Model loads successfully
- [ ] Quick inference test: 1 sentence translation works
- [ ] No runtime errors or warnings
- [ ] Memory footprint reasonable (~2.5 GB)

---

## Phase 2B: Q3 Quantization (Optional/Stretch)

Only proceed if Q4 BLEU loss > 2% (unlikely)

- [ ] Decision made: Proceed with Q3? (YES/NO)
- [ ] If YES:
  - [ ] Started Q3 quantization on cuda:1 (separate GPU)
  - [ ] Output directory: `./models/translate-gemma-4b-q3`
  - [ ] Expected size: 1.4-1.5 GB
  - [ ] Completed without errors
  - [ ] Files verified

---

## Phase 3: Quality Validation

### Test Set Preparation

- [ ] Prepared test set:
  ```
  python3 scripts/prepare_eval_set.py \
    --languages en zh es fr de ja ko ar hi ru \
    --samples_per_lang 50 \
    --output ./eval/translate_gemma_test_suite.json \
    --include_edge_cases
  ```
- [ ] Test set created: `./eval/translate_gemma_test_suite.json`
- [ ] Verified test set contents:
  - [ ] 450+ samples (9 language pairs × 50 samples + edge cases)
  - [ ] Includes high-resource languages: en, zh, es, fr, de
  - [ ] Includes low-resource: ar, hi, ru
  - [ ] Includes edge cases: empty, numbers, URLs

### Baseline Model Benchmarking

- [ ] Benchmarked FP16 baseline:
  ```
  python3 scripts/benchmark_quantized.py \
    --model ./models/translate-gemma-4b-f16 \
    --test_set ./eval/translate_gemma_test_suite.json \
    --output_dir ./eval/baseline_results \
    --device cuda:0 \
    --batch_size 4
  ```
- [ ] Baseline benchmarking completed (~90-120 min)
- [ ] Files generated:
  - [ ] `./eval/baseline_results/baseline_results.json`
  - [ ] Contains per-language-pair BLEU scores

### Quantized Model Benchmarking

- [ ] Benchmarked Q4 quantized model against baseline:
  ```
  python3 scripts/benchmark_quantized.py \
    --model ./models/translate-gemma-4b-q4-gptq \
    --baseline ./models/translate-gemma-4b-f16 \
    --test_set ./eval/translate_gemma_test_suite.json \
    --output_dir ./eval/q4_comparison \
    --device cuda:0 \
    --batch_size 4
  ```
- [ ] Q4 benchmarking completed (~90-120 min)
- [ ] Files generated:
  - [ ] `./eval/q4_comparison/baseline_results.json`
  - [ ] `./eval/q4_comparison/quantized_results.json`
  - [ ] `./eval/q4_comparison/comparison.json`

### Quality Analysis

- [ ] Analyzed comparison results:
  ```
  python3 -c "
  import json
  with open('./eval/q4_comparison/comparison.json') as f:
      results = json.load(f)
  print(f\"Mean BLEU Delta: {results['overall_comparison']['mean_bleu_delta_percent']:.2f}%\")
  print(f\"Acceptable: {results['overall_comparison']['acceptable']}\")
  "
  ```
- [ ] Results reviewed:
  - [ ] Mean BLEU loss: **< 1.0%** ✅ (excellent)
  - [ ] Per-language-pair loss: **< 2.0%** ✅
  - [ ] High-resource languages (en,zh,es,fr): **< 0.8%** ✅
  - [ ] Acceptable languages (ar,hi,ru): **< 2.0%** ✅

### GO/NO-GO Decision

- [ ] Decision: **GO with Q4** ✅ (BLEU loss < 1%)
  OR
- [ ] Decision: **RECONSIDER** ⚠️ (if BLEU loss 1-2%)
  - [ ] Review per-language results
  - [ ] Decide if loss acceptable
  - [ ] Consider Q3 as alternative if not acceptable
  OR
- [ ] Decision: **FALLBACK** (if BLEU loss > 2%)
  - [ ] Investigate quantization parameters
  - [ ] Try Q3 quantization
  - [ ] Consider cloud-only fallback

---

## Phase 4: GGUF Conversion (Optional)

Only if deploying to browser/WASM

- [ ] Cloned llama.cpp:
  ```
  git clone https://github.com/ggerganov/llama.cpp.git
  cd llama.cpp && make -j$(nproc)
  ```
- [ ] Built llama.cpp successfully
- [ ] Verified quantize tool: `./llama.cpp/quantize --help`

### Convert to GGUF

- [ ] Converted to GGUF intermediate format (if needed)
- [ ] Quantized to Q4_K_M GGUF:
  ```
  ./llama.cpp/quantize \
    ./models/translate-gemma-4b-q4-intermediate.gguf \
    ./models/translate-gemma-4b-q4.gguf \
    Q4_K_M
  ```
- [ ] GGUF file created: `./models/translate-gemma-4b-q4.gguf`
- [ ] File size verified: **1.8-2.0 GB** ✅
- [ ] File integrity check:
  ```
  file ./models/translate-gemma-4b-q4.gguf
  # Should show: GGUF format
  ```

---

## Phase 5: Browser Deployment Preparation

### Compression

- [ ] Compressed GGUF with gzip:
  ```
  gzip -v ./models/translate-gemma-4b-q4.gguf
  ```
- [ ] Compressed file: `./models/translate-gemma-4b-q4.gguf.gz`
- [ ] Compressed size verified: **300-500 MB** ✅
- [ ] Compression ratio: **3.5-7×** ✅

### Manifest Generation

- [ ] Generated deployment manifest:
  ```
  python3 << 'EOF'
  # (see DGX_QUANTIZATION_RUNBOOK.md Phase 5.2)
  EOF
  ```
- [ ] Manifest file: `./models/manifest.json`
- [ ] Manifest contains:
  - [ ] Model metadata (name, version, quantization)
  - [ ] File information (paths, sizes, SHA256)
  - [ ] Deployment specs (latency, memory, storage)

### Documentation

- [ ] Created README for browser integration
- [ ] Documented model loading strategy
- [ ] Documented inference optimization tips
- [ ] Documented fallback strategy (cloud API during download)

---

## Phase 6: End-to-End Validation

### Functionality Tests

- [ ] Tested basic translations:
  - [ ] [ ] English → Chinese: "Hello" → "你好"
  - [ ] [ ] English → Spanish: "Good morning" → "Buenos días"
  - [ ] [ ] English → French: "Thank you" → "Merci"
  - [ ] [ ] English → German: "Where?" → "Wo?"
- [ ] All translations sensible and in target language

### Performance Tests

- [ ] Measured inference latency:
  - [ ] Single sentence (10 tokens): ~1-2 seconds
  - [ ] Batch (100 tokens): ~10-20 seconds
- [ ] Measured model load time: ~30-45 seconds (first use)
- [ ] Measured memory usage: ~2.5-3.0 GB peak

### Edge Cases

- [ ] Tested edge cases:
  - [ ] [ ] Empty string: Doesn't crash
  - [ ] [ ] Very long text: Properly truncated or batched
  - [ ] [ ] Numbers: Preserved correctly
  - [ ] [ ] URLs/emails: Not corrupted
  - [ ] [ ] Special characters: Handled gracefully
  - [ ] [ ] Multiple sentences: Each translated

### Error Handling

- [ ] Tested error scenarios:
  - [ ] [ ] CUDA out of memory: Falls back gracefully
  - [ ] [ ] Invalid input: Returns sensible error
  - [ ] [ ] Model corruption: Detected early
  - [ ] [ ] Device not available: Falls back to CPU

---

## Final Deliverables

### Code & Models

- [ ] `scripts/quantize_translate_gemma.py` ✅
- [ ] `scripts/benchmark_quantized.py` ✅
- [ ] `scripts/prepare_eval_set.py` ✅
- [ ] `./models/translate-gemma-4b-q4-gptq/` (quantized model) ✅
- [ ] `./models/translate-gemma-4b-q4.gguf` (GGUF format) ✅
- [ ] `./models/translate-gemma-4b-q4.gguf.gz` (compressed) ✅

### Documentation

- [ ] `docs/QUANTIZATION_STRATEGY.md` ✅
- [ ] `docs/QUANTIZATION_EXECUTIVE_SUMMARY.md` ✅
- [ ] `docs/DGX_QUANTIZATION_RUNBOOK.md` ✅
- [ ] `docs/QUANTIZATION_CHECKLIST.md` ✅

### Evaluation Results

- [ ] `./eval/translate_gemma_test_suite.json` (test set)
- [ ] `./eval/baseline_results/baseline_results.json` (FP16 baseline)
- [ ] `./eval/q4_comparison/comparison.json` (Q4 vs baseline)
- [ ] `./eval/QUANTIZATION_REPORT.md` (summary report)

### Git Artifacts

- [ ] Committed scripts to git
- [ ] Committed documentation to git
- [ ] Tagged release version: `v1.0-quantization`
- [ ] Push to remote repository

---

## Sign-Off

### Technical Review

- [ ] **Code review**: Scripts follow best practices ✅
- [ ] **Test coverage**: All paths tested ✅
- [ ] **Documentation**: Clear and complete ✅
- [ ] **Performance**: Meets targets ✅

### Quality Assurance

- [ ] **BLEU validation**: < 1% loss ✅
- [ ] **Model size**: < 2.0 GB ✅
- [ ] **Compression**: > 4× ✅
- [ ] **Browser compatibility**: GGUF format ready ✅

### Production Readiness

- [ ] **Security**: No credentials in code ✅
- [ ] **Error handling**: Comprehensive ✅
- [ ] **Monitoring**: Metrics available ✅
- [ ] **Rollback plan**: Documented ✅

### Sign-Off

- [ ] **Technical Lead Review**: _____________ Date: _______
- [ ] **Project Owner Approval**: _____________ Date: _______
- [ ] **Ready for Browser Integration**: ✅ YES / ❌ NO

---

## Post-Deployment

### Browser Integration

- [ ] Model URL configured in extension
- [ ] Download logic implemented
- [ ] Fallback to cloud API working
- [ ] Progress UI displays correctly
- [ ] Model caching working
- [ ] Inference working in WASM
- [ ] Performance acceptable (<2s per sentence)

### Monitoring

- [ ] Error tracking enabled
- [ ] Performance metrics collected
- [ ] User feedback loop active
- [ ] BLEU scores verified in production

### Rollback Plan (If Needed)

- [ ] Revert to cloud-only API: ___ (documented)
- [ ] Issue fix timeline: ___ (hours)
- [ ] Communication plan: ___ (notify users)

---

## Summary

- **Total GPU Time Used**: _____ hours (est. 5-10)
- **Total Calendar Time**: _____ days (est. 7-14)
- **Total Cost**: _____ (est. $0.49-1.22 on DGX Spark)
- **Quality Achieved**: _____ (BLEU loss: _____%)
- **Status**: ✅ COMPLETE / ⚠️ PARTIAL / ❌ FAILED

**Notes & Observations**:
```
[Space for project notes, lessons learned, improvements for next time]
```

---

**Project**: TranslateGemma-4B Quantization
**Start Date**: _______________
**End Date**: _______________
**Completed By**: _______________
**Reviewed By**: _______________
