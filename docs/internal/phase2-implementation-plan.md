# Phase 2 Implementation Plan - Detailed Steps

## Phase 2A: PDF Engine Optimization (PRIORITY 1)

### Current PDF Engine Architecture Issues

**Multiple Engines Loaded Simultaneously**:
- MuPDF (9.3MB WASM + wrapper)  
- PDFium (5.5MB WASM + wrapper)
- PDF.js (308KB + 1MB worker)
- Supporting libraries: HarfBuzz (340KB), ICU4X (398KB)
- **Total**: ~19MB for PDF functionality used by <10% of users

### Implementation Strategy

#### Step 1: User-Selectable PDF Engine
Create settings UI for PDF engine selection:

```javascript
// In popup/settings.js - Add PDF Engine selector
const pdfEngineOptions = [
  { value: 'none', label: 'Disabled (Fastest)', size: '0MB' },
  { value: 'pdfjs', label: 'PDF.js (Standard)', size: '1.3MB' },
  { value: 'mupdf', label: 'MuPDF (Advanced)', size: '9.3MB' },
  { value: 'pdfium', label: 'PDFium (Precise)', size: '5.5MB' }
];
```

#### Step 2: Dynamic PDF Engine Loading
Modify the PDF loading system:

```javascript
// New file: src/pdf-engine-manager.js
class PDFEngineManager {
  constructor() {
    this.loadedEngine = null;
    this.engineConfig = null;
  }

  async loadEngine(engineType) {
    if (this.loadedEngine?.type === engineType) return this.loadedEngine;
    
    switch (engineType) {
      case 'pdfjs':
        return this.loadPDFJS();
      case 'mupdf':
        return this.loadMuPDF();
      case 'pdfium':
        return this.loadPDFium();
      default:
        return null;
    }
  }

  async loadPDFJS() {
    const [pdfLib, worker] = await Promise.all([
      import('./pdf.min.js'),
      import('./pdf.worker.min.js')
    ]);
    
    this.loadedEngine = { type: 'pdfjs', lib: pdfLib, worker };
    return this.loadedEngine;
  }
  
  // Similar for other engines...
}
```

#### Step 3: Conditional PDF Asset Loading
Update manifest.json to exclude PDF assets by default:

```json
{
  "web_accessible_resources": [
    {
      "resources": [
        "pdfViewer.html",
        "styles/*.css"
      ],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Assets loaded dynamically based on user preference.

### Expected Results
- **Default bundle**: 2-3MB (no PDF engines)
- **With PDF.js**: 4-5MB  
- **With MuPDF**: 12-13MB
- **85%+ users**: 15MB+ savings (use default/no PDF)

## Phase 2B: Provider Lazy Loading (PRIORITY 2)

### Current Provider Loading Issues

**All Providers Loaded Upfront**:
```javascript
// background.js line 1 - loads ALL providers
importScripts('providers/openai.js', 'providers/openrouter.js', 'providers/deepl.js', 
             'providers/dashscope.js', 'providers/mistral.js', ...)
```

### Implementation Strategy

#### Step 1: Convert to Dynamic Provider Loading
Replace importScripts with dynamic imports:

```javascript
// Modified background.js
class ProviderLoader {
  constructor() {
    this.loadedProviders = new Map();
    this.loadingPromises = new Map();
  }

  async loadProvider(providerName) {
    if (this.loadedProviders.has(providerName)) {
      return this.loadedProviders.get(providerName);
    }

    if (this.loadingPromises.has(providerName)) {
      return this.loadingPromises.get(providerName);
    }

    const loadPromise = this.dynamicLoadProvider(providerName);
    this.loadingPromises.set(providerName, loadPromise);

    try {
      const provider = await loadPromise;
      this.loadedProviders.set(providerName, provider);
      return provider;
    } finally {
      this.loadingPromises.delete(providerName);
    }
  }

  async dynamicLoadProvider(name) {
    const module = await import(`./providers/${name}.js`);
    return module.default || module;
  }
}

