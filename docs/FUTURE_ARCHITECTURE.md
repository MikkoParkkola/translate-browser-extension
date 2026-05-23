# Translate Extension: Future Architecture Design

> **Vision**: A local-first, provider-diverse browser translation extension with fast UX and clear user control.

## Executive Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRANSLATION EXTENSION v2.0                    │
├─────────────────────────────────────────────────────────────────┤
│  LOCAL MODELS          │  CLOUD PROVIDERS      │  USER CONTROL  │
│  ─────────────         │  ───────────────      │  ────────────  │
│  • OPUS-MT (50MB)      │  • DeepL Pro          │  • Pick models │
│  • NLLB-200 (300MB)    │  • OpenAI GPT-4       │  • Set quality │
│  • TranslateGemma-4B   │  • Anthropic Claude   │  • Cost limits │
│    (500MB quantized)   │  • Google Cloud       │  • Privacy     │
│                        │  • Qwen MT            │                │
│  WebGPU Accelerated    │  API Key Management   │  Per-site rules│
└─────────────────────────────────────────────────────────────────┘
```

## 0. 2026-05 Browser AI API Review

This document is a future-roadmap snapshot, not the current shipped runtime contract. The canonical current architecture is `docs/ARCHITECTURE.md`; use this document for roadmap direction only.

### 0.1 Evidence Checked

- Chrome built-in AI API status and overview: <https://developer.chrome.com/docs/ai/built-in-apis>
- Chrome Translator API: <https://developer.chrome.com/docs/ai/translator-api>
- Chrome Prompt API: <https://developer.chrome.com/docs/ai/prompt-api>
- Chrome Summarizer API: <https://developer.chrome.com/docs/ai/summarizer-api>
- MDN Translator and Language Detector APIs: <https://developer.mozilla.org/en-US/docs/Web/API/Translator_and_Language_Detector_APIs>
- MDN Summarizer API: <https://developer.mozilla.org/en-US/docs/Web/API/Summarizer_API>
- MDN WebGPU API: <https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API>
- WebKit Safari 26.0 feature notes: <https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>

### 0.2 Direction Status Matrix

| Direction | Original precondition | 2026-05 status | Roadmap action |
|-----------|-----------------------|----------------|----------------|
| Chrome native translation and language detection | Browser exposes local Translator and LanguageDetector APIs | Achievable and partly shipped. Chrome lists Translator and Language Detector as Chrome 138 stable, and the repo ships `chrome-builtin`; the main-world path still needs source-language auto-detection parity. | Treat `chrome-builtin` as the primary Chrome-native path. Follow-up filed as MIK-3470. |
| Prompt API as a generic local LLM provider | Browser exposes an on-device prompt-capable model to extensions/pages | Achievable only as a Chrome-specific experiment. Chrome extension support starts at Chrome 138, broader web availability is later and hardware/storage gated. | Prototype only for adjunct workflows; do not replace dedicated translation providers. |
| Summarization / page understanding | Browser exposes a built-in summarizer | Achievable in Chrome, but MDN still marks the API limited availability and experimental. It is not a core translation dependency. | Keep as optional product exploration, not a translation runtime dependency. |
| Firefox native browser AI provider | Firefox exposes a stable built-in translation or prompt API to extensions | Blocked for this roadmap. MDN marks Translator/Language Detector limited availability and not Baseline, and the repo's Firefox path remains background page plus OPUS-MT, TranslateGemma, or cloud providers. | Continue Firefox support through existing local/cloud provider paths. |
| Safari native browser AI provider | Safari exposes a compatible Translator, LanguageDetector, Prompt, or Summarizer API | Speculative. WebKit's Safari 26.0 notes include WebGPU and WebExtensions updates, but no compatible built-in translation/prompt API in the sources checked. | If Safari support is added, start with WebGPU/local providers and feature detection, not a Safari-native AI provider. |
| WebGPU local inference | Browser exposes enough WebGPU for model inference | Achievable but still feature-gated. Safari 26.0 ships WebGPU and Transformers.js is listed among working frameworks, while MDN still marks WebGPU limited availability. | Keep WebGPU acceleration behind detection with WASM fallback. |
| NLLB-200 local fallback | Browser model storage, quantization, and runtime quality are acceptable | Speculative for production. Storage, quantization quality, and startup cost remain product risks. | Keep as research until a measured browser package exists. |
| TranslateGemma local premium path | Quantized model can fit browser storage and run acceptably with WebGPU/WebNN | Experimental. The repo treats TranslateGemma as experimental, and this document's size/performance targets still need measured evidence. | Keep experimental; require a measured evaluation before promotion. |
| Ollama / native helper path | Users accept native messaging or local helper setup | Product/security blocked. This is outside the browser-only extension contract and overlaps MIK-3467. | Defer until the native-helper vs browser-only architecture decision is resolved. |

### 0.3 Current Shipped Baseline

The shipped provider baseline has moved since this document was written:

- Stable Chrome paths: `chrome-builtin`, `opus-mt`, and configured cloud providers.
- Stable Firefox paths: `opus-mt` and configured cloud providers; Firefox does not ship `chrome-builtin`.
- Experimental path: `translategemma`.
- Roadmap-only paths in this document: `nllb-200`, `ollama`, broad Prompt API routing, and Safari-native browser AI.

## 1. Architecture Overview

### 1.1 Core Components

```
┌────────────────────────────────────────────────────────────────────┐
│                         EXTENSION CORE                              │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│  │   Content   │    │ Background  │    │   Popup/    │            │
│  │   Script    │───▶│   Service   │◀───│  Settings   │            │
│  │             │    │   Worker    │    │             │            │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘            │
│         │                  │                                       │
│         ▼                  ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   TRANSLATION ROUTER                         │  │
│  │  • Language Detection → Best Provider Selection              │  │
│  │  • Quality/Speed/Cost Optimization                           │  │
│  │  • Failover & Retry Logic                                    │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │                                      │
│         ┌───────────────────┼───────────────────┐                 │
│         ▼                   ▼                   ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐           │
│  │   LOCAL     │    │   CLOUD     │    │   HYBRID    │           │
│  │   ENGINE    │    │   ENGINE    │    │   ENGINE    │           │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘           │
│         │                  │                  │                   │
│         ▼                  ▼                  ▼                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    PROVIDER REGISTRY                         │ │
│  │  Local: OPUS-MT │ NLLB │ TranslateGemma │ Ollama            │ │
│  │  Cloud: DeepL │ OpenAI │ Anthropic │ Google │ Qwen │ ...    │ │
│  └─────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
User views page
     │
     ▼
