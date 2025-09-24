# Translation Extension - Target Architecture & UX Specification

## 🎯 Vision Statement
A **simple, reliable, and intelligent** browser extension that translates web content seamlessly across multiple AI-powered and traditional providers, with automatic provider selection and failover.

## 🏗️ System Architecture

### Core Principles
- **Simplicity First**: Minimal configuration, maximum automation
- **Provider Agnostic**: Unified interface across all translation services
- **Intelligent Routing**: Automatic provider selection based on cost, speed, and reliability
- **Graceful Degradation**: Seamless failover when providers fail
- **Zero-Config Experience**: Works out-of-the-box with smart defaults

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Extension                        │
├─────────────────────────────────────────────────────────────┤
│  📱 Popup UI           🌐 Content Script    ⚙️ Background    │
│  ├─ Language Selector  ├─ DOM Scanner      ├─ Provider Pool │
│  ├─ Strategy Picker    ├─ Text Injector    ├─ Rate Limiter  │
│  └─ Status Display     └─ Progress Tracker └─ Config Store  │
├─────────────────────────────────────────────────────────────┤
│                    Translation Engine                       │
├─────────────────────────────────────────────────────────────┤
│  🧠 Provider Manager   📊 Usage Tracker    🔄 Cache System  │
│  ├─ Health Monitor     ├─ Cost Calculator  ├─ Memory Cache  │
│  ├─ Load Balancer      ├─ Rate Monitor     └─ Persistence   │
│  └─ Failover Logic     └─ Analytics        └─ Invalidation  │
├─────────────────────────────────────────────────────────────┤
│                     Provider Layer                         │
├─────────────────────────────────────────────────────────────┤
│  🇨🇳 Qwen MT Turbo    🇨🇳 Qwen MT        🔵 DeepL Free     │
│  🔵 DeepL Pro         🤖 Fallback Providers                │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Required Providers Specification

### Primary Providers (Must Have)

#### 1. **Alibaba Cloud Qwen MT Turbo**
```typescript
Provider: {
  id: 'qwen-mt-turbo',
  name: 'Qwen MT Turbo',
  type: 'ai-mt',
  endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message',
  model: 'qwen-mt-turbo',
  features: ['fast', 'cost-effective', 'streaming'],
  limits: {
    requests: 100/minute,
    characters: 50000/minute,
    costPer1K: 0.002
  },
  languages: 100+,
  priority: 1 // Primary choice for speed
}
```

#### 2. **Alibaba Cloud Qwen MT (Standard)**
```typescript
Provider: {
  id: 'qwen-mt',
  name: 'Qwen MT',
  type: 'ai-mt',
  endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message',
  model: 'qwen-mt',
  features: ['high-quality', 'batch-support'],
  limits: {
    requests: 50/minute,
    characters: 30000/minute,
    costPer1K: 0.004
  },
  languages: 100+,
  priority: 2 // Primary choice for quality
}
```

#### 3. **DeepL Free**
```typescript
Provider: {
  id: 'deepl-free',
  name: 'DeepL Free',
  type: 'traditional-mt',
  endpoint: 'https://api-free.deepl.com/v2/translate',
  features: ['high-quality', 'limited-usage'],
  limits: {
    requests: 100/hour,
    characters: 500000/month,
    costPer1K: 0
  },
  languages: 30+,
  priority: 3 // Fallback for quality
}
```

#### 4. **DeepL Pro**
```typescript
Provider: {
  id: 'deepl-pro',
  name: 'DeepL Pro',
  type: 'traditional-mt',
  endpoint: 'https://api.deepl.com/v2/translate',
  features: ['highest-quality', 'unlimited', 'formal-informal'],
  limits: {
    requests: 1000/minute,
    characters: 1000000/minute,
    costPer1K: 0.020
  },
  languages: 30+,
  priority: 4 // Premium option
}
```

## 🎨 User Experience Specification

### Simplified UI Design

#### Popup Interface (320x480px)
```
┌─────────────────────────────────────────┐
│  🌐 TRANSLATE!               ⚙️ Settings │
│                                         │
│  📍 Current Provider: Qwen MT Turbo     │
│  🟢 Status: Ready                       │
│                                         │
│  ┌─────────────────┐  🔄  ┌─────────────┐│
│  │ 🌍 Auto Detect  │ ←→  │ 🇺🇸 English ││
│  └─────────────────┘     └─────────────┘│
│                                         │
│  Strategy: [ Smart ] [ Fast ] [ Quality]│
│                                         │
│  ┌─────────────────────────────────────┐ │
│  │ 🔘 Auto-translate this page         │ │
│  └─────────────────────────────────────┘ │
│                                         │
│  ┌─────────────────────────────────────┐ │
│  │     🎯 Translate Selection          │ │
│  └─────────────────────────────────────┘ │
│                                         │
│  ┌─────────────────────────────────────┐ │
│  │      🌐 Translate Page              │ │
│  └─────────────────────────────────────┘ │
│                                         │
│  📊 Today: 15/100 req, 2.3k/50k chars  │
│  💰 Cost: $0.08 (Budget: $2.00/month)  │
└─────────────────────────────────────────┘
```