const providerLoader = new ProviderLoader();
```

#### Step 2: Lazy Provider Resolution
Update translation request handling:

```javascript
// In handleTranslate function
async function handleTranslate(opts) {
  const providerName = opts.provider || 'dashscope';
  
  // Load provider on-demand
  const provider = await providerLoader.loadProvider(providerName);
  
  if (!provider) {
    throw new Error(`Provider ${providerName} not available`);
  }

  // Continue with translation...
}
```

#### Step 3: Provider Discovery Optimization
Update provider listing to work with lazy loading:

```javascript
// New approach - lightweight provider metadata
const PROVIDER_METADATA = {
  'dashscope': { label: 'DashScope', size: '5KB', default: true },
  'openai': { label: 'OpenAI', size: '8KB' },
  'deepl': { label: 'DeepL', size: '6KB' },
  // ... other providers
};

function getAvailableProviders() {
  return Object.entries(PROVIDER_METADATA).map(([id, meta]) => ({
    id,
    ...meta,
    loaded: providerLoader.loadedProviders.has(id)
  }));
}
```

### Expected Results
- **Initial load**: Only default provider (DashScope: 5KB)
- **Additional providers**: Loaded on-demand (5-8KB each)
- **Typical user**: 70-80KB savings (90% providers unused)

## Phase 2C: Core Module Cleanup (PRIORITY 3)

### Modules to Remove/Consolidate

#### 1. Remove Unused Legacy Code
```bash
# Files to remove (after verification):
src/core/legacy-adapter.js     # 15KB - unused legacy code
src/core/debug.js             # 8KB - development utilities  
src/core/module-adapter.js    # 25KB - over-engineered abstraction
```

#### 2. Consolidate Error Handling
```javascript
// Merge error-handler.js and error-manager.js
// Keep the more comprehensive implementation
// Expected savings: 10-15KB
```

#### 3. Simplify Storage Abstraction
```javascript
// Remove storage-adapter.js wrapper
// Use Chrome storage API directly
// Expected savings: 8KB
```

### Implementation Steps
1. Audit module dependencies
2. Remove unused imports  
3. Consolidate similar functionality
4. Update dependent modules
5. Test thoroughly

### Expected Results
- **Total savings**: 50-80KB
- **Reduced complexity**: Easier maintenance
- **Better performance**: Fewer abstraction layers

## Phase 2D: Library Lazy Loading (PRIORITY 4)

### Libraries to Optimize

#### 1. LZ-String Compression (4.7KB)
```javascript
// Current: Always loaded
// Proposed: Load when compression needed
async function compressData(data) {
  const { LZString } = await import('./lz-string.min.js');
  return LZString.compress(data);
}
```

#### 2. PDF.js Libraries (1.3MB)
```javascript
// Already covered in Phase 2A
// Additional optimization for viewer components
```

### Expected Results
- **Initial load reduction**: 1.3MB
- **On-demand loading**: Only when features used
- **Better UX**: Faster initial extension load

## Implementation Timeline

### Week 1: PDF Engine Optimization (Phase 2A)
- Day 1-2: Settings UI and engine selector
- Day 3-4: Dynamic loading implementation  
- Day 5: Testing and refinement

### Week 2: Provider & Core Cleanup (Phase 2B, 2C)
- Day 1-3: Provider lazy loading
- Day 4-5: Core module cleanup and testing

### Week 3: Final Optimizations (Phase 2D)
- Day 1-2: Library lazy loading
- Day 3-5: Integration testing and performance validation

## Success Metrics

### Bundle Size Targets
- **Current**: 21MB
- **Phase 2A Complete**: 5-6MB (PDF engines optional)
- **All Phases Complete**: 2-5MB total

### Performance Targets  
- **Extension startup**: <100ms (from ~500ms)
- **First translation**: <2s (unchanged)
- **Memory usage**: <50MB (from ~100MB)

### User Experience
- **Transparent**: No functionality loss
- **Progressive**: Advanced features load on-demand
- **Configurable**: Users choose PDF engine based on needs

This phased approach delivers maximum impact while maintaining stability and user experience.