┌─────────────────┐
│ Content Script  │ Scans DOM, extracts text nodes
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Text Batcher    │ Groups by ~2000 tokens, dedupes
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cache Check     │ Hit? Return cached. Miss? Continue.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Language Detect │ Source lang detection (local or API)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Router Decision │ Pick best provider for this request
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌──────┐  ┌──────┐
│Local │  │Cloud │  Execute translation
└──┬───┘  └──┬───┘
   │         │
   └────┬────┘
        ▼
┌─────────────────┐
│ Cache Store     │ Save result for future
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ DOM Update      │ Replace text, animate transition
└─────────────────┘
```

## 2. Local Model Strategy

### 2.1 Model Tiers

| Tier | Model | Size (Quantized) | Languages | Speed | Quality | Use Case |
|------|-------|------------------|-----------|-------|---------|----------|
| **1** | OPUS-MT | 30-50MB/pair | 1000+ pairs | ⚡⚡⚡ | ★★★★ | Default for known pairs |
| **2** | NLLB-200-600M | 150-300MB | 200 | ⚡⚡ | ★★★★ | Rare language fallback |
| **3** | TranslateGemma-4B | 500MB-1GB | 55 | ⚡ | ★★★★★ | Premium local quality |
| **4** | Ollama (local) | Varies | Varies | ⚡ | ★★★★★ | Power user custom models |

> **2026-05 review status**: OPUS-MT is shipped; TranslateGemma is experimental; NLLB-200 and Ollama remain roadmap-only. This older local-model table omits `chrome-builtin`, which is now a primary Chrome runtime path but is browser-managed rather than extension-managed model storage.

### 2.2 Quantization Strategy (DGX Spark)

We'll quantize models on DGX Spark for optimal browser deployment:

```bash
# Quantization targets
┌────────────────────────────────────────────────────────────────┐
│ Model              │ Original │ INT8   │ INT4/Q4 │ Target     │
├────────────────────────────────────────────────────────────────┤
│ TranslateGemma-4B  │ ~8GB     │ ~4GB   │ ~2GB    │ <1GB       │
│ NLLB-200-600M      │ ~2.4GB   │ ~1.2GB │ ~600MB  │ <300MB     │
│ OPUS-MT pairs      │ ~300MB   │ ~150MB │ ~75MB   │ <50MB      │
└────────────────────────────────────────────────────────────────┘

