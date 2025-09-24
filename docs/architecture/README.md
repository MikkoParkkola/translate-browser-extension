# Qwen Translator Extension Architecture

## Architecture Decision Record (ADR)

**Status:** Active  
**Date:** 2025-09-07  
**Version:** 2.0.0  

## System Overview

The Qwen Translator Extension is a Chrome/Safari browser extension that provides real-time web page translation using multiple AI translation providers. The system has been refactored from a monolithic architecture to a modular, microservice-inspired design optimized for browser extension constraints.

### Key Design Decisions

1. **Modular Core Architecture**: Separated concerns into distinct core modules with well-defined interfaces
2. **Provider-Agnostic System**: Pluggable translation providers with unified interfaces
3. **Chrome Extension MV3 Compliance**: Service worker-based background processing with messaging protocols
4. **Typed Definitions**: Shared `.d.ts` surface with JSDoc-based validation for JavaScript modules
5. **Lazy Loading Strategy**: On-demand module loading to optimize bundle size and startup performance
6. **Multi-Context Communication**: Unified messaging system across popup, content scripts, and background

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Extension                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Popup UI  │    │  Options UI │    │   Content Script    │  │
│  │             │    │             │    │                     │  │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────────────┐ │  │
│  │ │Settings │ │    │ │Provider │ │    │ │   DOM Scanner   │ │  │
│  │ │Manager  │ │    │ │Editor   │ │    │ └─────────────────┘ │  │
│  │ └─────────┘ │    │ └─────────┘ │    │ ┌─────────────────┐ │  │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │ │ Text Processor  │ │  │
│  │ │Language │ │    │ │Diags    │ │    │ └─────────────────┘ │  │
│  │ │Selector │ │    │ │Panel    │ │    │ ┌─────────────────┐ │  │
│  │ └─────────┘ │    │ └─────────┘ │    │ │ PDF Integration │ │  │
│  └─────────────┘    └─────────────┘    │ └─────────────────┘ │  │
│         │                    │         └─────────────────────┘  │
│         └────────────────────┼──────────────────┬───────────────┘
│                              │                  │
│  ┌──────────────────────────────────────────────▼─────────────┐  │
│  │                Background Service Worker                   │  │
│  │                                                           │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌───────────────┐  │  │
│  │  │Core Modules │    │   Messaging │    │   Providers   │  │  │
│  │  │             │    │   Hub       │    │   Registry    │  │  │
│  │  │ ┌─────────┐ │    │             │    │               │  │  │
│  │  │ │Config   │ │    │ ┌─────────┐ │    │ ┌───────────┐ │  │  │
│  │  │ │Manager  │ │    │ │Message  │ │    │ │ Qwen API  │ │  │  │
│  │  │ └─────────┘ │    │ │Validator│ │    │ └───────────┘ │  │  │
│  │  │ ┌─────────┐ │    │ └─────────┘ │    │ ┌───────────┐ │  │  │
│  │  │ │Cache    │ │    │ ┌─────────┐ │    │ │ OpenAI    │ │  │  │
│  │  │ │Manager  │ │    │ │Context  │ │    │ └───────────┘ │  │  │
│  │  │ └─────────┘ │    │ │Router   │ │    │ ┌───────────┐ │  │  │
│  │  │ ┌─────────┐ │    │ └─────────┘ │    │ │ DeepL     │ │  │  │
│  │  │ │Throttle │ │    │             │    │ └───────────┘ │  │  │
│  │  │ │Manager  │ │    └─────────────┘    │ ┌───────────┐ │  │  │
│  │  │ └─────────┘ │                       │ │ Custom... │ │  │  │
│  │  │ ┌─────────┐ │                       │ └───────────┘ │  │  │
│  │  │ │Error    │ │                       └───────────────┘  │  │
│  │  │ │Manager  │ │                                          │  │
│  │  │ └─────────┘ │                                          │  │
│  │  │ ┌─────────┐ │                                          │  │
│  │  │ │Logger   │ │                                          │  │
│  │  │ └─────────┘ │                                          │  │
│  │  └─────────────┘                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐    │
│  │              External Dependencies                     │    │
│  │                                                       │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────────┐  │    │
│  │  │  WASM   │  │  PDF.js │  │ Chrome  │  │  Storage  │  │    │
│  │  │ Modules │  │  Engine │  │  APIs   │  │  Backend  │  │    │
│  │  │         │  │         │  │         │  │           │  │    │
│  │  │ MuPDF   │  │ Viewer  │  │ Runtime │  │ Local     │  │    │
│  │  │ HarfBuz │  │ Worker  │  │ Storage │  │ IndexedDB │  │    │
│  │  │ Custom  │  │ Loader  │  │ Tabs    │  │ Session   │  │    │
│  │  └─────────┘  └─────────┘  └─────────┘  └───────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Module Interaction Patterns