#### Context Menu Integration
```
Right-click on selected text:
┌─────────────────────────────┐
│ 🌐 Translate to English     │
│ 🔄 Translate to Auto-detect │
│ ⚙️ Translation Settings     │
└─────────────────────────────┘
```

### User Workflows

#### 1. **First-Time Setup (< 2 minutes)**
1. Install extension
2. Click popup → "Get Started"
3. Choose plan:
   - "Free Plan" → DeepL Free (500k chars/month)
   - "Basic Plan" → Qwen MT Turbo + DeepL Free
   - "Pro Plan" → All providers
4. Enter single API key if needed
5. Test translation → Ready!

#### 2. **Daily Usage**
1. Browse webpage
2. Select text OR right-click → "Translate"
3. Extension auto-selects best provider
4. Translation appears inline with smooth animation
5. Cost/usage tracking in popup

#### 3. **Auto-Translation**
1. Click "Auto-translate this page"
2. Extension detects page language
3. Translates all visible text progressively
4. Shows progress indicator
5. Option to undo/restore original

## 🔧 Technical Specifications

### Dynamic Content Observer Specification

```typescript
class DynamicContentObserver {
  private observer: MutationObserver
  private debounceTimer: number
  private translatedNodes: WeakSet<Node>
  private isAutoTranslateEnabled: boolean

  constructor(private translator: TranslationEngine) {
    this.setupMutationObserver()
  }

  private setupMutationObserver(): void {
    this.observer = new MutationObserver((mutations) => {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.processMutations(mutations)
      }, 500) // Wait for content to settle
    })

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false
    })
  }

  private async processMutations(mutations: MutationRecord[]): Promise<void> {
    if (!this.isAutoTranslateEnabled) return

    const newTextNodes: Text[] = []

    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (this.isTranslatableNode(node)) {
            newTextNodes.push(...this.extractTextNodes(node))
          }
        })
      } else if (mutation.type === 'characterData') {
        if (this.isTranslatableTextNode(mutation.target as Text)) {
          newTextNodes.push(mutation.target as Text)
        }
      }
    })

    // Filter out nodes that are already translated
    const untranslatedNodes = newTextNodes.filter(node =>
      !this.translatedNodes.has(node) &&
      this.shouldTranslateNode(node)
    )

    if (untranslatedNodes.length > 0) {
      await this.translateNewContent(untranslatedNodes)
    }
  }

  private shouldTranslateNode(node: Text): boolean {
    // Skip empty text, whitespace-only, or very short content
    const text = node.textContent?.trim()
    if (!text || text.length < 3) return false

    // Skip technical content (URLs, emails, code)
    if (this.isTechnicalContent(text)) return false

    // Check if parent element is visible
    const element = node.parentElement
    if (!element || !this.isVisible(element)) return false

    // Skip already processed content
    return !this.translatedNodes.has(node)
  }

  private async translateNewContent(textNodes: Text[]): Promise<void> {
    // Batch small nodes together for efficiency
    const batches = this.createBatches(textNodes, 5000) // 5k chars per batch

    for (const batch of batches) {
      try {
        const translations = await this.translator.translateBatch(
          batch.map(node => node.textContent!),
          {
            strategy: 'smart',
            priority: 'background' // Lower priority than user actions
          }
        )

        // Apply translations with smooth animation
        batch.forEach((node, index) => {
          if (translations[index]?.translatedText) {
            this.applyTranslation(node, translations[index])
            this.translatedNodes.add(node)
          }
        })
      } catch (error) {
        console.warn('Dynamic translation failed:', error)
        // Continue with other batches
      }
    }
  }

  enableAutoTranslate(): void {
    this.isAutoTranslateEnabled = true
  }

  disableAutoTranslate(): void {
    this.isAutoTranslateEnabled = false
  }

  destroy(): void {
    this.observer.disconnect()
    clearTimeout(this.debounceTimer)
  }
}
```

### Auto-Translation User Controls