# Quantization pipeline on DGX Spark
1. Convert to ONNX format
2. Apply dynamic quantization (INT8)
3. Apply weight-only quantization (INT4/Q4)
4. Optimize for WebGPU execution
5. Test quality degradation (< 2% BLEU drop acceptable)
6. Package for extension distribution
```

### 2.3 Model Storage Architecture

```
IndexedDB Schema:
├── models/
│   ├── opus-mt-en-fi/
│   │   ├── config.json
│   │   ├── model.onnx (quantized)
│   │   └── tokenizer.json
│   ├── opus-mt-fi-en/
│   ├── nllb-200-distilled/
│   └── translategemma-4b-q4/
├── cache/
│   └── translations/ (LRU cache, 100MB limit)
└── metadata/
    └── model-registry.json
```

### 2.4 Progressive Model Loading

```javascript
// Model loading strategy
class ModelLoader {
  async getTranslator(sourceLang, targetLang) {
    // 1. Check if specific OPUS-MT pair exists (smallest, fastest)
    const opusPair = `opus-mt-${sourceLang}-${targetLang}`;
    if (await this.modelExists(opusPair)) {
      return this.loadModel(opusPair); // ~50MB, instant
    }

    // 2. Check if NLLB is loaded (medium, multilingual)
    if (await this.modelExists('nllb-200')) {
      return this.loadModel('nllb-200'); // ~300MB, already cached
    }

    // 3. Check if TranslateGemma is available (large, best quality)
    if (await this.modelExists('translategemma-4b')) {
      return this.loadModel('translategemma-4b'); // ~1GB, premium
    }

    // 4. Fallback to cloud or prompt user to download
    return this.getCloudProvider();
  }
}
```

## 3. WebGPU Acceleration

> **2026-05 review status**: WebGPU acceleration is achievable but must stay behind feature detection with a WASM fallback. Browser support has improved, including Safari 26.0, but MDN still marks WebGPU limited availability.

### 3.1 WebGPU Integration

```javascript
// WebGPU detection and setup
class WebGPUAccelerator {
  constructor() {
    this.adapter = null;
    this.device = null;
    this.supported = false;
  }

  async initialize() {
    if (!navigator.gpu) {
      console.log('WebGPU not supported, falling back to WASM');
      return false;
    }

    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });

    if (!this.adapter) {
      return false;
    }

    this.device = await this.adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: 1024 * 1024 * 1024, // 1GB for large models
        maxBufferSize: 1024 * 1024 * 1024,
      }
    });

    this.supported = true;
    return true;
  }

  getExecutionProvider() {
    return this.supported ? 'webgpu' : 'wasm';
  }
}
```

### 3.2 Transformers.js with WebGPU

```javascript
import { pipeline, env } from '@huggingface/transformers';

// Configure for WebGPU
env.backends.onnx.wasm.numThreads = 4;

class LocalTranslator {
  constructor() {
    this.pipelines = new Map();
    this.webgpu = new WebGPUAccelerator();
  }

  async initialize() {
    await this.webgpu.initialize();
  }

  async getTranslationPipeline(modelId) {
    if (this.pipelines.has(modelId)) {
      return this.pipelines.get(modelId);
    }

    const pipe = await pipeline('translation', modelId, {
      device: this.webgpu.getExecutionProvider(), // 'webgpu' or 'wasm'
      dtype: 'q4', // Use quantized weights
      progress_callback: (progress) => {
        this.emitProgress(modelId, progress);
      }
    });

    this.pipelines.set(modelId, pipe);
    return pipe;
  }