### Data Flow Architecture

```
Translation Request Flow:
┌────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐
│ UI     │────▶│ Content  │────▶│ Background  │────▶│ Provider │
│ (Popup)│     │ Script   │     │ Worker      │     │ API      │
└────────┘     └──────────┘     └─────────────┘     └──────────┘
     │              │                   │                 │
     └──────────────┼───────────────────┼─────────────────┘
                    │                   │
                    ▼                   ▼
            ┌──────────────┐    ┌─────────────┐
            │ DOM Update   │    │ Cache Store │
            │ (Translation)│    │ (Results)   │
            └──────────────┘    └─────────────┘
```

### Message Routing System

```
Message Flow (Chrome Extension Context):

Popup Context               Background Context           Content Context
     │                           │                           │
     │ ┌─────────────────────┐    │ ┌───────────────────┐    │ ┌─────────────┐
     └▶│ Message Composer    │    │ │ Message Hub       │    │ │ DOM Scanner │
       └─────────────────────┘    │ └───────────────────┘    │ └─────────────┘
                │                 │          │               │        │
                ▼                 │          ▼               │        ▼
       ┌─────────────────────┐    │ ┌───────────────────┐    │ ┌─────────────┐
       │ chrome.runtime      │────┼▶│ Message Router    │◀───┼─│ Page Events │
       │ .sendMessage()      │    │ └───────────────────┘    │ └─────────────┘
       └─────────────────────┘    │          │               │        │
                                  │          ▼               │        ▼
                                  │ ┌───────────────────┐    │ ┌─────────────┐
                                  │ │ Action Dispatcher │    │ │ Translation │
                                  │ └───────────────────┘    │ │ Coordinator │
                                  │          │               │ └─────────────┘
                                  │          ▼               │
                                  │ ┌───────────────────┐    │
                                  │ │ Provider Proxy    │    │
                                  │ └───────────────────┘    │
```

## Interface Contracts and Data Structures

### Core Module Interfaces

```typescript
// Configuration Manager Interface
interface IConfigManager {
  get<T>(key: string, defaultValue?: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  getAll(): Promise<ExtensionConfig>;
  validate(config: Partial<ExtensionConfig>): ValidationResult;
  migrate(oldVersion: string, newVersion: string): Promise<void>;
}

// Cache Manager Interface
interface ICacheManager {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: string, options?: CacheOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): Promise<number>;
  stats(): Promise<CacheStats>;
}

// Translation Provider Interface  
interface ITranslationProvider {
  readonly id: string;
  readonly name: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  detectLanguage(text: string): Promise<string>;
  getSupportedLanguages(): Promise<Language[]>;
  validateConfig(config: ProviderConfig): ValidationResult;
}
```

### Message Protocol Schema

```typescript
// Unified message structure for all contexts
interface ExtensionMessage<T = any> {
  type: string;
  action?: string;  // Legacy compatibility
  data: T;
  id?: string;      // Request correlation
  sender: 'popup' | 'content' | 'background';
  timestamp: number;
  version: number;  // Protocol version
}

// Response envelope
interface ExtensionResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  id?: string;
  duration: number;
}
```

### Provider Configuration Schema

