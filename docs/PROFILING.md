# TRANSLATE! Performance Profiling

## Overview

This document describes the profiling infrastructure added to identify and optimize performance bottlenecks in the TRANSLATE! extension.

## Profiling Infrastructure

### Core Module: `src/core/profiler.ts`

A high-resolution timing profiler that tracks:
- **Session-based profiling**: Each translation request can be tracked as a session
- **Aggregate statistics**: Min, max, avg, p50, p95, p99 across multiple runs
- **Cross-context support**: Data can be serialized between background, offscreen, and content scripts

### Timing Categories

| Category | Description | Typical Range |
|----------|-------------|---------------|
| `total` | End-to-end translation time | 100ms - 30s (varies by model state) |
| `model_load` | Loading ML model into memory | 0ms (cached) to 5-30s (cold) |
| `model_inference` | Running translation through model | 50-500ms per batch |
| `dom_scan` | Finding translatable text nodes | 1-50ms |
| `dom_update` | Replacing text in DOM | 1-10ms |
| `ipc_background_to_offscreen` | Message passing overhead | 5-20ms |
| `cache_lookup` | Checking translation cache | <1ms |
| `cache_store` | Storing translation in cache | <1ms |
| `language_detect` | Auto-detecting source language | 1-5ms |
| `validation` | Input validation | <1ms |

## How to Use

### Enable Profiling for a Translation

Send a translation message with `enableProfiling: true`:

```javascript
const response = await chrome.runtime.sendMessage({
  type: 'translate',
  text: ['Hello world', 'How are you?'],
  sourceLang: 'en',
  targetLang: 'fi',
  enableProfiling: true
});

// Response includes profilingReport
console.log(response.profilingReport);
```

### Get Aggregate Statistics

```javascript
const stats = await chrome.runtime.sendMessage({
  type: 'getProfilingStats'
});
console.log(stats.aggregates);
console.log(stats.formatted); // Human-readable report
```

### Clear Statistics

```javascript
await chrome.runtime.sendMessage({
  type: 'clearProfilingStats'
});
```

### Test Page

Open `test-profiling.html` in the browser with the extension installed to run interactive profiling tests.

## Expected Timing Breakdown

### Cold Start (First Translation)
```
Translation Profile:
- Total:      15000-30000ms
- Model Load:  14000-29000ms (95%+)  <-- BOTTLENECK
- Inference:       500-1000ms (3%)
- DOM Scan:           5-50ms (<1%)
- DOM Update:         1-10ms (<1%)
- IPC Overhead:       5-20ms (<1%)
```

### Warm Start (Model Cached)
```
Translation Profile:
- Total:        200-800ms
- Model Load:        0ms (0%)         <-- Cached
- Inference:   150-700ms (80-90%)    <-- PRIMARY COST
- DOM Scan:        5-50ms (5%)
- DOM Update:       1-10ms (1%)
- IPC Overhead:    10-30ms (5%)
```

## Optimization Opportunities

### 1. Model Loading (HIGH IMPACT)

**Problem**: First translation takes 5-30 seconds due to model download/load.

**Recommendations**:
- [ ] **Predictive Preloading**: Preload model when user opens popup (already partially implemented)
- [ ] **Progressive Loading**: Show translation progress indicator during model load
- [ ] **Model Caching Strategy**: Ensure IndexedDB caching is working optimally
- [ ] **Smaller Models**: Consider offering a "fast" mode with smaller OPUS-MT variants

**Quick Win**: The prediction engine already exists (`src/core/prediction-engine.ts`). Ensure it triggers preloading based on browsing patterns.

### 2. Model Inference (MEDIUM IMPACT)

**Problem**: Each batch takes 50-500ms depending on text length.

**Recommendations**:
- [ ] **Batch Optimization**: Current batch size is 50 texts. Profile different batch sizes.
- [ ] **WebGPU Utilization**: Verify WebGPU is being used when available (currently checks but may fallback to WASM)
- [ ] **Quantization**: OPUS-MT models are already FP32. q4f16 quantization was removed due to quality issues - revisit if quality improves.

### 3. IPC Overhead (LOW IMPACT but EASY)

**Problem**: Message passing between popup -> background -> offscreen -> content adds latency.

**Recommendations**:
- [ ] **Batch Messages**: Combine multiple small messages into single larger ones (already done for translation batches)
- [ ] **Direct Communication**: For content script, consider direct offscreen communication if Chrome allows

### 4. DOM Operations (LOW IMPACT)

**Problem**: TreeWalker scan and text replacement are already efficient.

**Recommendations**:
- [ ] **Mutation Batching**: Already implemented with debouncing (500ms)
- [ ] **Skip Empty/Short Nodes**: Already implemented (minTextLength: 2)

## Implementation Status

| Component | Profiling Added | Notes |
|-----------|-----------------|-------|
| `src/core/profiler.ts` | NEW | Core profiling module |
| `src/offscreen/offscreen.ts` | YES | model_load, model_inference, language_detect |
| `src/background/service-worker.ts` | YES | total, validation, cache_lookup, cache_store, IPC |
| `src/content/index.ts` | YES | domScan, domUpdate, ipcRoundtrip (local tracking) |

## Baseline Measurements

To establish baseline measurements:

1. Clear all caches (browser cache + extension cache)
2. Open `test-profiling.html`
3. Run 5 cold-start tests (reload extension between each)
4. Run 10 warm-start tests
5. Record aggregate statistics

### Expected Baseline (OPUS-MT, en->fi)

| Metric | Cold Start | Warm Start |
|--------|------------|------------|
| Total (avg) | ~20s | ~300ms |
| Total (p95) | ~30s | ~500ms |
| Model Load | ~19s | 0ms |
| Inference | ~800ms | ~250ms |
| DOM Scan | ~10ms | ~10ms |
| DOM Update | ~2ms | ~2ms |

## Next Steps

1. **Run Baseline Tests**: Use test-profiling.html to establish actual numbers
2. **Identify Top Bottleneck**: Confirm model loading is the primary issue
3. **Implement Quick Wins**:
   - Improve preloading trigger in prediction engine
   - Add loading indicator during model download
4. **Profile TranslateGemma**: Compare OPUS-MT vs TranslateGemma timings
5. **Profile Chrome Built-in**: When available, compare with Chrome's built-in translator