  async translate(text, sourceLang, targetLang) {
    const modelId = this.selectModel(sourceLang, targetLang);
    const pipe = await this.getTranslationPipeline(modelId);

    const result = await pipe(text, {
      src_lang: sourceLang,
      tgt_lang: targetLang,
      max_length: 512,
    });

    return result[0].translation_text;
  }
}
```

### 3.3 Performance Targets

| Scenario | WASM (CPU) | WebGPU (GPU) | Target |
|----------|------------|--------------|--------|
| OPUS-MT single sentence | ~50ms | ~10ms | <20ms |
| OPUS-MT paragraph | ~200ms | ~30ms | <50ms |
| NLLB-200 sentence | ~150ms | ~25ms | <50ms |
| TranslateGemma sentence | ~500ms | ~80ms | <150ms |
| Full page (100 segments) | ~5s | ~1s | <2s |

## 4. Provider Ecosystem

> **2026-05 review status**: The registry below is aspirational. Current shipped provider truth lives in `docs/ARCHITECTURE.md` and `docs/PROVIDERS.md`. Any future registry model should include `chrome-builtin` as a first-class Chrome-only local provider and should mark `nllb-200`, `ollama`, and `qwen-mt` as unshipped unless implemented.

### 4.1 Unified Provider Interface

```typescript
// types/provider.d.ts
interface TranslationProvider {
  id: string;
  name: string;
  type: 'local' | 'cloud' | 'hybrid';

  // Capabilities
  supportedLanguages: LanguagePair[];
  supportsStreaming: boolean;
  supportsDetection: boolean;
  supportsBatch: boolean;
  maxBatchSize: number;
  maxTextLength: number;

  // Quality/Cost
  qualityTier: 'basic' | 'standard' | 'premium';
  costPerMillion: number; // 0 for local

  // Methods
  translate(request: TranslationRequest): Promise<TranslationResult>;
  detectLanguage(text: string): Promise<string>;
  isAvailable(): Promise<boolean>;
  // Optional provider-local diagnostics/cost snapshot.
  // Extension-level background diagnostics are queried separately.
  getUsage?(): Promise<UsageStats>;
}

interface TranslationRequest {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: {
    formality?: 'formal' | 'informal';
    preserveFormatting?: boolean;
    glossary?: Record<string, string>;
  };
}
```

### 4.2 Provider Registry

```javascript
// providers/registry.js
const PROVIDER_REGISTRY = {
  // === LOCAL PROVIDERS (FREE) ===
  'opus-mt': {
    id: 'opus-mt',
    name: 'Helsinki-NLP OPUS-MT',
    type: 'local',
    qualityTier: 'standard',
    costPerMillion: 0,
    icon: '🇫🇮',
    description: 'Fast, lightweight models for specific language pairs',
    modelSize: '30-50MB per pair',
    speed: 'fastest',
  },

  'nllb-200': {
    id: 'nllb-200',
    name: 'Meta NLLB-200',
    type: 'local',
    qualityTier: 'standard',
    costPerMillion: 0,
    icon: '🌍',
    description: '200 languages in one model',
    modelSize: '~300MB quantized',
    speed: 'fast',
  },

  'translategemma': {
    id: 'translategemma',
    name: 'Google TranslateGemma',
    type: 'local',
    qualityTier: 'premium',
    costPerMillion: 0,
    icon: '💎',
    description: 'Best quality local model (55 languages)',
    modelSize: '~1GB quantized',
    speed: 'medium',
  },

  'ollama': {
    id: 'ollama',
    name: 'Ollama (Local LLM)',
    type: 'local',
    qualityTier: 'premium',
    costPerMillion: 0,
    icon: '🦙',
    description: 'Use any Ollama model for translation',
    modelSize: 'varies',
    speed: 'varies',
  },

  // === CLOUD PROVIDERS (PAID) ===
  'deepl-free': {
    id: 'deepl-free',
    name: 'DeepL Free',
    type: 'cloud',
    qualityTier: 'premium',
    costPerMillion: 0, // 500K chars/month free
    icon: '🔷',
    limit: 500000,
  },

  'deepl-pro': {
    id: 'deepl-pro',
    name: 'DeepL Pro',
    type: 'cloud',
    qualityTier: 'premium',
    costPerMillion: 20,
    icon: '💠',
  },

  'openai': {
    id: 'openai',
    name: 'OpenAI GPT-4',
    type: 'cloud',
    qualityTier: 'premium',
    costPerMillion: 30,
    icon: '🤖',
  },

  'anthropic': {
    id: 'anthropic',
    name: 'Anthropic Claude',
    type: 'cloud',
    qualityTier: 'premium',
    costPerMillion: 25,
    icon: '🧠',
  },

  'google': {
    id: 'google',
    name: 'Google Cloud Translation',
    type: 'cloud',
    qualityTier: 'standard',
    costPerMillion: 20,
    icon: '🔵',
  },

  'qwen-mt': {
    id: 'qwen-mt',
    name: 'Alibaba Qwen MT',
    type: 'cloud',
    qualityTier: 'standard',
    costPerMillion: 5,
    icon: '☁️',
  },
};
```

### 4.3 Intelligent Router

```javascript
// core/translation-router.js
class TranslationRouter {
  constructor(userPreferences) {
    this.preferences = userPreferences;
    this.providers = new Map();
    this.stats = new ProviderStats();
  }