```typescript
interface ProviderConfig {
  id: string;                    // Unique identifier
  name: string;                  // Human readable name
  apiKey: string;               // Encrypted API key
  apiEndpoint: string;          // Base URL for API
  model: string;                // Default model
  models: string[];             // Available models
  requestLimit: number;         // Requests per minute
  tokenLimit: number;           // Tokens per minute
  charLimit: number;            // Characters per request
  weight: number;               // Load balancing weight (0-1)
  strategy: 'fast' | 'balanced' | 'quality';
  costPerInputToken: number;
  costPerOutputToken: number;
  enabled: boolean;
  throttle?: ThrottleConfig;
}
```

## Security Architecture

### Threat Model

**Assets Protected:**
- User's translation API keys (stored encrypted)
- Personal data in web page content  
- User browsing patterns and preferences
- Translation history and cached results

**Threat Actors:**
- Malicious websites attempting to access extension functionality
- Network-based attackers intercepting API communications
- Other browser extensions with broad permissions
- Compromised translation service providers

**Security Controls:**

```
Input Validation Layer:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   User Input    │───▶│    Sanitizer    │───▶│    Validator    │
│                 │    │                 │    │                 │
│ • Text content  │    │ • XSS filtering │    │ • Schema check  │
│ • Config data   │    │ • Size limits   │    │ • Type safety   │
│ • API responses │    │ • Encoding      │    │ • Range bounds  │
└─────────────────┘    └─────────────────┘    └─────────────────┘

Encryption Layer:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Plaintext     │───▶│   AES-256-GCM   │───▶│   Ciphertext    │
│                 │    │                 │    │                 │
│ • API keys      │    │ • Key derivation│    │ • Storage safe │
│ • Preferences   │    │ • IV generation │    │ • Tamper proof  │
│ • Cache data    │    │ • Auth tags     │    │ • Forward sec   │
└─────────────────┘    └─────────────────┘    └─────────────────┘

Communication Security:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Origin Check   │───▶│   TLS 1.3+      │───▶│  API Provider   │
│                 │    │                 │    │                 │
│ • Extension ID  │    │ • Cert pinning  │    │ • Rate limiting │
│ • Sender verify │    │ • HSTS headers  │    │ • Auth headers  │
│ • Context valid │    │ • CORS policy   │    │ • Response val  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Permission Model

**Chrome Extension Permissions:**
```json
{
  "storage": "Configuration and cache persistence",
  "activeTab": "Current page content access",
  "scripting": "Content script injection",
  "webRequest": "PDF URL interception", 
  "<all_urls>": "Universal translation capability"
}
```

**Content Security Policy:**
```
script-src 'self' 'wasm-unsafe-eval';
object-src 'none';
base-uri 'self';
connect-src https://*.aliyuncs.com https://api.openai.com https://api.deepl.com;
```

### Data Protection

**Encryption at Rest:**
- API keys: AES-256-GCM with PBKDF2-derived keys
- Configuration: Selective encryption of sensitive fields
- Cache: Plaintext (non-sensitive translation results)

**Encryption in Transit:**
- TLS 1.3+ for all API communications
- Certificate pinning for critical providers
- Request signing where supported by providers

**Data Minimization:**
- Only translate visible page content
- Automatic cache expiration (default 7 days)
- Optional anonymization of requests
- No telemetry without explicit consent

## Performance Characteristics

### Bundle Size Optimization

**Current Bundle Sizes (after optimization):**
```
Core translator module:     ≤ 60 KB
Background service worker:  ≤ 50 KB  
Content script (initial):   ≤ 40 KB
Popup interface:           ≤ 35 KB
Core modules (combined):   ≤ 150 KB
WASM loaders (lazy):       ≤ 25 KB each
Initial critical path:     ≤ 120 KB
```

**Lazy Loading Strategy:**
```
Startup Phase (0-100ms):
├── Core types and interfaces
├── Message routing system
├── Essential utilities
└── Basic configuration

Translation Phase (100-500ms):
├── Provider-specific modules
├── Cache and throttle managers
├── DOM manipulation utilities
└── UI components

