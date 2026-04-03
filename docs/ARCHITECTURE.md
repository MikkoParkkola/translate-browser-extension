# Architecture Overview

TRANSLATE! is a multi-provider browser translation extension that ships on Chrome (MV3) and Firefox (MV2) with a local-first architecture.

## Core Components

### Extension Structure

- **Background Service Worker** - Provider routing, rate limiting, caching, message hub
- **Content Script** - DOM scanning, text extraction, translation injection, MutationObserver
- **Popup UI** - Translation controls, language selection, provider status
- **Options UI** - Provider configuration, API keys, settings management

### Canonical shipped runtime paths

#### Chrome
- **Downloaded local models** (`opus-mt`, `translategemma`) route through `popup/content -> background service worker -> offscreen document`.
- **Native browser translation** (`chrome-builtin`) routes through `popup/content -> chrome.scripting.executeScript(...)` in the active tab main world.
- **Cloud providers** route through `popup/content -> background service worker -> provider API`.

#### Firefox
- Firefox routes shipped translation work through `popup/content -> background-firefox`.
- Firefox does not support the Chrome MV3 offscreen-document path.
- Firefox does not ship the `chrome-builtin` provider.

#### Shipping status
- **Stable**: `chrome-builtin`, `opus-mt`, and configured cloud providers
- **Experimental**: `translategemma`
- Legacy `localModel` / `llama.cpp` / `wllama` surfaces were removed after they were confirmed to be quarantined and unused by shipped entry points.

### Provider Routing System

The extension routes translation requests through the browser-appropriate background runtime, which manages:

- **Provider selection** - Weighted distribution, failover chains, quota tracking
- **Rate limiting** - Per-provider request/token limits with automatic retry
- **Caching** - Session-based deduplication, LRU eviction
- **Batching** - Intelligent text node grouping to minimize API calls

### Translation Pipeline

1. **DOM Scan** - Content script identifies translatable text nodes (skips hidden/offscreen)
2. **Batch** - Group similar nodes, deduplicate identical strings
3. **Route** - Send to primary provider, fail over if rate-limited or unavailable
4. **Cache** - Store results for session, reuse across matching nodes
5. **Inject** - Replace original text preserving whitespace and structure

### Offline Integration

For privacy-sensitive or offline scenarios:

- **OPUS-MT models** - Stable downloaded baseline running entirely in-browser via WebAssembly
- **TranslateGemma** - Experimental accelerated path that requires WebGPU or WebNN
- **Chrome Built-in** - Browser-managed native translation when supported by Chrome
- **No network** - Zero data transmission, no API key required

## Data Flow

```
User Action (translate page)
  ↓
Content Script (scan DOM, batch nodes)
  ↓
Background Runtime (route to provider)
  ↓
Provider API / Local runtime
  ↓
Background Runtime (cache result)
  ↓
Content Script (inject translation)
  ↓
DOM Update (visible to user)
```

## Security Model

- **API keys** - AES-256-GCM encrypted at rest
- **Transport** - TLS 1.3+ for all provider communications
- **Permissions** - Minimal required: storage, activeTab, scripting
- **CSP** - Strict Content Security Policy with WASM support
- **Data minimization** - Only visible content translated, automatic cache expiration

## Performance Characteristics

- **Bundle size** - <200KB initial load (core modules lazy-loaded)
- **Memory** - <50MB background, <20MB per content script
- **Latency** - <50ms cached, <2s API-based, <3s full page
- **Cache hit rate** - >70% target for typical browsing

## Extension Points

New providers implement a simple interface:

```typescript
interface ITranslationProvider {
  readonly id: string;
  readonly name: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  detectLanguage(text: string): Promise<string>;
  getSupportedLanguages(): Promise<Language[]>;
}
```

Providers are registered at runtime, no core code changes required.

## Full Details

See [docs/architecture/README.md](architecture/README.md) for comprehensive architecture documentation including:
- System architecture diagrams
- Message routing protocols
- Interface contracts
- Security threat model
- Performance metrics
- Trade-off analysis