  async selectProvider(request) {
    const { sourceLang, targetLang, text } = request;
    const prefs = this.preferences;

    // Build candidate list based on user preferences
    const candidates = this.getCandidates(sourceLang, targetLang)
      .filter(p => this.meetsConstraints(p, prefs))
      .sort((a, b) => this.scoreProvider(a, request) - this.scoreProvider(b, request));

    // Return best candidate
    for (const provider of candidates) {
      if (await provider.isAvailable()) {
        return provider;
      }
    }

    throw new Error('No available translation provider');
  }

  scoreProvider(provider, request) {
    const prefs = this.preferences;
    let score = 0;

    // Quality preference (0-100)
    if (prefs.prioritize === 'quality') {
      score += provider.qualityTier === 'premium' ? 100 : 50;
    }

    // Speed preference
    if (prefs.prioritize === 'speed') {
      score += provider.type === 'local' ? 100 : 30;
    }

    // Cost preference
    if (prefs.prioritize === 'cost') {
      score += provider.costPerMillion === 0 ? 100 : (100 - provider.costPerMillion);
    }

    // Privacy preference
    if (prefs.preferLocal) {
      score += provider.type === 'local' ? 50 : 0;
    }

    // Historical success rate
    score += this.stats.getSuccessRate(provider.id) * 20;

    // Language pair specialization
    if (this.isSpecializedForPair(provider, request.sourceLang, request.targetLang)) {
      score += 30;
    }

    return score;
  }
}
```

## 5. User Settings & Preferences

### 5.1 Settings Schema

```javascript
const DEFAULT_SETTINGS = {
  // Translation behavior
  translation: {
    defaultTargetLang: 'en',
    autoDetectSource: true,
    translateOnLoad: false,
    translateSelection: true,
    showOriginalOnHover: true,
    bilingualMode: false,
  },

  // Provider preferences
  providers: {
    prioritize: 'balanced', // 'quality' | 'speed' | 'cost' | 'balanced'
    preferLocal: true,
    enabledProviders: ['opus-mt', 'nllb-200', 'deepl-free'],
    providerOrder: ['opus-mt', 'nllb-200', 'translategemma', 'deepl-free'],
    apiKeys: {
      // Encrypted storage
      deepl: null,
      openai: null,
      anthropic: null,
      google: null,
    },
  },

  // Local models
  localModels: {
    autoDownload: false,
    maxStorageGB: 2,
    downloadedModels: [],
    preferredModels: {
      'en-fi': 'opus-mt-en-fi',
      'fi-en': 'opus-mt-fi-en',
      'default': 'nllb-200',
    },
  },

  // Performance
  performance: {
    useWebGPU: true,
    batchSize: 50,
    maxConcurrent: 3,
    cacheSize: 100, // MB
  },

  // UI
  ui: {
    theme: 'auto',
    showProgressIndicator: true,
    animateTransitions: true,
    compactMode: false,
  },

  // Per-site rules
  siteRules: {
    // 'example.com': { autoTranslate: true, provider: 'deepl-pro' }
  },
};
```

### 5.2 Settings UI (Options Page)

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️  Translation Settings                              [×]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📊 Translation Priority                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ⚡ Speed    ◉ ○ ○ ○ ○  💎 Quality                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  🔒 Privacy Mode                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  [✓] Prefer local models (no data sent to cloud)        │   │
│  │  [✓] Cache translations locally                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  📦 Local Models                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  OPUS-MT Finnish     ✅ Installed (45MB)    [Remove]    │   │
│  │  OPUS-MT Swedish     ✅ Installed (48MB)    [Remove]    │   │
│  │  NLLB-200            ⬇️ Download (300MB)    [Install]   │   │
│  │  TranslateGemma-4B   ⬇️ Download (1GB)      [Install]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Storage used: 93MB / 2GB                                       │
│                                                                 │
│  ☁️ Cloud Providers                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  DeepL Free          ✅ Connected   [••••••]  [Edit]    │   │
│  │  OpenAI              ⚪ Not configured        [Add Key] │   │
│  │  Anthropic           ⚪ Not configured        [Add Key] │   │
│  │  Qwen MT             ✅ Connected   [••••••]  [Edit]    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  🎯 Provider Priority (drag to reorder)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. ≡ 🇫🇮 OPUS-MT (local)                                │   │
│  │  2. ≡ 🌍 NLLB-200 (local)                                │   │
│  │  3. ≡ 🔷 DeepL Free (500K chars/mo)                      │   │
│  │  4. ≡ 💎 TranslateGemma (local, premium)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                              [Save Settings]  [Reset Defaults]  │
└─────────────────────────────────────────────────────────────────┘
```