Advanced Features (500ms+):
├── PDF processing engines
├── WASM translation modules
├── Advanced UI themes
└── Diagnostics and debugging tools
```

### Memory Management

**Memory Usage Patterns:**
```
Extension Context          | Memory Budget | Actual Usage
---------------------------|---------------|-------------
Background Service Worker  |     50 MB     |   12-18 MB
Content Script (per tab)   |     20 MB     |    5-8 MB
Popup Interface            |     10 MB     |    2-4 MB
Options Page               |     15 MB     |    3-6 MB
PDF Viewer                 |     100 MB    |   25-45 MB
WASM Modules (loaded)      |     80 MB     |   15-30 MB
```

**Cache Strategy:**
- LRU eviction with configurable size limits
- Aggressive cleanup on memory pressure
- Separate cache contexts for different content types
- Automatic compression for large cached results

### Translation Performance

**Response Time Targets:**
```
Operation Type         | Target    | Typical   | 95th %ile
-----------------------|-----------|-----------|----------
Cached translation     | < 50ms    | 20-30ms   | 80ms
API-based translation  | < 2000ms  | 800ms     | 3000ms  
Page scan & batch      | < 500ms   | 200ms     | 1000ms
Provider failover      | < 5000ms  | 2000ms    | 8000ms
```

**Throughput Characteristics:**
- Concurrent translations: 3-5 per provider
- Batch size optimization: ~6000 tokens per request
- Rate limiting: 60 requests/min, 100k tokens/min (configurable)
- Connection pooling: Keep-alive for repeat requests

## Trade-offs and Design Decisions

### Architectural Trade-offs

**Modularity vs. Bundle Size**
- *Decision*: Chose modularity with lazy loading
- *Trade-off*: Slightly increased complexity for significantly better maintainability
- *Rationale*: Extension longevity and feature development velocity more important than minimal initial bundle size

**Type Safety vs. Legacy Compatibility**
- *Decision*: JSDoc-first JavaScript with shared `.d.ts` hints for tooling
- *Trade-off*: Fewer compile-time guarantees in exchange for simpler build tooling
- *Rationale*: Keep bundles lightweight while still offering editor support and optional type metadata

**Provider Coupling vs. Abstraction**
- *Decision*: Provider abstraction layer with unified interfaces
- *Trade-off*: Additional abstraction layer complexity
- *Rationale*: Future-proofing against provider changes and easier testing

### Performance vs. Features Trade-offs

**Caching Strategy**
- *Decision*: Aggressive in-memory caching with optional persistence
- *Trade-off*: Memory usage for speed and reduced API costs
- *Rationale*: User experience and cost optimization outweigh memory concerns

**WASM Integration**
- *Decision*: Optional local processing with WASM modules
- *Trade-off*: Large bundle sizes for offline capability
- *Rationale*: User choice between privacy/offline vs. performance/size

**Real-time vs. Batch Processing**
- *Decision*: Hybrid approach with intelligent batching
- *Trade-off*: Implementation complexity for optimal performance
- *Rationale*: Balance between responsiveness and API efficiency

## System Metrics and Observability

### Key Performance Indicators

**Reliability Metrics:**
- Translation success rate: >99.5% target
- Provider failover time: <5 seconds
- Error recovery rate: >95%
- Cache hit rate: >70% target

**Performance Metrics:**
- Page translation time: <3 seconds for typical page
- Memory usage: <50MB background, <20MB per tab
- Bundle size: <200KB total initial load
- CPU usage: <5% during translation

**User Experience Metrics:**
- Time to first translation: <1 second
- UI responsiveness: <100ms for all interactions
- Extension startup time: <500ms
- Configuration load time: <200ms

### Monitoring and Logging

**Log Levels:**
```
DEBUG:  Detailed execution flow, variable values
INFO:   Normal operations, successful translations
WARN:   Recoverable errors, fallback activations  
ERROR:  Failed operations, unhandled exceptions
```

**Telemetry Collection (Optional):**
- Performance timings
- Error rates by provider
- Feature usage statistics
- Anonymized failure patterns

**Health Checks:**
- Provider API connectivity
- Cache system integrity  
- Message routing functionality
- Configuration validation

---

*This architecture document reflects the current state (v2.0.0) of the modular refactor. For implementation details, see the API documentation and developer guide.*