```typescript
interface AutoTranslateControls {
  // Page-level controls
  enablePageAutoTranslate(domain?: string): void
  disablePageAutoTranslate(): void

  // Content type filtering
  setTranslateOptions(options: {
    articles: boolean      // Main content areas
    navigation: boolean    // Menus and navigation
    comments: boolean      // User comments
    captions: boolean      // Video/image captions
    forms: boolean         // Form labels and placeholders
    dynamic: boolean       // Dynamically loaded content
  }): void

  // Performance controls
  setPerformanceMode(mode: 'fast' | 'balanced' | 'thorough'): void

  // Visual feedback
  showTranslationProgress(enabled: boolean): void
}
```

### Provider Manager Interface
```typescript
interface ProviderManager {
  // Core translation method
  translate(text: string, options: TranslateOptions): Promise<TranslationResult>

  // Provider selection
  selectProvider(strategy: 'smart' | 'fast' | 'quality'): Provider

  // Health monitoring
  checkHealth(): Promise<ProviderHealth[]>

  // Usage tracking
  getUsage(timeframe: '1h' | '24h' | '30d'): UsageStats
}

interface TranslateOptions {
  sourceLanguage?: string
  targetLanguage: string
  strategy?: 'smart' | 'fast' | 'quality'
  maxRetries?: number
  timeout?: number
}

interface TranslationResult {
  originalText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  provider: string
  confidence: number
  cost: number
  duration: number
}
```

### Smart Provider Selection Logic
```typescript
class SmartSelector {
  selectProvider(options: {
    textLength: number,
    urgency: 'low' | 'medium' | 'high',
    budget: number,
    quality: 'basic' | 'good' | 'best'
  }): Provider {

    // Algorithm priorities:
    // 1. Provider health (last 5 minutes)
    // 2. Cost efficiency for current usage
    // 3. Speed requirements
    // 4. Quality requirements
    // 5. Rate limit availability

    if (urgency === 'high') return qwenMTTurbo
    if (quality === 'best' && budget > 0.01) return deeplPro
    if (textLength < 1000) return qwenMTTurbo
    return smartSelection()
  }
}
```