## 6. Implementation Roadmap

> **2026-05 review status**: These phases are historical planning notes, not the active delivery plan. Achieved or partly achieved areas include Chrome native translation, OPUS-MT local translation, WebGPU detection, and cloud-provider configuration. NLLB-200, Ollama, DGX Spark quantization, and production TranslateGemma promotion remain future work.

### Phase 1: Foundation (Week 1-2) - FAST & CHEAP
**Goal**: Working local translation with OPUS-MT

```
Tasks:
├── [ ] Clean up repo (remove 15+ backup files)
├── [ ] Refactor provider interface (unified API)
├── [ ] Integrate Transformers.js + OPUS-MT
│   ├── [ ] EN↔FI pair (your market)
│   ├── [ ] EN↔DE, EN↔FR, EN↔ES (popular)
│   └── [ ] Add model download UI
├── [ ] Implement WebGPU detection + fallback
├── [ ] Basic settings page for provider selection
└── [ ] Test on 10 representative websites

Deliverable: Extension that translates using OPUS-MT locally
Cost: ~$10-20 in API calls for testing
```

### Phase 2: Multilingual (Week 3-4)
**Goal**: Full language coverage with NLLB fallback

```
Tasks:
├── [ ] Quantize NLLB-200-600M on DGX Spark
│   ├── [ ] ONNX conversion
│   ├── [ ] INT4 quantization
│   └── [ ] WebGPU optimization
├── [ ] Implement progressive model loading
├── [ ] Add model storage management
├── [ ] Language detection (local, using NLLB)
└── [ ] Automatic model download prompts

Deliverable: 200-language support with local models
Cost: DGX Spark time (~$5-10)
```

### Phase 3: Premium Quality (Week 5-6)
**Goal**: TranslateGemma for high-quality translation

```
Tasks:
├── [ ] Quantize TranslateGemma-4B on DGX Spark
│   ├── [ ] Test INT8 vs INT4 quality
│   ├── [ ] Target: <1GB final size
│   └── [ ] WebGPU shader optimization
├── [ ] Implement quality comparison mode
├── [ ] Add "Premium" translation option
└── [ ] Performance profiling + optimization

Deliverable: Premium local translation matching cloud quality
Cost: DGX Spark time (~$10-20)
```

### Phase 4: Cloud Integration (Week 7-8)
**Goal**: Full provider ecosystem

```
Tasks:
├── [ ] Implement cloud providers
│   ├── [ ] DeepL (existing, refactor)
│   ├── [ ] OpenAI GPT-4
│   ├── [ ] Anthropic Claude
│   ├── [ ] Google Cloud Translation
│   └── [ ] Ollama (local LLM)
├── [ ] API key management (secure storage)
├── [ ] Usage tracking + cost monitoring
├── [ ] Smart routing based on preferences
└── [ ] Per-site provider rules

Deliverable: Full provider diversity
Cost: ~$50 in API testing
```

### Phase 5: UX Polish (Week 9-10)
**Goal**: Beautiful, production-ready UX

