# Qwen Translator Extension API Documentation

## Overview

This document provides comprehensive API documentation for the Qwen Translator Extension's modular architecture. The extension follows a service-oriented design with well-defined interfaces between components.

## Table of Contents

1. [Core Module APIs](#core-module-apis)
2. [Provider System APIs](#provider-system-apis)  
3. [Chrome Extension Messaging](#chrome-extension-messaging)
4. [Error Handling and Recovery](#error-handling-and-recovery)
5. [Type Definitions](#type-definitions)
6. [Usage Examples](#usage-examples)

---

## Core Module APIs

### Configuration Manager (`ConfigManager`)

Centralized configuration management with encryption support and validation.

#### Interface Definition

```typescript
interface IConfigManager {
  get<T>(key: string, defaultValue?: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  getAll(): Promise<ExtensionConfig>;
  validate(config: Partial<ExtensionConfig>): ValidationResult;
  migrate(oldVersion: string, newVersion: string): Promise<void>;
}
```

#### Methods

**`get<T>(key: string, defaultValue?: T): Promise<T>`**

Retrieves a configuration value with type safety.

```javascript
// Basic usage
const apiKey = await configManager.get('apiKey', '');
const timeout = await configManager.get('timeout', 5000);

// Complex objects
const providerConfig = await configManager.get('providers', {});
const uiPrefs = await configManager.get('ui', { theme: 'modern' });
```

**`set<T>(key: string, value: T): Promise<void>`**

Sets a configuration value with automatic validation and encryption for sensitive data.

```javascript
// Store API key (automatically encrypted)
await configManager.set('apiKey', 'sk-1234567890abcdef');

// Store provider configuration
await configManager.set('providers.qwen.enabled', true);

// Complex objects
await configManager.set('ui', {
  theme: 'cyberpunk',
  showOverlay: true,
  animations: true
});
```

**`getAll(): Promise<ExtensionConfig>`**

Retrieves the complete configuration object.

```javascript
const fullConfig = await configManager.getAll();
console.log('Active provider:', fullConfig.activeProvider);
console.log('Enabled providers:', Object.keys(fullConfig.providers).filter(id => 
  fullConfig.providers[id].enabled
));
```

**`validate(config: Partial<ExtensionConfig>): ValidationResult`**

Validates configuration against schema.

```javascript
const result = configManager.validate({
  apiKey: 'invalid-key',
  timeout: -1
});

if (!result.valid) {
  console.error('Configuration errors:', result.errors);
  console.warn('Configuration warnings:', result.warnings);
}
```

---

### Cache Manager (`CacheManager`)

High-performance caching system with multiple eviction strategies.

#### Interface Definition

```typescript
interface ICacheManager {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: string, options?: CacheOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): Promise<number>;
  stats(): Promise<CacheStats>;
}
```

#### Methods

**`get(key: string): Promise<CacheEntry | null>`**

Retrieves a cached translation with metadata.

```javascript
// Generate cache key (source:target:textHash)
const cacheKey = `en:es:${hashText('Hello world')}`;
const cached = await cacheManager.get(cacheKey);

if (cached && cached.timestamp + cached.ttl > Date.now()) {
  return cached.translatedText;
}
```

**`set(key: string, value: string, options?: CacheOptions): Promise<void>`**

Stores a translation with configurable TTL and metadata.

```javascript
await cacheManager.set(
  'en:es:abc123',
  'Hola mundo',
  {
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
    provider: 'qwen',
    sourceLanguage: 'en',
    targetLanguage: 'es',
    metadata: {
      tokensUsed: 15,
      confidence: 0.95
    }
  }
);
```

**`stats(): Promise<CacheStats>`**

Gets detailed cache performance statistics.

```javascript
const stats = await cacheManager.stats();
console.log(`Hit rate: ${stats.hitRate.toFixed(2)}%`);
console.log(`Entries: ${stats.entryCount}/${stats.maxEntries}`);
console.log(`Memory usage: ${(stats.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
```

---

### Throttle Manager (`ThrottleManager`)

Rate limiting and API quota management.

#### Interface Definition

```typescript
interface IThrottleManager {
  checkLimit(context: string, tokens?: number): Promise<ThrottleResult>;
  waitForSlot(context: string, tokens?: number): Promise<void>;
  getUsage(context: string): Promise<UsageInfo>;
  resetLimits(context?: string): Promise<void>;
}
```

#### Methods

**`checkLimit(context: string, tokens?: number): Promise<ThrottleResult>`**

Checks if a request can proceed without waiting.

```javascript
const result = await throttleManager.checkLimit('qwen-api', 1500);
if (result.allowed) {
  // Proceed with translation
  await translateText(text);
} else {
  console.log(`Wait ${result.retryAfter}ms before next request`);
}
```

**`waitForSlot(context: string, tokens?: number): Promise<void>`**

Waits for an available slot in the rate limit.

```javascript
// Automatically waits until request can proceed
await throttleManager.waitForSlot('openai-api', 800);
const result = await openaiProvider.translate(request);
```

**`getUsage(context: string): Promise<UsageInfo>`**

Gets current usage statistics for a context.

```javascript
const usage = await throttleManager.getUsage('global');
console.log(`Requests: ${usage.requests}/${usage.requestLimit}`);
console.log(`Tokens: ${usage.tokens}/${usage.tokenLimit}`);
console.log(`Reset in: ${usage.resetIn}ms`);
```

---

### Logger (`Logger`)

Structured logging with multiple outputs and filtering.

#### Interface Definition

```typescript
interface ILogger {
  debug(message: string, meta?: object): void;
  info(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, error?: Error, meta?: object): void;
  setLevel(level: LogLevel): void;
}
```

#### Methods

**Basic Logging**

```javascript
const logger = qwenLogger.create('translation');

logger.info('Starting translation', { 
  sourceLanguage: 'en', 
  targetLanguage: 'es',
  textLength: 150 
});

logger.warn('Provider fallback activated', {
  primaryProvider: 'qwen',
  fallbackProvider: 'openai',
  reason: 'quota_exceeded'
});

logger.error('Translation failed', error, {
  provider: 'deepl',
  statusCode: 429,
  retryCount: 3
});
```

**Structured Metadata**

```javascript
// Performance logging
logger.debug('Cache lookup', {
  operation: 'get',
  key: cacheKey,
  duration: 15,
  hit: true
});

// User interaction logging
logger.info('Provider selected', {
  provider: 'qwen',
  source: 'popup_ui',
  previousProvider: 'openai'
});
```

---

## Provider System APIs

### Translation Provider Interface

All translation providers implement this standardized interface.

#### Interface Definition

```typescript
interface ITranslationProvider {
  readonly id: string;
  readonly name: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  detectLanguage(text: string): Promise<string>;
  getSupportedLanguages(): Promise<Language[]>;
  validateConfig(config: ProviderConfig): ValidationResult;
}
```

### Provider Registration

**`registerProvider(provider: ITranslationProvider): void`**

```javascript
// Register a custom provider
const customProvider = {
  id: 'custom-api',
  name: 'Custom Translation API',
  
  async translate(request) {
    const response = await fetch(`${this.config.endpoint}/translate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: request.text,
        source: request.sourceLanguage,
        target: request.targetLanguage
      })
    });
    
    const data = await response.json();
    return {
      translatedText: data.translation,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      provider: this.id,
      tokensUsed: data.tokens || 0,
      duration: Date.now() - startTime,
      confidence: data.confidence || 0.8,
      cached: false
    };
  },
  
  async detectLanguage(text) {
    // Implementation for language detection
    return 'auto';
  },
  
  async getSupportedLanguages() {
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      // ... more languages
    ];
  },
  
  validateConfig(config) {
    return {
      valid: config.apiKey && config.endpoint,
      errors: config.apiKey ? [] : ['API key required'],
      warnings: []
    };
  }
};

providerRegistry.register(customProvider);
```

### Built-in Providers

#### Qwen Provider

```javascript
// Configuration
const qwenConfig = {
  id: 'qwen',
  name: 'Qwen Translation',
  apiKey: 'your-dashscope-key',
  apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-mt-turbo',
  requestLimit: 60,
  tokenLimit: 100000,
  charLimit: 6000
};

// Usage
const result = await providerRegistry.get('qwen').translate({
  text: 'Hello, world!',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  stream: false
});
```

#### OpenAI Provider

```javascript
// Configuration
const openaiConfig = {
  id: 'openai',
  name: 'OpenAI Translation',
  apiKey: 'sk-...',
  apiEndpoint: 'https://api.openai.com/v1',
  model: 'gpt-4',
  requestLimit: 60,
  tokenLimit: 90000,
  charLimit: 8000
};

// Usage with streaming
const stream = await providerRegistry.get('openai').translate({
  text: 'Long document text...',
  sourceLanguage: 'en',
  targetLanguage: 'fr',
  stream: true
});

for await (const chunk of stream) {
  console.log('Partial translation:', chunk.text);
}
```

#### DeepL Provider

```javascript
// Configuration  
const deeplConfig = {
  id: 'deepl',
  name: 'DeepL',
  apiKey: 'your-deepl-key',
  apiEndpoint: 'https://api-free.deepl.com/v2',
  model: 'deepl-translate',
  requestLimit: 500,
  tokenLimit: 500000,
  charLimit: 5000
};

// Usage
const result = await providerRegistry.get('deepl').translate({
  text: 'Professional translation needed',
  sourceLanguage: 'auto',
  targetLanguage: 'de'
});
```

---

## Chrome Extension Messaging

### Message Protocol

All inter-context communication uses a standardized message format.

#### Message Structure

```typescript
interface ExtensionMessage<T = any> {
  type: string;
  action?: string;      // Legacy compatibility
  data: T;
  id?: string;          // Request correlation ID
  sender: 'popup' | 'content' | 'background';
  timestamp: number;
  version: number;      // Protocol version
}

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

### Popup ↔ Background Communication

#### Translation Request

```javascript
// From popup.js
const response = await chrome.runtime.sendMessage({
  type: 'translate',
  data: {
    text: 'Hello world',
    sourceLanguage: 'en',
    targetLanguage: 'es',
    provider: 'qwen'
  },
  sender: 'popup',
  timestamp: Date.now(),
  version: 1
});

if (response.success) {
  console.log('Translation:', response.data.translatedText);
} else {
  console.error('Translation failed:', response.error);
}
```

#### Configuration Management

```javascript
// Get configuration
const config = await chrome.runtime.sendMessage({
  type: 'get-config',
  data: { keys: ['providers', 'activeProvider'] },
  sender: 'popup'
});

// Set configuration
await chrome.runtime.sendMessage({
  type: 'set-config', 
  data: {
    providers: {
      qwen: { enabled: true, weight: 0.8 },
      openai: { enabled: false }
    }
  },
  sender: 'popup'
});
```

#### Usage Statistics

```javascript
// Get usage metrics
const usage = await chrome.runtime.sendMessage({
  type: 'get-metrics',
  data: { timeframe: '24h' },
  sender: 'popup'
});

console.log('Translations today:', usage.data.totalTranslations);
console.log('Tokens used:', usage.data.totalTokens);
console.log('Top provider:', usage.data.topProvider);
```

### Content Script ↔ Background Communication

#### Page Translation

```javascript
// From contentScript.js
const textNodes = scanForTranslatableText();
const batches = batchTextNodes(textNodes, 6000); // 6k char limit

for (const batch of batches) {
  const response = await chrome.runtime.sendMessage({
    type: 'batch-translate',
    data: {
      texts: batch.texts,
      sourceLanguage: 'auto',
      targetLanguage: 'es',
      provider: 'qwen'
    },
    sender: 'content'
  });
  
  if (response.success) {
    applyTranslations(batch.nodes, response.data.translations);
  }
}
```

#### DOM Monitoring

```javascript
// Monitor page changes
const observer = new MutationObserver((mutations) => {
  const newTextNodes = extractTextNodes(mutations);
  if (newTextNodes.length > 0) {
    chrome.runtime.sendMessage({
      type: 'translate-new-content',
      data: { nodes: newTextNodes },
      sender: 'content'
    });
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});
```

### Background Message Handling

```javascript
// In background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ success: true, data: result }))
    .catch(error => sendResponse({ 
      success: false, 
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        details: error.details
      }
    }));
  
  return true; // Async response
});

async function handleMessage(message, sender) {
  const { type, data } = message;
  
  switch (type) {
    case 'translate':
      return await translateText(data);
    
    case 'batch-translate':
      return await batchTranslate(data);
    
    case 'get-config':
      return await configManager.get(data.key, data.defaultValue);
    
    case 'set-config':
      return await configManager.set(data.key, data.value);
    
    case 'get-metrics':
      return await metricsCollector.getUsage(data.timeframe);
    
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}
```

---

## Error Handling and Recovery

### Error Types and Codes

The extension uses structured error codes for consistent error handling.

#### Error Categories

```typescript
enum ErrorCode {
  // Configuration errors
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_MISSING = 'CONFIG_MISSING',
  
  // Provider errors  
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_QUOTA_EXCEEDED = 'PROVIDER_QUOTA_EXCEEDED',
  PROVIDER_AUTH_FAILED = 'PROVIDER_AUTH_FAILED',
  
  // Translation errors
  TRANSLATION_FAILED = 'TRANSLATION_FAILED',
  LANGUAGE_NOT_SUPPORTED = 'LANGUAGE_NOT_SUPPORTED',
  TEXT_TOO_LONG = 'TEXT_TOO_LONG',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  
  // Cache errors
  CACHE_READ_ERROR = 'CACHE_READ_ERROR',
  CACHE_WRITE_ERROR = 'CACHE_WRITE_ERROR',
  
  // System errors
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED'
}
```

### Error Recovery Strategies

#### Provider Failover

```javascript
class TranslationCoordinator {
  async translateWithFallback(request) {
    const providers = this.getAvailableProviders(request);
    const errors = [];
    
    for (const provider of providers) {
      try {
        const result = await provider.translate(request);
        
        // Log successful translation
        logger.info('Translation successful', {
          provider: provider.id,
          duration: result.duration,
          tokensUsed: result.tokensUsed
        });
        
        return result;
        
      } catch (error) {
        errors.push({ provider: provider.id, error });
        
        // Log provider failure
        logger.warn('Provider failed, trying next', {
          provider: provider.id,
          error: error.message,
          remainingProviders: providers.length - providers.indexOf(provider) - 1
        });
        
        // Handle specific error types
        switch (error.code) {
          case 'PROVIDER_QUOTA_EXCEEDED':
            // Disable provider temporarily
            await this.disableProvider(provider.id, 3600000); // 1 hour
            break;
            
          case 'PROVIDER_AUTH_FAILED':
            // Mark provider as misconfigured
            await this.markProviderMisconfigured(provider.id);
            break;
            
          case 'NETWORK_ERROR':
            // Wait before next attempt
            await this.delay(1000);
            break;
        }
      }
    }
    
    // All providers failed
    throw new AggregateError(errors, 'All translation providers failed');
  }
}
```

#### Automatic Retry Logic

```javascript
class RetryManager {
  async executeWithRetry(operation, options = {}) {
    const {
      maxRetries = 3,
      initialDelay = 1000,
      maxDelay = 10000,
      backoffMultiplier = 2,
      retryableErrors = ['NETWORK_ERROR', 'TIMEOUT_ERROR', 'PROVIDER_UNAVAILABLE']
    } = options;
    
    let lastError;
    let delay = initialDelay;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        
        if (attempt > 0) {
          logger.info('Operation succeeded after retry', {
            attempts: attempt + 1,
            totalDelay: delay - initialDelay
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        if (!retryableErrors.includes(error.code) || attempt === maxRetries) {
          throw error;
        }
        
        // Log retry attempt
        logger.warn('Operation failed, retrying', {
          attempt: attempt + 1,
          maxRetries,
          error: error.message,
          nextDelay: delay
        });
        
        // Wait before retry
        await this.delay(delay);
        delay = Math.min(delay * backoffMultiplier, maxDelay);
      }
    }
    
    throw lastError;
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

#### Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
    this.monitoringWindow = options.monitoringWindow || 300000; // 5 minutes
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = [];
    this.lastFailure = null;
    this.successCount = 0;
  }
  
  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure < this.resetTimeout) {
        throw new Error('Circuit breaker is OPEN');
      }
      
      this.state = 'HALF_OPEN';
      this.successCount = 0;
    }
    
    try {
      const result = await operation();
      
      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        if (this.successCount >= 3) {
          this.reset();
        }
      }
      
      return result;
      
    } catch (error) {
      this.recordFailure();
      
      if (this.shouldOpen()) {
        this.state = 'OPEN';
        logger.warn('Circuit breaker opened', {
          failures: this.failures.length,
          threshold: this.failureThreshold
        });
      }
      
      throw error;
    }
  }
  
  recordFailure() {
    const now = Date.now();
    this.failures.push(now);
    this.lastFailure = now;
    
    // Clean old failures outside monitoring window
    this.failures = this.failures.filter(
      timestamp => now - timestamp < this.monitoringWindow
    );
  }
  
  shouldOpen() {
    return this.failures.length >= this.failureThreshold &&
           this.state !== 'OPEN';
  }
  
  reset() {
    this.state = 'CLOSED';
    this.failures = [];
    this.lastFailure = null;
    this.successCount = 0;
    
    logger.info('Circuit breaker reset to CLOSED');
  }
}
```

---

## Type Definitions

### Core Types

```typescript
// Translation types
interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider?: string;
  model?: string;
  timeout?: number;
  stream?: boolean;
  metadata?: Record<string, any>;
}

interface TranslationResult {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  model: string;
  tokensUsed: number;
  duration: number;
  confidence: number;
  cached: boolean;
  metadata?: Record<string, any>;
}

// Configuration types
interface ExtensionConfig {
  apiKey: string;
  providers: Record<string, ProviderConfig>;
  activeProvider: string;
  fallbackProviders: string[];
  throttle: ThrottleConfig;
  cache: CacheConfig;
  ui: UiConfig;
  features: FeatureFlags;
}

interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  apiEndpoint: string;
  model: string;
  models: string[];
  requestLimit: number;
  tokenLimit: number;
  charLimit: number;
  weight: number;
  strategy: 'fast' | 'balanced' | 'quality';
  costPerInputToken: number;
  costPerOutputToken: number;
  enabled: boolean;
  throttle?: ThrottleConfig;
}
```

### Utility Types

```typescript
// Result wrapper for async operations
type AsyncResult<T> = Promise<
  | { success: true; data: T }
  | { success: false; error: Error }
>;

// Configuration validation
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Cache entry structure  
interface CacheEntry {
  key: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

// Usage statistics
interface UsageStats {
  totalTranslations: number;
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, {
    count: number;
    tokens: number;
    cost: number;
    avgDuration: number;
  }>;
  cacheHitRate: number;
  errorRate: number;
  lastReset: number;
}
```

---

## Usage Examples

### Complete Translation Workflow

```javascript
// 1. Initialize the extension
const extension = new QwenTranslatorExtension();
await extension.initialize();

// 2. Configure providers
await configManager.set('providers.qwen', {
  id: 'qwen',
  name: 'Qwen Translation',
  apiKey: 'your-api-key',
  enabled: true,
  weight: 0.8
});

// 3. Translate text with automatic provider selection
const result = await extension.translate({
  text: 'Hello, how are you today?',
  sourceLanguage: 'en',
  targetLanguage: 'es'
});

console.log('Translation:', result.translatedText);
console.log('Provider used:', result.provider);
console.log('Confidence:', result.confidence);

// 4. Batch translation for efficiency
const texts = [
  'Welcome to our website',
  'Please enter your information',
  'Thank you for your purchase'
];

const batchResults = await extension.batchTranslate({
  texts,
  sourceLanguage: 'en', 
  targetLanguage: 'fr',
  provider: 'qwen'
});

batchResults.forEach((result, index) => {
  console.log(`"${texts[index]}" → "${result.translatedText}"`);
});
```

### Custom Provider Integration

```javascript
// Define a custom provider
class CustomTranslationProvider {
  constructor(config) {
    this.id = 'custom-provider';
    this.name = 'Custom Translation Service';
    this.config = config;
  }
  
  async translate(request) {
    // Custom translation logic
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: request.text,
        from: request.sourceLanguage,
        to: request.targetLanguage
      })
    });
    
    if (!response.ok) {
      throw new Error(`Translation failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      translatedText: data.result,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      provider: this.id,
      model: this.config.model,
      tokensUsed: data.tokens || 0,
      duration: Date.now() - startTime,
      confidence: data.confidence || 0.8,
      cached: false
    };
  }
  
  async detectLanguage(text) {
    // Language detection implementation
    return 'auto';
  }
  
  async getSupportedLanguages() {
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' }
    ];
  }
  
  validateConfig(config) {
    const errors = [];
    if (!config.apiKey) errors.push('API key is required');
    if (!config.endpoint) errors.push('API endpoint is required');
    
    return {
      valid: errors.length === 0,
      errors,
      warnings: []
    };
  }
}

// Register the custom provider
const customProvider = new CustomTranslationProvider({
  apiKey: 'your-custom-key',
  endpoint: 'https://api.custom-translate.com/v1/translate',
  model: 'custom-model-v1'
});

extension.registerProvider(customProvider);
```

### Advanced Error Handling

```javascript
async function robustTranslation(text, sourceLanguage, targetLanguage) {
  const retryManager = new RetryManager({
    maxRetries: 3,
    initialDelay: 1000,
    backoffMultiplier: 2
  });
  
  try {
    // Attempt translation with retries
    const result = await retryManager.executeWithRetry(async () => {
      return await extension.translate({
        text,
        sourceLanguage,
        targetLanguage
      });
    });
    
    return result;
    
  } catch (error) {
    // Handle different error types
    switch (error.code) {
      case 'PROVIDER_QUOTA_EXCEEDED':
        logger.warn('All providers exceeded quota', { 
          text: text.substring(0, 50) + '...',
          error: error.message 
        });
        throw new Error('Translation service temporarily unavailable');
        
      case 'LANGUAGE_NOT_SUPPORTED':
        logger.error('Unsupported language pair', {
          sourceLanguage,
          targetLanguage
        });
        throw new Error(`Translation from ${sourceLanguage} to ${targetLanguage} is not supported`);
        
      case 'TEXT_TOO_LONG':
        logger.warn('Text too long, attempting to split', {
          textLength: text.length,
          maxLength: error.details?.maxLength || 5000
        });
        
        // Try splitting the text
        return await splitAndTranslate(text, sourceLanguage, targetLanguage);
        
      default:
        logger.error('Translation failed with unknown error', {
          error: error.message,
          code: error.code
        });
        throw error;
    }
  }
}

async function splitAndTranslate(text, sourceLanguage, targetLanguage) {
  const maxChunkSize = 4000;
  const chunks = splitTextIntoChunks(text, maxChunkSize);
  const translations = [];
  
  for (const chunk of chunks) {
    const result = await extension.translate({
      text: chunk,
      sourceLanguage,
      targetLanguage
    });
    translations.push(result.translatedText);
  }
  
  return {
    translatedText: translations.join(' '),
    sourceLanguage,
    targetLanguage,
    provider: 'split-translation',
    tokensUsed: translations.reduce((sum, t) => sum + (t.tokensUsed || 0), 0),
    duration: Date.now() - startTime,
    confidence: 0.8, // Lower confidence for split translations
    cached: false
  };
}
```

---

## Performance Monitoring

### Metrics Collection

```javascript
// Real-time performance monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }
  
  startTiming(operation) {
    const id = `${operation}_${Date.now()}_${Math.random()}`;
    this.metrics.set(id, {
      operation,
      startTime: performance.now(),
      endTime: null,
      duration: null
    });
    return id;
  }
  
  endTiming(id) {
    const metric = this.metrics.get(id);
    if (metric) {
      metric.endTime = performance.now();
      metric.duration = metric.endTime - metric.startTime;
      
      // Log slow operations
      if (metric.duration > 5000) {
        logger.warn('Slow operation detected', {
          operation: metric.operation,
          duration: metric.duration
        });
      }
      
      return metric.duration;
    }
    return null;
  }
  
  getMetrics(operation) {
    const operationMetrics = Array.from(this.metrics.values())
      .filter(m => m.operation === operation && m.duration !== null);
      
    if (operationMetrics.length === 0) return null;
    
    const durations = operationMetrics.map(m => m.duration);
    return {
      count: durations.length,
      avg: durations.reduce((a, b) => a + b) / durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      p95: this.percentile(durations, 0.95)
    };
  }
  
  percentile(sorted, percentile) {
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted.sort((a, b) => a - b)[index];
  }
}

// Usage
const monitor = new PerformanceMonitor();

async function translateWithMonitoring(request) {
  const timingId = monitor.startTiming('translation');
  
  try {
    const result = await extension.translate(request);
    return result;
  } finally {
    const duration = monitor.endTiming(timingId);
    logger.debug('Translation completed', {
      provider: request.provider,
      duration,
      textLength: request.text.length
    });
  }
}
```

---

This API documentation provides comprehensive coverage of all public interfaces, with practical examples and error handling patterns. For implementation details and advanced usage, see the [Developer Guide](DEVELOPMENT.md) and [Architecture Documentation](architecture/README.md).