### Adaptive Rate Limiting Strategy
```typescript
interface ProviderLimits {
  requestsPerMinute: number
  requestsPerHour: number
  requestsPerDay: number
  charactersPerMinute: number
  charactersPerHour: number
  charactersPerDay: number
  tokensPerMinute?: number
  tokensPerHour?: number
  tokensPerDay?: number
  monthlyQuota?: number
  costLimits?: {
    dailyBudget: number
    monthlyBudget: number
  }
}

class AdaptiveRateLimiter {
  private providerLimits: Map<string, ProviderLimits>
  private usageTracking: Map<string, UsageWindow>
  private quotaMonitor: QuotaMonitor

  constructor() {
    this.initializeProviderLimits()
    this.setupQuotaMonitoring()
  }

  private initializeProviderLimits(): void {
    this.providerLimits.set('qwen-mt-turbo', {
      requestsPerMinute: 100,
      requestsPerHour: 6000,
      requestsPerDay: 144000,
      charactersPerMinute: 50000,
      charactersPerHour: 3000000,
      charactersPerDay: 72000000,
      costLimits: {
        dailyBudget: 10.00,
        monthlyBudget: 300.00
      }
    })

    this.providerLimits.set('qwen-mt', {
      requestsPerMinute: 50,
      requestsPerHour: 3000,
      requestsPerDay: 72000,
      charactersPerMinute: 30000,
      charactersPerHour: 1800000,
      charactersPerDay: 43200000,
      costLimits: {
        dailyBudget: 15.00,
        monthlyBudget: 450.00
      }
    })

    this.providerLimits.set('deepl-free', {
      requestsPerMinute: 5,
      requestsPerHour: 100,
      requestsPerDay: 500,
      charactersPerMinute: 1000,
      charactersPerHour: 20000,
      charactersPerDay: 16667, // 500k/month ÷ 30 days
      monthlyQuota: 500000
    })

    this.providerLimits.set('deepl-pro', {
      requestsPerMinute: 1000,
      requestsPerHour: 60000,
      requestsPerDay: 1440000,
      charactersPerMinute: 1000000,
      charactersPerHour: 60000000,
      charactersPerDay: 1440000000,
      costLimits: {
        dailyBudget: 100.00,
        monthlyBudget: 3000.00
      }
    })
  }

  async canMakeRequest(providerId: string, textLength: number): Promise<{
    allowed: boolean,
    waitTime: number,
    reason?: string,
    suggestedProvider?: string
  }> {
    const limits = this.providerLimits.get(providerId)
    const usage = this.usageTracking.get(providerId)

    if (!limits || !usage) {
      return { allowed: false, waitTime: 0, reason: 'Provider not configured' }
    }

    // Check character limits
    if (usage.charactersThisMinute + textLength > limits.charactersPerMinute) {
      const waitTime = this.calculateWaitTime(usage.lastMinuteReset, 60000)
      return {
        allowed: false,
        waitTime,
        reason: 'Character limit exceeded',
        suggestedProvider: this.findAlternativeProvider(textLength)
      }
    }

    // Check request limits
    if (usage.requestsThisMinute >= limits.requestsPerMinute) {
      const waitTime = this.calculateWaitTime(usage.lastMinuteReset, 60000)
      return {
        allowed: false,
        waitTime,
        reason: 'Request limit exceeded',
        suggestedProvider: this.findAlternativeProvider(textLength)
      }
    }

    // Check daily quota (for free providers)
    if (limits.monthlyQuota && usage.charactersThisMonth + textLength > limits.monthlyQuota) {
      return {
        allowed: false,
        waitTime: this.timeUntilMonthReset(),
        reason: 'Monthly quota exceeded',
        suggestedProvider: this.findAlternativeProvider(textLength)
      }
    }

    // Check cost limits
    if (limits.costLimits) {
      const estimatedCost = this.estimateCost(providerId, textLength)
      if (usage.costToday + estimatedCost > limits.costLimits.dailyBudget) {
        return {
          allowed: false,
          waitTime: this.timeUntilDayReset(),
          reason: 'Daily budget exceeded',
          suggestedProvider: this.findCheaperProvider(textLength)
        }
      }
    }

    return { allowed: true, waitTime: 0 }
  }

  private findAlternativeProvider(textLength: number): string | undefined {
    // Smart provider selection based on availability and suitability
    const availableProviders = Array.from(this.providerLimits.keys())
      .filter(id => this.canMakeRequest(id, textLength).then(r => r.allowed))

    if (availableProviders.length === 0) return undefined

    // Prefer fastest available provider
    const providerPriority = ['qwen-mt-turbo', 'qwen-mt', 'deepl-pro', 'deepl-free']
    return providerPriority.find(id => availableProviders.includes(id)) || availableProviders[0]
  }

  private findCheaperProvider(textLength: number): string | undefined {
    // Find the cheapest available provider
    const availableProviders = Array.from(this.providerLimits.keys())
      .filter(id => this.canMakeRequest(id, textLength).then(r => r.allowed))
      .sort((a, b) => this.estimateCost(a, textLength) - this.estimateCost(b, textLength))

    return availableProviders[0]
  }

  async redistributeLoad(): Promise<void> {
    // Automatically redistribute pending requests across available providers
    const pendingRequests = this.getPendingRequests()

    for (const request of pendingRequests) {
      const originalProvider = request.providerId
      const check = await this.canMakeRequest(originalProvider, request.textLength)

      if (!check.allowed && check.suggestedProvider) {
        request.providerId = check.suggestedProvider
        this.notifyProviderSwitch(originalProvider, check.suggestedProvider, check.reason)
      }
    }
  }

  recordUsage(providerId: string, request: RequestMetrics): void {
    const usage = this.usageTracking.get(providerId) || this.createNewUsageWindow()

    // Update counters
    usage.requestsThisMinute++
    usage.requestsThisHour++
    usage.requestsThisDay++
    usage.charactersThisMinute += request.characterCount
    usage.charactersThisHour += request.characterCount
    usage.charactersThisDay += request.characterCount
    usage.charactersThisMonth += request.characterCount
    usage.costToday += request.cost
    usage.costThisMonth += request.cost

    this.usageTracking.set(providerId, usage)
    this.persistUsageData()
  }

  // Automatic quota management
  setupQuotaMonitoring(): void {
    // Monitor approaching limits and proactively switch providers
    setInterval(() => {
      this.providerLimits.forEach((limits, providerId) => {
        const usage = this.usageTracking.get(providerId)
        if (!usage) return

        // Warn when approaching 80% of any limit
        this.checkQuotaWarnings(providerId, limits, usage)

        // Auto-disable provider when approaching 95% of limit
        this.checkQuotaDisable(providerId, limits, usage)
      })
    }, 30000) // Check every 30 seconds
  }

  private checkQuotaWarnings(providerId: string, limits: ProviderLimits, usage: UsageWindow): void {
    const warnings = []

    if (usage.charactersThisMinute / limits.charactersPerMinute > 0.8) {
      warnings.push('minute character limit')
    }
    if (usage.requestsThisMinute / limits.requestsPerMinute > 0.8) {
      warnings.push('minute request limit')
    }
    if (limits.monthlyQuota && usage.charactersThisMonth / limits.monthlyQuota > 0.8) {
      warnings.push('monthly quota')
    }

    if (warnings.length > 0) {
      this.notifyQuotaWarning(providerId, warnings)
    }
  }
}

interface UsageWindow {
  requestsThisMinute: number
  requestsThisHour: number
  requestsThisDay: number
  charactersThisMinute: number
  charactersThisHour: number
  charactersThisDay: number
  charactersThisMonth: number
  costToday: number
  costThisMonth: number
  lastMinuteReset: number
  lastHourReset: number
  lastDayReset: number
  lastMonthReset: number
}

interface RequestMetrics {
  characterCount: number
  cost: number
  duration: number
  success: boolean
}
```
```

## 🎯 Major Features Implementation

### 1. **Intelligent Provider Selection**
- **Algorithm**: Health + Cost + Speed + Quality scoring
- **Fallback Chain**: Qwen MT Turbo → Qwen MT → DeepL Free → DeepL Pro
- **Learning**: Adapts to user preferences and success rates

### 2. **Unified Rate Limiting**
- **Per-Provider Limits**: Respect individual API constraints
- **Cross-Provider Balancing**: Distribute load optimally
- **Predictive Queueing**: Pre-calculate wait times
- **User Feedback**: Show availability status

### 3. **Smart Caching System**
- **Memory Cache**: Recent translations (30 minutes)
- **Persistent Cache**: Common phrases (30 days)
- **Shared Cache**: Popular translations across users
- **Cache Invalidation**: Smart expiry based on content type

### 4. **Progressive Page Translation**
- **Viewport Priority**: Translate visible content first
- **Batch Optimization**: Group small text nodes
- **Interruptible**: User can cancel/pause translation
- **Undo Support**: Restore original text anytime

### 5. **Dynamic Content Auto-Translation**
- **DOM Mutation Observer**: Real-time detection of content changes
- **Smart Filtering**: Only translate new/modified text nodes
- **Debounced Processing**: Wait for content settling (500ms)
- **Context Preservation**: Maintain translation state during updates
- **Performance Optimization**: Minimal impact on page performance

### 6. **Cost Management**
- **Budget Tracking**: Set monthly spending limits
- **Cost Prediction**: Estimate before translation
- **Provider Switching**: Auto-switch when budget hit
- **Usage Analytics**: Detailed breakdown by provider

### 7. **Quality Assurance**
- **Confidence Scoring**: Show translation reliability
- **A/B Testing**: Compare providers silently
- **User Feedback**: Report poor translations
- **Quality Learning**: Improve provider selection

## 📊 Implementation Roadmap

### Phase 1: Core Foundation (Week 1-2)
- ✅ Simplified popup UI
- ✅ Qwen MT Turbo integration
- ✅ Qwen MT Standard integration
- ✅ Basic provider selection
- ✅ Simple rate limiting

### Phase 2: Provider Ecosystem (Week 3-4)
- ✅ DeepL Free integration
- ✅ DeepL Pro integration
- ✅ Unified provider interface
- ✅ Health monitoring
- ✅ Automatic failover

### Phase 3: Intelligence (Week 5-6)
- ✅ Smart provider selection
- ✅ Cost optimization
- ✅ Usage analytics
- ✅ Progressive page translation
- ✅ Dynamic content auto-translation
- ✅ Quality feedback system

### Phase 4: Polish (Week 7-8)
- ✅ Performance optimization
- ✅ Error handling enhancement
- ✅ User experience refinement
- ✅ Documentation completion
- ✅ Testing & validation

## 🎯 Success Metrics

### User Experience
- **Setup Time**: < 2 minutes (target: 90% of users)
- **Translation Success**: > 98% (target: 99.5%)
- **Response Time**: < 3 seconds (target: < 1 second)
- **User Satisfaction**: > 4.5/5 stars

### Technical Performance
- **Memory Usage**: < 30MB (target: < 20MB)
- **CPU Usage**: < 5% during translation
- **Cache Hit Rate**: > 60% (target: > 80%)
- **Provider Uptime**: > 99.5%

### Business Metrics
- **Cost Efficiency**: < $0.05/1000 chars average
- **Provider Distribution**: Balanced load across all providers
- **User Retention**: > 80% monthly active users
- **API Cost Optimization**: 30% reduction vs current

This design prioritizes simplicity, reliability, and intelligent automation while meeting your specific requirements for Qwen MT and DeepL provider integration.