```
Tasks:
├── [ ] Bilingual display mode
├── [ ] Floating translation pill
├── [ ] Keyboard shortcuts
├── [ ] Animation polish
├── [ ] Dark mode
├── [ ] Accessibility audit
├── [ ] Performance optimization
└── [ ] Chrome Web Store preparation

Deliverable: Production-ready extension
Cost: ~$20 in testing
```

## 7. Technical Specifications

### 7.1 Model Quantization Pipeline (DGX Spark)

```bash
#!/bin/bash
# quantize-model.sh - Run on DGX Spark

MODEL=$1  # e.g., "google/translategemma-4b-it"
OUTPUT_DIR="./quantized-models"

# Step 1: Export to ONNX
python -m optimum.exporters.onnx \
  --model $MODEL \
  --task translation \
  --opset 17 \
  $OUTPUT_DIR/onnx/

# Step 2: Quantize to INT4 (GPTQ-style for best WebGPU perf)
python quantize.py \
  --model $OUTPUT_DIR/onnx/ \
  --output $OUTPUT_DIR/q4/ \
  --bits 4 \
  --group_size 128 \
  --calibration_samples 512

# Step 3: Optimize for WebGPU
python optimize_webgpu.py \
  --model $OUTPUT_DIR/q4/ \
  --output $OUTPUT_DIR/final/ \
  --target webgpu

# Step 4: Validate quality
python validate_quality.py \
  --original $MODEL \
  --quantized $OUTPUT_DIR/final/ \
  --test_set flores200 \
  --max_bleu_drop 2.0

echo "Final model size: $(du -sh $OUTPUT_DIR/final/)"
```

### 7.2 File Size Targets

| Model | Original | Target | Compression |
|-------|----------|--------|-------------|
| OPUS-MT (per pair) | 300MB | <50MB | 6× |
| NLLB-200-600M | 2.4GB | <300MB | 8× |
| TranslateGemma-4B | 8GB | <1GB | 8× |

### 7.3 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| First translation | <500ms | Time from click to result |
| Subsequent translations | <100ms | Cached model, WebGPU |
| Full page (100 nodes) | <3s | Parallel batching |
| Model load time | <2s | From IndexedDB |
| Memory usage | <500MB | During translation |

## 8. Competitive Advantages

### What Makes This Better Than Google Translate:

| Feature | Google Translate | Our Extension |
|---------|-----------------|---------------|
| **Privacy** | ❌ All text to Google | ✅ Local-first |
| **Offline** | ❌ No | ✅ Full offline |
| **Auth pages** | ❌ Can't access | ✅ Works everywhere |
| **JS-heavy sites** | ❌ Breaks often | ✅ MutationObserver |
| **Streaming** | ❌ No | ✅ Real-time |
| **Provider choice** | ❌ Google only | ✅ 10+ providers |
| **Cost** | Free (data is payment) | Free + premium options |
| **Quality** | Good | Configurable (up to best) |

### What Makes This Better Than DeepL:

| Feature | DeepL Extension | Our Extension |
|---------|----------------|---------------|
| **Languages** | 31 | 200+ |
| **Local models** | ❌ No | ✅ Yes |
| **Free tier** | 500K chars | Unlimited (local) |
| **Provider choice** | DeepL only | 10+ providers |
| **Open source** | ❌ No | ✅ Yes |

## 9. Cost Summary

### Development Cost

| Phase | DGX Spark | API Testing | Total |
|-------|-----------|-------------|-------|
| Phase 1 | $0 | $20 | $20 |
| Phase 2 | $10 | $10 | $20 |
| Phase 3 | $20 | $10 | $30 |
| Phase 4 | $0 | $50 | $50 |
| Phase 5 | $0 | $20 | $20 |
| **Total** | **$30** | **$110** | **$140** |

### User Cost (After Launch)

| Usage | Cost |
|-------|------|
| Local models only | **$0** |
| DeepL Free | $0 (500K chars/mo) |
| Light cloud usage | ~$1-5/mo |
| Heavy cloud usage | ~$10-20/mo |

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Install rate | 10K in 3 months | Chrome Web Store |
| Daily active users | 30% of installs | Analytics |
| Local translation % | >80% | Usage stats |
| Average rating | >4.5 stars | Store reviews |
| Translation quality | >95% user satisfaction | Feedback |

---

*Document Version: 1.1*
*Author: Claude + Mikko*
*Last reviewed: 2026-05-12 for MIK-3338*
