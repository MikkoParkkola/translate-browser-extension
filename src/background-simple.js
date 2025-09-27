/**
 * Enhanced Background Service Worker for Translation Extension
 * Handles message routing, provider communication, caching, and throttling
 */

// Simple logger - define first before using
const logger = {
  info: (...args) => console.log('[Background]', ...args),
  warn: (...args) => console.warn('[Background]', ...args),
  error: (...args) => console.error('[Background]', ...args),
  debug: (...args) => console.debug('[Background]', ...args)
};

// Load only essential modules immediately for fast startup
logger.info('Service Worker Starting...');
try {
  logger.info('Loading essential modules...');
  // Skip throttle module loading for now - use simple rate limiting instead
  logger.info('Essential modules loaded successfully (simplified mode)');
} catch (error) {
  logger.error('Failed to load essential modules:', error);
  logger.error('Error details:', error.message, error.stack);
}

// Load additional modules on-demand
let advancedModulesLoaded = false;
async function loadAdvancedModules(service) {
  if (advancedModulesLoaded || !service) return;

  try {
    logger.info('Loading advanced modules...');

    if (!service.errorHandler && self.qwenErrorHandler) {
      service.errorHandler = self.qwenErrorHandler;
    }

    if (!service.ge && typeof self.GlossaryExtractor === 'function') {
      service.ge = new self.GlossaryExtractor();
    }

    if (!service.ts && typeof self.IntelligentTextSplitter === 'function') {
      service.ts = new self.IntelligentTextSplitter();
    }

    advancedModulesLoaded = true;
    logger.info('Advanced modules ready');
  } catch (error) {
    logger.error('Failed to load advanced modules:', error);
  }
}

// Simple provider configuration
const PROVIDERS = {
  'google-free': {
    endpoint: 'https://translate.googleapis.com/translate_a/single',
    requiresKey: false,
    label: 'Google (public)'
  },
  'qwen-mt-turbo': {
    endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-mt-turbo'
  },
  'qwen-mt': {
    endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-mt'
  },
  'deepl-free': {
    endpoint: 'https://api-free.deepl.com/v2/translate'
  },
  'deepl-pro': {
    endpoint: 'https://api.deepl.com/v2/translate'
  },
  'hunyuan-local': {
    type: 'local',
    model: 'Hunyuan-MT-7B.i1-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/mradermacher/Hunyuan-MT-7B-i1-GGUF/resolve/main/Hunyuan-MT-7B.i1-Q4_K_M.gguf',
    modelSize: '4.37GB', // Q4_K_M quantized size
    description: 'Local Hunyuan MT 7B model (runs offline)',
    requiresKey: false
  }
};

// Import local model manager and shared modules
const SHARED_MODULES = [
  'localModel-sw.js',
  'lib/logger.js',
  'core/error-handler.js',
  'lib/cache.js',
  'lib/glossaryExtractor.js',
  'lib/textSplitter.js',
  'lib/tm.js',
  'config.js'
];

if (typeof importScripts === 'function') {
  importScripts(...SHARED_MODULES);
} else if (typeof require === 'function') {
  SHARED_MODULES.forEach((modulePath) => {
    try { require('./' + modulePath); } catch (error) { console.warn('Failed to require module:', modulePath, error?.message || error); }
  });
}

// Background service state
class BackgroundService {
  constructor() {
    // Initialize local model manager
    this.localModel = new LocalModelManager();
    logger.info('BackgroundService constructor starting...');
    this.isInitialized = false;
    this.currentConfig = null;
    this.stats = {
      requests: 0,
      tokens: 0,
      errors: 0,
      cacheHits: 0,
      cacheSize: 0
    };

    // Initialize essential features only for fast startup
    this.globalScope = typeof window !== 'undefined' ? window : self;
    this.errorHandler = self.qwenErrorHandler || (this.globalScope && this.globalScope.qwenErrorHandler) || null;

    this.cache = (this.globalScope && this.globalScope.Cache && typeof this.globalScope.Cache.createKey === 'function')
      ? this.globalScope.Cache
      : null;

    // Lightweight translation memory implementation
    this.tmStore = new Map();
    this.tmOrder = new Map();
    this.tmStats = { hits: 0, misses: 0, sets: 0, evictionsTTL: 0, evictionsLRU: 0 };
    this.tmMaxEntries = 5000;
    this.tm = {
      get: (source, target, text) => this.translationMemoryGet(source, target, text),
      set: (source, target, originalText, translatedText, provider = 'unknown') =>
        this.translationMemorySet(source, target, originalText, translatedText, provider),
      getStats: () => this.translationMemoryStats(),
      searchSimilar: (text, source, target, threshold = 0.8) =>
        this.translationMemorySearchSimilar(text, source, target, threshold)
    };

    // Advanced feature placeholders (instantiated lazily if available)
    this.ge = typeof self.GlossaryExtractor === 'function' ? new self.GlossaryExtractor() : null;
    this.ts = typeof self.IntelligentTextSplitter === 'function' ? new self.IntelligentTextSplitter() : null;

    this.languageDetector = null;
    this.qualityVerifier = null;
    this.performanceMonitor = null;
    this.glossaryExtractor = null;
    this.domOptimizer = null;
    this.adaptiveLimitDetector = null;
    this.offlineDetector = null;
    this.feedbackCollector = null;
    this.securityEnhancements = null;
    this.advancedConfiguration = null;
    this.intelligentLanguageSelection = null;

    // Configure throttling - simplified without external module
    this.throttle = false; // Disable advanced throttling for stability

    // Simple built-in rate limiting
    this.simpleRateLimit = {
      requests: 0,
      tokens: 0,
      windowStart: Date.now(),
      requestLimit: 60,   // requests per minute
      tokenLimit: 100000, // tokens per minute
      windowMs: 60000     // 1 minute
    };

    // Language Detector will be initialized lazily when needed

    // Quality Verifier will be initialized lazily when needed

    // All advanced features (Performance Monitor, Text Splitter, Glossary Extractor,
    // DOM Optimizer, Adaptive Limit Detector, Offline Detector, Feedback Collector,
    // Intelligent Language Selection, Security Enhancements, Advanced Configuration)
    // are deferred to lazy loading via ensureAdvancedModulesLoaded() for fast startup

    logger.info('BackgroundService constructor completed - advanced features will load on demand');
  }

  normalizeTMKey(sourceLanguage, targetLanguage, text) {
    const safeSource = (sourceLanguage || 'auto').toLowerCase();
    const safeTarget = (targetLanguage || 'en').toLowerCase();
    const normalizedText = (text || '')
      .toString()
      .trim()
      .normalize('NFC')
      .toLowerCase();
    return `${safeSource}:${safeTarget}:${normalizedText}`;
  }

  async translationMemoryGet(sourceLanguage, targetLanguage, text) {
    if (!text) {
      this.tmStats.misses++;
      return null;
    }

    const key = this.normalizeTMKey(sourceLanguage, targetLanguage, text);
    const record = this.tmStore.get(key);

    if (!record) {
      this.tmStats.misses++;
      return null;
    }

    const { expiresAt } = record;
    if (expiresAt && Date.now() > expiresAt) {
      this.tmStore.delete(key);
      this.tmOrder.delete(key);
      this.tmStats.evictionsTTL++;
      this.tmStats.misses++;
      return null;
    }

    this.tmStats.hits++;
    this.tmOrder.set(key, Date.now());
    return { ...record, cached: true };
  }

  async translationMemorySet(sourceLanguage, targetLanguage, originalText, translatedText, provider = 'unknown') {
    if (!originalText || !translatedText) return null;

    const key = this.normalizeTMKey(sourceLanguage, targetLanguage, originalText);
    const entry = {
      text: translatedText,
      source: sourceLanguage,
      target: targetLanguage,
      provider,
      timestamp: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    };

    this.tmStore.set(key, entry);
    this.tmOrder.set(key, entry.timestamp);
    this.tmStats.sets++;

    if (this.tmStore.size > this.tmMaxEntries) {
      const oldestKey = [...this.tmOrder.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
      if (oldestKey) {
        this.tmStore.delete(oldestKey);
        this.tmOrder.delete(oldestKey);
        this.tmStats.evictionsLRU++;
      }
    }

    return entry;
  }

  translationMemoryStats() {
    return {
      ...this.tmStats,
      entries: this.tmStore.size
    };
  }

  translationMemorySearchSimilar(text, sourceLanguage, targetLanguage, threshold = 0.8) {
    if (!text) return null;
    const baseKey = this.normalizeTMKey(sourceLanguage, targetLanguage, text);
    const direct = this.tmStore.get(baseKey);
    if (direct) return direct;

    // Extremely lightweight similarity: try trimmed variants
    const trimmed = text.trim();
    if (trimmed !== text) {
      const altKey = this.normalizeTMKey(sourceLanguage, targetLanguage, trimmed);
      const alt = this.tmStore.get(altKey);
      if (alt) return alt;
    }

    // No fuzzy matching implemented in simplified cache
    return null;
  }

  // Simple rate limiting helper
  checkRateLimit(tokensNeeded = 0) {
    const now = Date.now();

    // Reset window if enough time has passed
    if (now - this.simpleRateLimit.windowStart >= this.simpleRateLimit.windowMs) {
      this.simpleRateLimit.requests = 0;
      this.simpleRateLimit.tokens = 0;
      this.simpleRateLimit.windowStart = now;
    }

    // Check if we would exceed limits
    if (this.simpleRateLimit.requests >= this.simpleRateLimit.requestLimit ||
        this.simpleRateLimit.tokens + tokensNeeded > this.simpleRateLimit.tokenLimit) {
      return false; // Rate limit exceeded
    }

    // Update counters
    this.simpleRateLimit.requests++;
    this.simpleRateLimit.tokens += tokensNeeded;
    return true; // Request allowed
  }

  // Simple token approximation
  approxTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Detect language boundaries in mixed-language text
   */
  detectLanguageBoundaries(text, sourceLanguage, targetLanguage) {
    // Simple heuristic: split on common separators that often separate languages
    // This could be enhanced with actual language detection per segment
    const segments = text.split(/([\s,;:()\[\]{}"'`~@#$%^&*+=|\\<>/?]+)/);
    const result = [];

    for (const segment of segments) {
      if (!segment.trim()) {
        result.push({ text: segment, needsTranslation: false, isWhitespace: true });
        continue;
      }

      // Basic language detection heuristics
      let needsTranslation = true;

      // If target is English and segment is already English-like, don't translate
      if (targetLanguage === 'en' && /^[a-zA-Z0-9\s.,!?;:()\-'"]+$/.test(segment)) {
        // Check for common English words
        const englishWords = /\b(the|and|or|a|an|is|are|was|were|be|been|have|has|had|do|does|did|will|would|could|should|can|may|might|must|shall|this|that|these|those|i|you|he|she|it|we|they|me|him|her|us|them|my|your|his|her|its|our|their|what|when|where|who|why|how|which|some|any|all|each|every|no|not|only|just|also|even|still|yet|already|now|then|here|there|more|most|much|many|few|little|less|very|quite|rather|too)\b/gi;
        const englishMatches = (segment.match(englishWords) || []).length;
        const words = segment.split(/\s+/).filter(w => w.trim()).length;

        if (words > 0 && englishMatches / words > 0.3) {
          needsTranslation = false;
        }
      }

      // Check for numbers, URLs, emails, etc. that shouldn't be translated
      if (/^[0-9.,\-+$€£¥%@]+$/.test(segment.trim()) ||
          /^https?:\/\//.test(segment) ||
          /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(segment)) {
        needsTranslation = false;
      }

      result.push({
        text: segment,
        needsTranslation,
        isWhitespace: false
      });
    }

    return result;
  }

  /**
   * Recursively split and translate text when content moderation blocks it
   * Now with improved mixed-language handling
   */
  async splitAndTranslate(text, sourceLanguage, targetLanguage, config, provider, depth = 0) {
    const maxDepth = 5; // Prevent infinite recursion

    if (depth > maxDepth) {
      logger.warn('Max split depth reached, returning original text');
      return text;
    }

    try {
      // First try translating the full text
      const result = await this.performTranslationDirect(text, sourceLanguage, targetLanguage, config, provider);
      return result.translatedText || result.text;
    } catch (error) {
      if (!error.message?.includes('DataInspectionFailed')) {
        // If it's not a content filter issue, don't split
        throw error;
      }

      logger.info(`Content filter hit at depth ${depth}, splitting text (${text.length} chars)`);

      // Strategy 0: Smart language boundary detection (new!)
      if (depth === 0) {
        const segments = this.detectLanguageBoundaries(text, sourceLanguage, targetLanguage);
        if (segments.length > 1) {
          logger.info(`Detected ${segments.length} language segments, translating selectively`);
          const translatedParts = [];

          for (const segment of segments) {
            if (segment.needsTranslation && !segment.isWhitespace) {
              try {
                const translated = await this.splitAndTranslate(segment.text, sourceLanguage, targetLanguage, config, provider, depth + 1);
                translatedParts.push(translated);
                logger.info('Translated segment', {
                  segmentLength: segment.text.length,
                  translatedLength: translated.length
                });
              } catch (segmentError) {
                logger.warn('Segment translation failed, keeping original text', {
                  segmentLength: segment.text.length
                });
                translatedParts.push(segment.text);
              }
            } else {
              translatedParts.push(segment.text); // Keep as-is (whitespace or already in target language)
              if (!segment.isWhitespace) {
                logger.info('Keeping segment as-is', {
                  segmentLength: segment.text.length,
                  targetLanguage
                });
              }
            }
          }
          return translatedParts.join('');
        }
      }

      // Strategy 1: Split by sentences (periods, exclamation marks, question marks)
      if (depth <= 1) {
        const sentences = text.split(/([.!?]+\s*)/).filter(s => s.trim() || /[.!?]/.test(s));
        if (sentences.length > 1) {
          const translatedParts = [];
          for (const sentence of sentences) {
            if (sentence.trim()) {
              const translated = await this.splitAndTranslate(sentence, sourceLanguage, targetLanguage, config, provider, depth + 1);
              translatedParts.push(translated);
            } else {
              translatedParts.push(sentence); // Keep punctuation/whitespace as-is
            }
          }
          return translatedParts.join('');
        }
      }

      // Strategy 2: Split by words
      if (depth <= 2) {
        const words = text.split(/(\s+)/).filter(s => s); // Keep whitespace
        if (words.length > 1) {
          const translatedParts = [];
          for (const word of words) {
            if (word.trim()) {
              const translated = await this.splitAndTranslate(word, sourceLanguage, targetLanguage, config, provider, depth + 1);
              translatedParts.push(translated);
            } else {
              translatedParts.push(word); // Keep whitespace as-is
            }
          }
          return translatedParts.join('');
        }
      }

      // Strategy 3: Split in half (for phrases or compound words)
      if (depth <= 3 && text.length > 2) {
        const midPoint = Math.floor(text.length / 2);
        // Try to split at a space near the middle to avoid breaking words
        let splitPoint = midPoint;
        for (let i = midPoint; i >= midPoint - 10 && i > 0; i--) {
          if (text[i] === ' ') {
            splitPoint = i;
            break;
          }
        }

        const firstHalf = text.substring(0, splitPoint);
        const secondHalf = text.substring(splitPoint);

        if (firstHalf && secondHalf) {
          const firstTranslated = await this.splitAndTranslate(firstHalf, sourceLanguage, targetLanguage, config, provider, depth + 1);
          const secondTranslated = await this.splitAndTranslate(secondHalf, sourceLanguage, targetLanguage, config, provider, depth + 1);
          return firstTranslated + secondTranslated;
        }
      }

      // Strategy 4: Character-by-character (last resort)
      if (text.length > 1) {
        logger.info('Trying character-by-character split', {
          textLength: text.length
        });
        const chars = text.split('');
        const translatedChars = [];

        for (const char of chars) {
          try {
            const translated = await this.performTranslationDirect(char, sourceLanguage, targetLanguage, config, provider);
            translatedChars.push(translated.translatedText || translated.text || char);
          } catch (charError) {
            // If even a single character fails, keep it as-is
            translatedChars.push(char);
          }
        }
        return translatedChars.join('');
      }

      // If all else fails, return the original text
      logger.info('All split strategies failed, keeping original text', {
        textLength: text.length
      });
      return text;
    }
  }

  /**
   * Direct translation without additional processing (used by splitAndTranslate)
   */
  async performTranslationDirect(text, sourceLanguage, targetLanguage, config, provider) {
    // This is a simplified version of performTranslation without caching and advanced features
    // to avoid recursive issues during splitting

    if (config.provider === 'google-free') {
      return await this.translateWithGoogleFree(text, sourceLanguage, targetLanguage, config, provider);
    }

    if (config.provider === 'hunyuan-local') {
      return await this.translateWithLocal(text, sourceLanguage, targetLanguage, config, provider);
    }

    const payload = {
      model: provider.model,
      messages: [{
        role: "user",
        content: `Translate the following text from ${sourceLanguage === 'auto' ? 'auto-detected language' : sourceLanguage} to ${targetLanguage}:\n\n${text}`
      }],
      temperature: 0.1,
      max_tokens: 4000
    };

    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorObj;
      try {
        errorObj = JSON.parse(errorText);
      } catch (e) {
        errorObj = { message: errorText };
      }

      throw new Error(`Qwen API error: ${response.status} - ${JSON.stringify(errorObj)}`);
    }

    const result = await response.json();
    const translatedText = result.choices?.[0]?.message?.content ||
                          // Fallback to old MT format
                          result.output?.target_text ||
                          result.output?.translated_text ||
                          result.output?.translation ||
                          result.output?.text ||
                          text;

    return {
      text: translatedText.trim(),
      translatedText: translatedText.trim(),
      detectedLanguage: sourceLanguage,
      provider: config.provider
    };
  }

  /**
   * Apply configuration overrides to existing systems
   */
  applyConfigurationOverrides() {
    if (!this.ac) return;

    try {
      // Update translation settings
      const maxInputLength = this.ac.get('translation.maxInputLength');
      if (maxInputLength) {
        this.maxInputLength = maxInputLength;
      }

      // Update security settings - simplified without security enhancement module
      const sanitizationLevel = this.ac.get('security.sanitizationLevel');
      if (sanitizationLevel) {
        this.sanitizationLevel = sanitizationLevel || 'basic';
      }

      // Update performance settings
      const maxCacheSize = this.ac.get('performance.maxCacheSize');
      if (this.cache && maxCacheSize) {
        this.globalScope.Cache.configure({ maxEntries: maxCacheSize });
      }

      // Enable/disable features based on configuration
      this.updateFeatureAvailability();

      if (this.options?.debug) {
        logger.info('Applied configuration overrides');
      }

    } catch (error) {
      logger.error('Failed to apply configuration overrides:', error);
    }
  }

  /**
   * Update feature availability based on configuration
   */
  updateFeatureAvailability() {
    if (!this.ac) return;

    // Check if features should be enabled/disabled
    const features = {
      intelligentLanguageSelection: this.ac.isFeatureEnabled('intelligentLanguageSelection'),
      adaptiveLimitDetection: this.ac.isFeatureEnabled('adaptiveLimitDetection'),
      offlineSupport: this.ac.isFeatureEnabled('offlineSupport'),
      glossaryExtraction: this.ac.isFeatureEnabled('glossaryExtraction'),
      qualityVerification: this.ac.isFeatureEnabled('qualityVerification'),
      performanceMonitoring: this.ac.isFeatureEnabled('performanceMonitoring'),
      feedbackCollection: this.ac.isFeatureEnabled('feedbackCollection'),
      securityEnhancements: this.ac.isFeatureEnabled('securityEnhancements'),
      textSplitting: this.ac.isFeatureEnabled('textSplitting'),
      domOptimization: this.ac.isFeatureEnabled('domOptimization'),
      translationMemory: this.ac.isFeatureEnabled('translationMemory')
    };

    // Store feature states for runtime checks
    this.enabledFeatures = features;

    if (this.options?.debug) {
      logger.info('Updated feature availability:', features);
    }
  }

  async initialize() {
    if (this.isInitialized) return;

    logger.info('Initializing background service...');

    try {
      // Load configuration
      this.currentConfig = await this.loadConfig();

      // Set up message listeners
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender, sendResponse);
        return true; // Keep message channel open for async response
      });

      // Set up context menu
      await this.setupContextMenu();

      this.isInitialized = true;
      logger.info('Background service initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize background service:', error);
    }
  }

  // Lazy load advanced modules when needed
  async ensureAdvancedModulesLoaded() {
    await loadAdvancedModules(this);
  }

  resolveProvider(candidate, providers = {}) {
    if (!candidate) return null;
    const normalized = String(candidate).toLowerCase();

    if (normalized === 'hunyuan-local') {
      const canTranslate = this.localModel &&
        typeof this.localModel.isModelAvailable === 'function' &&
        typeof this.localModel.supportsTranslation === 'function' &&
        this.localModel.isModelAvailable() &&
        this.localModel.supportsTranslation();

      if (canTranslate) {
        return { mapped: 'hunyuan-local', source: candidate };
      }
      return null;
    }

    if (normalized === 'google-free' || normalized === 'google') {
      return { mapped: 'google-free', source: candidate };
    }

    if (PROVIDERS[normalized]) {
      return { mapped: normalized, source: candidate };
    }

    if (['dashscope', 'qwen', 'qwen-mt', 'qwen-mt-turbo'].includes(normalized)) {
      return { mapped: 'qwen-mt-turbo', source: candidate };
    }

    if (['deepl', 'deepl-pro'].includes(normalized)) {
      return { mapped: 'deepl-pro', source: candidate };
    }

    if (normalized === 'deepl-free') {
      return { mapped: 'deepl-free', source: candidate };
    }

    return null;
  }

  async loadConfig() {
    try {
      const loader = (this.globalScope && this.globalScope.qwenLoadConfig)
        || (typeof require === 'function' ? require('./config.js').qwenLoadConfig : null);

    const config = loader ? await loader() : {
      providerOrder: ['google-free'],
      providers: {},
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      strategy: 'smart',
      autoTranslate: false,
        apiKey: ''
      };

      this.fullConfig = config;

      const providers = config.providers || {};
      const order = Array.isArray(config.providerOrder) ? config.providerOrder : [];
    const preferenceList = [config.provider, ...order, 'google-free', 'hunyuan-local', 'dashscope', 'qwen', 'qwen-mt-turbo', 'deepl-pro', 'deepl-free']
      .filter(Boolean);

    let resolved = 'google-free';
    let sourceKey = 'google-free';

      for (const candidate of preferenceList) {
        const resolution = this.resolveProvider(candidate, providers);
        if (resolution) {
          resolved = resolution.mapped;
          sourceKey = resolution.source;
          break;
        }
      }

      const providerConfig = providers[sourceKey] || providers[resolved] || {};
      let apiKey = providerConfig.apiKey || config.apiKey || '';
      if (typeof apiKey === 'string' && apiKey.trim().toLowerCase() === 'local-model') {
        apiKey = '';
      }

      if (resolved === 'hunyuan-local' || resolved === 'google-free') {
        apiKey = '';
      }

      return {
        provider: resolved,
        apiKey: apiKey ? apiKey.trim() : '',
        sourceLanguage: config.sourceLanguage || 'auto',
        targetLanguage: config.targetLanguage || 'en',
        strategy: config.strategy || config.translationStrategy || 'smart',
        autoTranslateEnabled: !!(config.autoTranslate || config.autoTranslateEnabled)
      };
    } catch (error) {
      logger.error('Failed to load config:', error);
    return {
      provider: 'google-free',
      apiKey: '',
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      strategy: 'smart',
        autoTranslateEnabled: false
      };
    }
  }

  async getConfig() {
    if (!this.currentConfig) {
      this.currentConfig = await this.loadConfig();
    }
    return this.currentConfig;
  }

  async setupContextMenu() {
    try {
      // Remove all context menus first to prevent duplicates
      await new Promise((resolve) => {
        chrome.contextMenus.removeAll(resolve);
      });

      // Small delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Create new context menu
      chrome.contextMenus.create({
        id: 'translate-selection',
        title: 'Translate "%s"',
        contexts: ['selection']
      }, () => {
        if (chrome.runtime.lastError) {
          logger.warn('Context menu creation issue:', chrome.runtime.lastError.message);
        } else {
          logger.info('Context menu created successfully');
        }
      });
    } catch (error) {
      logger.error('Failed to setup context menu:', error);
    }
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      logger.info('Received message:', request.type || request.action, 'from tab:', sender.tab?.id);

      // Validate the request
      if (!request || (!request.type && !request.action)) {
        logger.warn('Invalid message received:', request);
        sendResponse({ success: false, error: 'Invalid message format' });
        return;
      }

      // Ensure background service is initialized
      if (!this.isInitialized) {
        logger.warn('Background service not initialized, initializing now...');
        await this.initialize();
      }

      switch (request.type || request.action) {
        case 'translate':
          await this.handleTranslation(request, sendResponse);
          break;

        case 'translateBatch':
          logger.info('Handling translateBatch request with', request.texts?.length, 'texts');
          await this.handleBatchTranslation(request, sender, sendResponse);
          break;

        case 'ping':
          logger.info('Received ping from tab:', sender.tab?.id);
          sendResponse({ success: true, message: 'Background service is alive' });
          break;

        case 'getConfig':
          sendResponse({ success: true, config: this.currentConfig });
          break;

        case 'updateConfig':
          await this.updateConfig(request.config);
          sendResponse({ success: true });
          break;

        case 'getStats':
          const enhancedStats = { ...this.stats };

          // Add cache stats if available
          if (this.cache) {
            const cacheStats = this.globalScope.Cache.getStats();
            enhancedStats.cache = {
              size: cacheStats.size,
              maxEntries: cacheStats.maxEntries,
              hitRate: this.stats.requests > 0 ? (this.stats.cacheHits / this.stats.requests) : 0,
              expired: cacheStats.expired
            };
          }

          // Add simple rate limit stats
          const timeUntilReset = Math.max(0, this.simpleRateLimit.windowMs - (Date.now() - this.simpleRateLimit.windowStart));
          enhancedStats.throttle = {
            requests: this.simpleRateLimit.requests,
            requestLimit: this.simpleRateLimit.requestLimit,
            tokens: this.simpleRateLimit.tokens,
            tokenLimit: this.simpleRateLimit.tokenLimit,
            resetIn: timeUntilReset,
            utilization: {
              requests: this.simpleRateLimit.requests / this.simpleRateLimit.requestLimit,
              tokens: this.simpleRateLimit.tokens / this.simpleRateLimit.tokenLimit
            }
          };

          // Add Translation Memory stats if available
          if (this.tm) {
            const tmStats = this.tm.getStats();
            enhancedStats.translationMemory = {
              cacheSize: tmStats.cacheSize,
              maxEntries: tmStats.maxEntries,
              hits: tmStats.hits,
              misses: tmStats.misses,
              sets: tmStats.sets,
              hitRate: tmStats.hitRate,
              evictionsLRU: tmStats.evictionsLRU,
              evictionsTTL: tmStats.evictionsTTL,
              dbAvailable: tmStats.dbAvailable,
              syncEnabled: tmStats.syncEnabled,
              dbErrors: tmStats.dbErrors,
              syncErrors: tmStats.syncErrors
            };
          }

          sendResponse({ success: true, stats: enhancedStats });
          break;

        case 'glossary:add':
          await this.handleGlossaryAdd(request, sendResponse);
          break;

        case 'glossary:remove':
          await this.handleGlossaryRemove(request, sendResponse);
          break;

        case 'glossary:get':
          await this.handleGlossaryGet(request, sendResponse);
          break;

        case 'glossary:export':
          await this.handleGlossaryExport(request, sendResponse);
          break;

        case 'glossary:import':
          await this.handleGlossaryImport(request, sendResponse);
          break;

        case 'glossary:extract':
          await this.handleGlossaryExtract(request, sendResponse);
          break;

        case 'dom:queue':
          await this.handleDOMQueue(request, sender, sendResponse);
          break;

        case 'dom:metrics':
          await this.handleDOMMetrics(request, sender, sendResponse);
          break;

        case 'dom:cleanup':
          await this.handleDOMCleanup(request, sender, sendResponse);
          break;

        case 'limit:status':
          await this.handleLimitStatus(request, sender, sendResponse);
          break;

        case 'limit:circuitBreaker':
          await this.handleCircuitBreakerStatus(request, sender, sendResponse);
          break;

        case 'limit:requestAllowed':
          await this.handleRequestAllowed(request, sender, sendResponse);
          break;

        case 'limit:cleanup':
          await this.handleLimitDetectorCleanup(request, sender, sendResponse);
          break;

        case 'offline:status':
          await this.handleOfflineStatus(request, sender, sendResponse);
          break;

        case 'offline:connectivityCheck':
          await this.handleConnectivityCheck(request, sender, sendResponse);
          break;

        case 'offline:retryQueue':
          await this.handleRetryQueue(request, sender, sendResponse);
          break;

        case 'offline:cleanup':
          await this.handleOfflineDetectorCleanup(request, sender, sendResponse);
          break;

        case 'feedback:collect':
          await this.handleFeedbackCollection(request, sender, sendResponse);
          break;

        case 'feedback:analytics':
          await this.handleFeedbackAnalytics(request, sender, sendResponse);
          break;

        case 'feedback:prompt':
          await this.handleFeedbackPrompt(request, sender, sendResponse);
          break;

        case 'feedback:status':
          await this.handleFeedbackStatus(request, sender, sendResponse);
          break;

        case 'language:select':
          await this.handleLanguageSelection(request, sender, sendResponse);
          break;

        case 'language:learn':
          await this.handleLanguageLearning(request, sender, sendResponse);
          break;

        case 'language:preferences':
          await this.handleLanguagePreferences(request, sender, sendResponse);
          break;

        case 'language:status':
          await this.handleLanguageStatus(request, sender, sendResponse);
          break;

        case 'security:sanitize':
          await this.handleSecuritySanitization(request, sender, sendResponse);
          break;

        case 'security:validate':
          await this.handleSecurityValidation(request, sender, sendResponse);
          break;

        case 'security:status':
          await this.handleSecurityStatus(request, sender, sendResponse);
          break;

        case 'config:get':
          await this.handleConfigGet(request, sender, sendResponse);
          break;

        case 'config:set':
          await this.handleConfigSet(request, sender, sendResponse);
          break;

        case 'config:reload':
          this.currentConfig = null;
          this.fullConfig = null;
          this.currentConfig = await this.loadConfig();
          sendResponse({ success: true, provider: this.currentConfig.provider });
          break;

        case 'config:feature':
          await this.handleConfigFeature(request, sender, sendResponse);
          break;

        case 'config:status':
          await this.handleConfigStatus(request, sender, sendResponse);
          break;

        case 'localModel:download':
          await this.handleLocalModelDownload(request, sender, sendResponse);
          break;

        case 'localModel:status':
          await this.handleLocalModelStatus(request, sender, sendResponse);
          break;

        case 'localModel:delete':
          await this.handleLocalModelDelete(request, sender, sendResponse);
          break;

        case 'localModel:progress':
          await this.handleLocalModelProgress(request, sender, sendResponse);
          break;

        case 'checkLocalModelStatus':
          await this.handleLocalModelStatus(request, sendResponse);
          break;

        default:
          logger.warn('Unknown message type:', request.type || request.action);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleTranslation(request, sendResponse) {
    // Ensure advanced modules are loaded for translation features
    await this.ensureAdvancedModulesLoaded();

    const startTime = Date.now();
    const requestId = null; // Performance monitoring disabled

    try {
      const { text, source, target } = request;
      logger.info('Translation request received', {
        textLength: typeof text === 'string' ? text.length : 0,
        sourceLanguage: source,
        targetLanguage: target
      });

      if (!text || !text.trim()) {
        logger.warn('No text provided for translation');
        // Performance monitoring disabled
        sendResponse({ success: false, error: 'No text provided' });
        return;
      }

      // Security: Basic text validation
      let sanitizedText = text;

      // Basic security checks without the security enhancement module
      if (text.length > 50000) {
        logger.warn('Text too long for translation:', text.length);
        sendResponse({
          success: false,
          error: 'Text too long (max 50,000 characters)'
        });
        return;
      }

      // Basic sanitization - remove potential script tags
      sanitizedText = text.replace(/<script[^>]*>.*?<\/script>/gi, '')
                          .replace(/javascript:/gi, '')
                          .replace(/on\w+=/gi, '');

      logger.info(`Processing translation for ${text.split('\n').length} text segments`);

      // Get current config
      const config = await this.loadConfig();
      const sourceLanguage = source || config.sourceLanguage;
      const targetLanguage = target || config.targetLanguage;

      logger.info(`Using provider: ${config.provider}, source: ${sourceLanguage}, target: ${targetLanguage}`);

      // Check Translation Memory first (persistent across sessions)
      if (this.tm) {
        const tmResult = await this.tm.get(sourceLanguage, targetLanguage, sanitizedText);
        if (tmResult) {
          // Basic sanitization of translation memory result
          let sanitizedTranslation = tmResult.text
            ?.replace(/<script[^>]*>.*?<\/script>/gi, '')
            ?.replace(/javascript:/gi, '')
            ?.replace(/on\w+=/gi, '') || tmResult.text;

          this.stats.cacheHits++;
          logger.info('Translation served from Translation Memory');
          // Performance monitoring disabled
          sendResponse({
            success: true,
            translatedText: sanitizedTranslation,
            detectedLanguage: tmResult.source,
            provider: tmResult.provider,
            translationMemory: true,
            latency: Date.now() - startTime
          });
          return;
        }
      }

      // Check session cache second (faster but temporary)
      let cacheKey = null;
      let cachedResult = null;
      if (this.cache) {
        cacheKey = this.globalScope.Cache.createKey(sourceLanguage, targetLanguage, sanitizedText);
        cachedResult = this.globalScope.Cache.get(cacheKey);

        if (cachedResult) {
          // Basic sanitization of cached result
          let sanitizedCachedResult = { ...cachedResult };
          if (cachedResult.translatedText) {
            // Basic output sanitization
            sanitizedCachedResult.translatedText = cachedResult.translatedText
              .replace(/<script[^>]*>.*?<\/script>/gi, '')
              .replace(/javascript:/gi, '')
              .replace(/on\w+=/gi, '');
          }

          this.stats.cacheHits++;
          logger.info('Translation served from session cache');
          // Performance monitoring disabled
          sendResponse({
            success: true,
            ...sanitizedCachedResult,
            cached: true,
            latency: Date.now() - startTime
          });
          return;
        }
      }

      // Get provider info
      const provider = PROVIDERS[config.provider];
      if (!provider) {
        logger.error('Provider not supported:', config.provider);
        // Performance monitoring disabled
        sendResponse({ success: false, error: `Provider not supported: ${config.provider}` });
        return;
      }

      const requiresKey = provider.requiresKey !== false;
      if (requiresKey && !config.apiKey) {
        logger.warn('API key not configured');
        sendResponse({ success: false, error: 'API key not configured. Please configure your API key in settings.' });
        return;
      }

      // Check throttling with simple rate limiting (skip for local models)
      if (config.provider !== 'hunyuan-local') {
        const tokensNeeded = this.approxTokens(sanitizedText);

        if (!this.checkRateLimit(tokensNeeded)) {
          logger.warn('Rate limit would be exceeded');
          sendResponse({
            success: false,
            error: 'Rate limit exceeded. Please wait a moment before retrying.',
            latency: Date.now() - startTime
          });
          return;
        }
      } else {
        logger.info('Skipping rate limiting for local model');
      }

      // Perform translation with error handling - rate limiting already checked above
      let result;
      try {
        result = await this.performTranslation(sanitizedText, sourceLanguage, targetLanguage, config, provider);
      } catch (error) {
        throw error; // Re-throw for handling below
      }

      // Cache the result
      if (this.cache && cacheKey && result) {
        this.globalScope.Cache.set(cacheKey, result);
      }

      // Basic sanitization of API response
      if (result && result.translatedText) {
        result.translatedText = result.translatedText
          .replace(/<script[^>]*>.*?<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+=/gi, '');
      }

      // Store in Translation Memory for persistent caching
      if (this.tm && result && result.translatedText) {
        try {
          await this.tm.set(
            sourceLanguage,
            targetLanguage,
            sanitizedText, // Store with sanitized input
            result.translatedText, // Already sanitized above
            config.provider
          );
        } catch (tmError) {
          logger.warn('Failed to store translation in TM:', tmError);
        }
      }

      // Update stats
      this.stats.requests++;
      this.stats.tokens += tokensNeeded;
      if (this.cache) {
        this.stats.cacheSize = this.globalScope.Cache.getStats().size;
      }

      logger.info('Translation successful');
      // Performance monitoring disabled
      sendResponse({
        success: true,
        ...result,
        cached: false,
        latency: Date.now() - startTime
      });

    } catch (error) {
      // Try splitting strategy for content filter and parameter limit errors
      if (error.message?.includes('DataInspectionFailed') || error.message?.includes('Parameter limit exceeded')) {
        logger.info(`Single translation rejected (${error.message?.includes('DataInspectionFailed') ? 'content filter' : 'parameter limit'}) - attempting split strategy`);

        try {
          const config = await this.loadConfig();
          const provider = PROVIDERS[config.provider];
          const splitResult = await this.splitAndTranslate(sanitizedText, sourceLanguage, targetLanguage, config, provider);

          // Cache the result
          if (this.cache && cacheKey) {
            this.globalScope.Cache.set(cacheKey, { text: splitResult, translatedText: splitResult });
          }

          // Update stats for successful split translation
          this.stats.requests++;
          this.stats.tokens += this.approxTokens(sanitizedText);
          if (this.cache) {
            this.stats.cacheSize = this.globalScope.Cache.getStats().size;
          }

          logger.info('Single translation successful using split strategy');
          sendResponse({
            success: true,
            translatedText: splitResult,
            detectedLanguage: sourceLanguage,
            provider: config.provider,
            splitStrategy: true,
            latency: Date.now() - startTime
          });
          return;

        } catch (splitError) {
          logger.warn('Split strategy also failed for single translation:', splitError.message);
          // Fall through to regular error handling
        }
      }

      this.stats.errors++;

      // Use error handler if available
      const handledError = this.errorHandler
        ? this.errorHandler.handle(error, { operation: 'translate', textLength: request.text?.length })
        : { error: error.message };

      logger.error('Translation failed:', error);
      // Performance monitoring disabled
      sendResponse({
        success: false,
        error: handledError.error || error.message,
        latency: Date.now() - startTime
      });
    }
  }

  async handleBatchTranslation(request, sender, sendResponse) {
    // Ensure advanced modules are loaded for batch translation features
    await this.ensureAdvancedModulesLoaded();

    // Keep service worker alive during batch translation
    const keepAliveInterval = setInterval(() => {
      logger.info('Keeping service worker alive during translation...');
    }, 20000); // Keep alive every 20 seconds

    const startTime = Date.now();
    const totalTextLength = request.texts ? request.texts.reduce((sum, text) => sum + text.length, 0) : 0;
    const requestId = null; // Performance monitoring disabled

    try {
      const { texts, sourceLanguage, targetLanguage } = request;
      logger.info(`Batch translation request: ${texts.length} texts`);

      // Simple rate limiting enabled
      logger.info('Using simple rate limiting for batch translation');

      if (!texts || !Array.isArray(texts) || texts.length === 0) {
        logger.warn('No texts provided for batch translation');
        // Performance monitoring disabled
        sendResponse({ success: false, error: 'No texts provided' });
        return;
      }

      // Get current config
      const config = await this.loadConfig();
      const source = sourceLanguage || config.sourceLanguage;
      const target = targetLanguage || config.targetLanguage;

      logger.info(`Using provider: ${config.provider}, source: ${source}, target: ${target}`);

      // Get provider info
      const provider = PROVIDERS[config.provider];
      if (!provider) {
        logger.error('Provider not supported:', config.provider);
        // Performance monitoring disabled
        sendResponse({ success: false, error: `Provider not supported: ${config.provider}` });
        return;
      }

      const requiresKey = provider.requiresKey !== false;
      if (requiresKey && !config.apiKey) {
        logger.warn('API key not configured');
        sendResponse({ success: false, error: 'API key not configured. Please configure your API key in settings.' });
        return;
      }

      // Process each text individually (legacy behavior)
      const results = [];
      const tokensPerText = texts.map(text => this.approxTokens(text));
      const totalTokens = tokensPerText.reduce((sum, tokens) => sum + tokens, 0);

      // Send initial progress update
      this.sendProgressUpdate(sender, 0, texts.length, 'translating');

      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const tokensNeeded = tokensPerText[i];

        try {
          // Check cache first
          let cacheKey = null;
          let cachedResult = null;

          if (this.cache) {
            cacheKey = this.globalScope.Cache.createKey(source, target, text);
            cachedResult = this.globalScope.Cache.get(cacheKey);

            if (cachedResult) {
              logger.info(`Cache hit for text ${i + 1}/${texts.length}`);
              results.push(cachedResult.text);
              this.stats.cacheHits++;
              continue;
            }
          }

          // Perform translation with throttling
          const translationFunc = async () => {
            return await this.performTranslation(text, source, target, config, provider);
          };

          let result;
          // Check simple rate limiting with retries
          let rateLimitRetries = 3;
          while (!this.checkRateLimit(tokensNeeded) && rateLimitRetries > 0) {
            logger.info(`Rate limit hit for text ${i + 1}/${texts.length}, waiting... (${rateLimitRetries} retries left)`);
            this.sendProgressUpdate(sender, i, texts.length, 'waiting');

            // Wait until next window (simple backoff)
            const waitTime = this.simpleRateLimit.windowMs - (Date.now() - this.simpleRateLimit.windowStart);
            if (waitTime > 0) {
              await new Promise(resolve => setTimeout(resolve, waitTime + 1000)); // Add 1s buffer
            }

            rateLimitRetries--;

            // If this text is too large for our token limit, split it
            if (rateLimitRetries === 0 && tokensNeeded > this.simpleRateLimit.tokenLimit * 0.8) {
              logger.info(`Text ${i + 1} is too large (${tokensNeeded} tokens), attempting split translation`);
              try {
                result = await this.splitAndTranslate(text, source, target, config, provider);
                break; // Success with split, break out of rate limit loop
              } catch (splitError) {
                logger.warn(`Split translation failed for text ${i + 1}:`, splitError.message);
                // Fall through to error handling
              }
            }
          }

          // If we still can't get past rate limiting, throw error
          if (!result && !this.checkRateLimit(tokensNeeded)) {
            throw new Error(`Rate limit exceeded for text ${i + 1} (${tokensNeeded} tokens) after multiple retries`);
          }

          // Only translate if we don't already have a result (from split translation)
          if (!result) {
            logger.info(`Translating text ${i + 1}/${texts.length}, tokens: ${tokensNeeded}`);
            result = await translationFunc();
          }

          // Cache the result
          if (this.cache && cacheKey && result) {
            this.globalScope.Cache.set(cacheKey, result);
          }

          results.push(result.text);
          logger.info(`Successfully translated text ${i + 1}/${texts.length}`);

          // Send progress update
          this.sendProgressUpdate(sender, i + 1, texts.length, 'translating');

        } catch (error) {
          // Use appropriate log level based on error type
          if (error.message?.includes('DataInspectionFailed')) {
            logger.info(`Content filter triggered for text ${i + 1}/${texts.length}`);
          } else {
            logger.error(`Failed to translate text ${i + 1}/${texts.length}:`, error);
          }

          // Handle specific API errors
          if (error.message?.includes('DataInspectionFailed')) {
            logger.info(`Text ${i + 1} rejected by content filter - attempting to split and translate`);
            // Debug: show first 50 chars to help identify filtered content patterns
            logger.debug('Attempting split translation for text', {
              textIndex: i,
              textLength: typeof text === 'string' ? text.length : 0
            });

            try {
              // Try to translate using the split strategy
              const splitResult = await this.splitAndTranslate(texts[i], source, target, config, provider);
              results.push(splitResult);
              logger.info(`Text ${i + 1} successfully translated using split strategy`);
            } catch (splitError) {
              logger.warn(`Split translation also failed for text ${i + 1}, keeping original:`, splitError.message);
              results.push(texts[i]); // Return original text if split strategy fails too
            }
          } else if (error.message?.includes('Parameter limit exceeded')) {
            logger.info(`Text ${i + 1} exceeds parameter limits - attempting to split and translate`);

            try {
              // Try to translate using the split strategy
              const splitResult = await this.splitAndTranslate(texts[i], source, target, config, provider);
              results.push(splitResult);
              logger.info(`Text ${i + 1} successfully translated using split strategy (parameter limit)`);
            } catch (splitError) {
              logger.warn(`Split translation failed for oversized text ${i + 1}, keeping original:`, splitError.message);
              results.push(texts[i]); // Return original text if split strategy fails too
            }
          } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
            logger.warn(`Rate limit hit for text ${i + 1}, text will be retried by rate limiting system`);
            results.push(texts[i]); // Return original text, will be retried
          } else {
            logger.error(`Unknown translation error for text ${i + 1}:`, error.message);
            results.push(texts[i]); // Return original text on any error
          }
        }
      }

      // Update stats
      this.stats.requests++;
      this.stats.tokens += totalTokens;
      if (this.cache) {
        this.stats.cacheSize = this.globalScope.Cache.getStats().size;
      }

      logger.info(`Batch translation successful: ${results.length} texts processed`);
      // Performance monitoring disabled

      // Clean up keepalive interval
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }

      sendResponse({
        success: true,
        texts: results,
        cached: false,
        latency: Date.now() - startTime
      });

    } catch (error) {
      this.stats.errors++;

      // Use error handler if available
      const handledError = this.errorHandler
        ? this.errorHandler.handle(error, { operation: 'translateBatch', textsCount: request.texts?.length })
        : { error: error.message };

      logger.error('Batch translation failed:', error);
      // Performance monitoring disabled

      // Clean up keepalive interval
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }

      sendResponse({
        success: false,
        error: handledError.error || error.message,
        latency: Date.now() - startTime
      });
    }
  }

  /**
   * Send progress update to content script
   */
  sendProgressUpdate(sender, completed, total, status) {
    try {
      // Only send progress updates if we have tab information
      if (sender?.tab?.id) {
        const tabId = sender.tab.id;

        chrome.tabs.sendMessage(tabId, {
          type: 'translationProgress',
          progress: {
            completed,
            total,
            percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
            status,
            timestamp: Date.now()
          }
        }).catch(error => {
          // Content script might not be ready or tab might be closed
          logger.info('Could not send progress update:', error.message);
        });
      }
    } catch (error) {
      logger.error('Error sending progress update:', error);
    }
  }

  async performTranslation(text, sourceLanguage, targetLanguage, config, provider) {
    // Ensure advanced modules are loaded since this method uses many advanced features
    await this.ensureAdvancedModulesLoaded();

    // Check offline status and use fallbacks if needed
    if (this.od && !this.od.isOnline()) {
      logger.warn('Device is offline, attempting cached translation');

      // Try to get cached translation first
      if (this.cache) {
        const cacheKey = `${sourceLanguage}:${targetLanguage}:${text}`;
        const cached = this.globalScope.Cache.get(cacheKey);
        if (cached) {
          logger.info('Found cached translation for offline request');
          return {
            text: cached,
            cached: true,
            offline: true,
            fallback: 'cache'
          };
        }
      }

      // Try translation memory if available
      if (this.tm) {
        const tmResult = this.tm.searchSimilar(text, sourceLanguage, targetLanguage, 0.8);
        if (tmResult && tmResult.length > 0) {
          logger.info('Found similar translation in memory for offline request');
          return {
            text: tmResult[0].target,
            cached: false,
            offline: true,
            fallback: 'translation_memory',
            similarity: tmResult[0].similarity
          };
        }
      }

      // No fallbacks available - queue the request
      if (this.od.config.enableRetryQueue) {
        const queued = this.od.addToRetryQueue({
          id: `trans_${Date.now()}`,
          text,
          sourceLanguage,
          targetLanguage,
          config,
          provider
        }, new Error('Device offline'));

        if (queued) {
          logger.info('Translation request queued for when online');
          return {
            text: null,
            cached: false,
            offline: true,
            queued: true,
            fallback: 'queue',
            error: 'Device offline - request queued for retry'
          };
        }
      }

      throw new Error('Device offline and no cached translations available');
    }

    // Check connection quality and warn if poor
    if (this.od && this.od.shouldUseFallbacks()) {
      logger.warn('Poor connection quality detected, considering fallbacks');
    }

    // Extract terminology for consistent translation
    let extractedTerms = null;
    if (this.ge && text.length > 20) { // Only extract from substantial text
      try {
        const extractionContext = {
          sourceLanguage,
          targetLanguage,
          domain: 'general',
          contentType: 'web'
        };

        const extraction = this.ge.extractTerms(text, extractionContext);
        extractedTerms = extraction;

        if (extraction.terms.length > 0) {
          logger.info(`Extracted ${extraction.terms.length} terminology terms`, {
            topTerms: extraction.summary.topTerms,
            domains: extraction.summary.domains
          });
        }
      } catch (error) {
        logger.error('Glossary extraction failed:', error);
      }
    }

    // Check if text is too long and needs splitting
    if (this.ts && text.length > 2000) { // Use text splitter for texts > 2000 chars
      const estimatedTokens = this.ts.estimateTokens(text, sourceLanguage);

      if (estimatedTokens > 3500) { // Split if estimated tokens exceed threshold
        logger.info(`Text requires splitting: ${estimatedTokens} estimated tokens`);

        // Track text splitting performance
        const splitStartTime = Date.now();
        // Performance monitoring disabled

        try {
          const chunks = this.ts.splitText(text, sourceLanguage);
          const splitTime = Date.now() - splitStartTime;

          logger.info(`Text split into ${chunks.length} chunks in ${splitTime}ms`);

          // Performance monitoring disabled

          const translatedChunks = [];

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            logger.info(`Translating chunk ${i + 1}/${chunks.length} (${chunk.text.length} chars)`);

            let chunkResult;
            if (config.provider === 'google-free') {
              chunkResult = await this.translateWithGoogleFree(chunk.text, sourceLanguage, targetLanguage, config, provider);
            } else if (config.provider.startsWith('qwen')) {
              chunkResult = await this.translateWithQwen(chunk.text, sourceLanguage, targetLanguage, config, provider);
            } else if (config.provider.startsWith('deepl')) {
              chunkResult = await this.translateWithDeepL(chunk.text, sourceLanguage, targetLanguage, config, provider);
            } else if (config.provider === 'hunyuan-local') {
              chunkResult = await this.translateWithLocal(chunk.text, sourceLanguage, targetLanguage, config, provider);
            } else {
              throw new Error('Unsupported provider');
            }

            translatedChunks.push(chunkResult.text);
          }

          // Join translated chunks with appropriate separators
          const joinedText = this.ts.joinTranslations(translatedChunks);

          logger.info(`Successfully translated text with splitting: ${translatedChunks.length} chunks joined`);

          return {
            text: joinedText,
            cached: false,
            split: true,
            chunks: chunks.length,
            extractedTerms: extractedTerms
          };

        } catch (error) {
          logger.error('Text splitting failed, falling back to direct translation:', error);
          // Fall through to direct translation
        }
      }
    }

    // Direct translation for shorter texts or if splitting failed
    let result;
    if (config.provider === 'google-free') {
      result = await this.translateWithGoogleFree(text, sourceLanguage, targetLanguage, config, provider);
    } else if (config.provider.startsWith('qwen')) {
      result = await this.translateWithQwen(text, sourceLanguage, targetLanguage, config, provider);
    } else if (config.provider.startsWith('deepl')) {
      result = await this.translateWithDeepL(text, sourceLanguage, targetLanguage, config, provider);
    } else if (config.provider === 'hunyuan-local') {
      result = await this.translateWithLocal(text, sourceLanguage, targetLanguage, config, provider);
    } else {
      throw new Error('Unsupported provider');
    }

    // Add extracted terms to result
    if (extractedTerms && result) {
      result.extractedTerms = extractedTerms;
    }

    return result;
  }

  async translateWithQwen(text, sourceLanguage, targetLanguage, config, provider) {
    const sourceLanguageValue = sourceLanguage === 'auto' ? 'auto detect' : sourceLanguage;
    const requestBody = {
      model: provider.model,
      messages: [
        {
          role: 'user',
          content: `Translate the following text from ${sourceLanguageValue} to ${targetLanguage}. Return only the translated text without any explanations:\n\n${text}`
        }
      ],
      temperature: 0.1,
      max_tokens: 8000
    };

    logger.info('Preparing Qwen translation request', {
      endpoint: provider.endpoint,
      model: provider.model,
      sourceLanguage: sourceLanguageValue,
      targetLanguage,
      textLength: text.length
    });

    const requestStartTime = Date.now();
    const providerName = config.provider || 'qwen'; // Use provider name for tracking

    // Check if request is allowed (circuit breaker, throttling)
    if (this.ald && !this.ald.checkRequestAllowed(providerName)) {
      const status = this.ald.getStatus();
      const providerStatus = status.providers[providerName];

      if (providerStatus) {
        logger.warn('Adaptive limit detector preventing API request:', {
          provider: providerName,
          circuitBreakerState: providerStatus.circuitBreakerState,
          currentThrottle: providerStatus.currentThrottle
        });
        throw new Error(`Request blocked by adaptive limit detector. Provider: ${providerName}, State: ${providerStatus.circuitBreakerState}`);
      }
    }

    // Record request start
    if (this.ald) {
      this.ald.recordRequest(providerName, {
        timestamp: requestStartTime,
        endpoint: provider.endpoint,
        method: 'POST',
        estimatedTokens: text.length / 4, // Rough token estimate
        requestSize: text.length
      });
    }

    let response;
    try {
      response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      // Track response for adaptive learning
      if (this.ald) {
        const responseTime = Date.now() - requestStartTime;
        const responseData = {
          timestamp: Date.now(),
          status: response.status,
          responseTime,
          success: response.ok,
          rateLimitHeaders: {}
        };

        // Extract rate limit headers if present
        const headers = Object.fromEntries(response.headers.entries());
        for (const [key, value] of Object.entries(headers)) {
          if (key.toLowerCase().includes('ratelimit') || key.toLowerCase().includes('rate-limit')) {
            responseData.rateLimitHeaders[key] = value;
          }
        }

        this.ald.recordResponse(providerName, responseData);
      }

      if (!response.ok) {
        const errorText = await response.text();

        // Capture all response headers for debugging
        const headers = Object.fromEntries(response.headers.entries());
        const rateLimitHeaders = {};
        for (const [key, value] of Object.entries(headers)) {
          if (key.toLowerCase().includes('ratelimit') ||
              key.toLowerCase().includes('rate-limit') ||
              key.toLowerCase().includes('x-') ||
              key.toLowerCase().includes('retry-after')) {
            rateLimitHeaders[key] = value;
          }
        }

        const errorDetails = {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          headers: rateLimitHeaders,
          allHeaders: headers
        };

        logger.error('🚨 QWEN API ERROR DETAILS:', JSON.stringify(errorDetails, null, 2));
        logger.error('Qwen API error response:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`Qwen API error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      // Record network/fetch errors in the response record
      if (this.ald) {
        const errorResponseData = {
          timestamp: Date.now(),
          status: error.name === 'AbortError' ? 408 : 0, // Timeout or network error
          responseTime: Date.now() - requestStartTime,
          success: false,
          error: error.message,
          isNetworkError: true
        };

        this.ald.recordResponse(providerName, errorResponseData);
      }

      // Add to offline retry queue if network error and offline detector available
      if (this.od && (error.name === 'TypeError' || error.name === 'AbortError' || error.message.includes('fetch'))) {
        const requestData = {
          id: `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          text,
          sourceLanguage,
          targetLanguage,
          config,
          provider
        };

        const queued = this.od.addToRetryQueue(requestData, error);
        if (queued) {
          logger.info('Network error: translation request added to retry queue');
          // Still throw error but mention it's been queued
          error.message += ' (Request queued for retry)';
        }
      }

      throw error;
    }

    const data = await response.json();

    logger.info('Received Qwen response', {
      status: response.status,
      statusText: response.statusText,
      bodyKeys: Object.keys(data || {}),
      inputLength: typeof text === 'string' ? text.length : 0
    });

    // Parse response using OpenAI-compatible format
    const translatedText = data.choices?.[0]?.message?.content ||
                          data.output?.text ||
                          data.output?.target_text ||
                          data.output?.translated_text ||
                          data.output?.translation;

    if (translatedText) {
      logger.info('Qwen translation completed', {
        sourceLanguage,
        targetLanguage,
        inputLength: typeof text === 'string' ? text.length : 0,
        outputLength: translatedText.length
      });

      // Perform quality verification if available
      let qualityVerification = null;
      if (this.qv && text.length > 10) { // Only verify substantial text
        try {
          qualityVerification = await this.qv.verifyTranslation(text, translatedText, {
            sourceLanguage,
            targetLanguage,
            provider: config.provider,
            translationId: Date.now().toString()
          });

          logger.info(`Quality verification: ${qualityVerification.status} (score: ${qualityVerification.overallScore.toFixed(2)})`);
        } catch (error) {
          logger.warn('Quality verification failed:', error);
        }
      }

      // Perform feedback collection quality assessment if available
      let feedbackAssessment = null;
      if (this.fc && text.length > 5) {
        try {
          const translationData = {
            id: Date.now().toString(),
            sourceText: text,
            translatedText: translatedText,
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage,
            provider: config.provider,
            context: {
              domain: 'web_content',
              formality: 'neutral'
            }
          };

          feedbackAssessment = this.fc.assessTranslationQuality(translationData);

          // Track translation completion usage pattern
          this.fc.trackUsagePattern({
            type: 'translation_completed',
            data: {
              sourceLanguage,
              targetLanguage,
              provider: config.provider,
              textLength: text.length,
              translatedLength: translatedText.length,
              qualityScore: feedbackAssessment?.qualityScore
            },
            context: {
              timestamp: Date.now(),
              from: 'background_translation'
            }
          });

          // Update session translation count
          if (this.fc.sessionState) {
            this.fc.sessionState.translationCount++;
          }

          logger.info(`Feedback quality assessment: ${feedbackAssessment?.qualityLevel} (score: ${feedbackAssessment?.qualityScore?.toFixed(2) || 'N/A'})`);
        } catch (error) {
          logger.warn('Feedback quality assessment failed:', error);
        }
      }

      return {
        text: translatedText,
        detectedLanguage: sourceLanguage,
        provider: config.provider,
        qualityVerification,
        feedbackAssessment
      };
    } else {
      logger.error('Unexpected Qwen API response format:', data);
      throw new Error('Unexpected response format from Qwen API');
    }
  }

  async translateWithGoogleFree(text, sourceLanguage, targetLanguage, _config, provider) {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: sourceLanguage && sourceLanguage !== 'auto' ? sourceLanguage : 'auto',
      tl: targetLanguage || 'en',
      dt: 't',
      q: text,
    });

    const requestUrl = `${provider.endpoint}?${params.toString()}`;
    const response = await fetch(requestUrl, {
      method: 'GET',
      credentials: 'omit',
      headers: { 'Accept': 'application/json, text/plain, */*' },
    });

    if (!response.ok) {
      throw new Error(`Google Translate API error: ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('Failed to parse response from Google Translate');
    }

    const translated = Array.isArray(data)
      ? data[0]?.map(segment => segment[0]).join('')
      : '';

    if (!translated) {
      throw new Error('Empty translation result from Google Translate');
    }

    const detectedLanguage = Array.isArray(data) ? data[2] : null;

    return {
      text: translated,
      translatedText: translated,
      detectedLanguage: detectedLanguage || (sourceLanguage !== 'auto' ? sourceLanguage : null),
      provider: 'google-free'
    };
  }

  async translateWithDeepL(text, sourceLanguage, targetLanguage, config, provider) {
    const formData = new FormData();
    formData.append('auth_key', config.apiKey);
    formData.append('text', text);
    formData.append('target_lang', targetLanguage.toUpperCase());

    if (sourceLanguage !== 'auto') {
      formData.append('source_lang', sourceLanguage.toUpperCase());
    }

    const response = await fetch(provider.endpoint, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`DeepL API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.translations && data.translations.length > 0) {
      return {
        text: data.translations[0].text,
        detectedLanguage: data.translations[0].detected_source_language?.toLowerCase(),
        provider: config.provider
      };
    } else {
      throw new Error('Invalid response from DeepL API');
    }
  }

  async translateWithLocal(text, sourceLanguage, targetLanguage, config, provider) {
    try {
      logger.info('Using local model for translation');

      // Check if model is available
      if (!this.localModel.isModelAvailable()) {
        throw new Error('Local model not available. Please download the model first.');
      }

      // Perform translation using local model
      const result = await this.localModel.translate(text, sourceLanguage, targetLanguage);

      logger.info('Local model translation completed');

      return {
        text: result.text,
        detectedLanguage: sourceLanguage !== 'auto' ? sourceLanguage : null,
        provider: 'hunyuan-local',
        local: true
      };

    } catch (error) {
      logger.error('Local model translation failed:', error);
      throw error;
    }
  }

  async updateConfig(newConfig) {
    try {
      await chrome.storage.sync.set(newConfig);
      this.currentConfig = { ...this.currentConfig, ...newConfig };
      logger.info('Configuration updated');
    } catch (error) {
      logger.error('Failed to update config:', error);
      throw error;
    }
  }

  // Glossary management handlers
  async handleGlossaryAdd(request, sendResponse) {
    try {
      if (!this.ge) {
        sendResponse({ success: false, error: 'Glossary extractor not available' });
        return;
      }

      const { term, translation, domain, metadata } = request;
      if (!term || !translation) {
        sendResponse({ success: false, error: 'Term and translation are required' });
        return;
      }

      const result = this.ge.addUserTerm(term, translation, domain || 'user', metadata || {});
      sendResponse({ success: true, termData: result });

      logger.info(`Added glossary term: ${term} -> ${translation}`);
    } catch (error) {
      logger.error('Failed to add glossary term:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleGlossaryRemove(request, sendResponse) {
    try {
      if (!this.ge) {
        sendResponse({ success: false, error: 'Glossary extractor not available' });
        return;
      }

      const { term } = request;
      if (!term) {
        sendResponse({ success: false, error: 'Term is required' });
        return;
      }

      const removed = this.ge.removeUserTerm(term);
      sendResponse({ success: true, removed });

      logger.info(`Removed glossary term: ${term}`);
    } catch (error) {
      logger.error('Failed to remove glossary term:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleGlossaryGet(request, sendResponse) {
    try {
      if (!this.ge) {
        sendResponse({ success: false, error: 'Glossary extractor not available' });
        return;
      }

      const { domain, type } = request;

      let terms;
      if (domain) {
        terms = this.ge.getTermsByDomain(domain);
      } else if (type === 'user') {
        terms = this.ge.getUserGlossary();
      } else {
        // Get all user terms
        terms = this.ge.getUserGlossary();
      }

      const stats = this.ge.getStats();

      sendResponse({
        success: true,
        terms,
        stats,
        domains: Array.from(new Set(terms.map(t => t.domain)))
      });
    } catch (error) {
      logger.error('Failed to get glossary terms:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleGlossaryExport(request, sendResponse) {
    try {
      if (!this.ge) {
        sendResponse({ success: false, error: 'Glossary extractor not available' });
        return;
      }

      const { format } = request;
      const exportedData = this.ge.exportGlossary(format || 'json');

      sendResponse({
        success: true,
        data: exportedData,
        format: format || 'json',
        timestamp: new Date().toISOString()
      });

      logger.info(`Exported glossary in ${format || 'json'} format`);
    } catch (error) {
      logger.error('Failed to export glossary:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleGlossaryImport(request, sendResponse) {
    try {
      if (!this.ge) {
        sendResponse({ success: false, error: 'Glossary extractor not available' });
        return;
      }

      const { data, format } = request;
      if (!data) {
        sendResponse({ success: false, error: 'Import data is required' });
        return;
      }

      const success = this.ge.importGlossary(data, format || 'json');

      if (success) {
        const stats = this.ge.getStats();
        sendResponse({
          success: true,
          imported: true,
          stats
        });
        logger.info(`Imported glossary from ${format || 'json'} format`);
      } else {
        sendResponse({ success: false, error: 'Failed to import glossary data' });
      }
    } catch (error) {
      logger.error('Failed to import glossary:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleGlossaryExtract(request, sendResponse) {
    try {
      if (!this.ge) {
        sendResponse({ success: false, error: 'Glossary extractor not available' });
        return;
      }

      const { text, context } = request;
      if (!text) {
        sendResponse({ success: false, error: 'Text is required for extraction' });
        return;
      }

      const extraction = this.ge.extractTerms(text, context || {});

      sendResponse({
        success: true,
        extraction: {
          terms: extraction.terms,
          summary: extraction.summary,
          patterns: Object.keys(extraction.patterns || {})
        }
      });

      logger.info(`Extracted ${extraction.terms.length} terms from text`);
    } catch (error) {
      logger.error('Failed to extract glossary terms:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle DOM optimization queue operation
   */
  async handleDOMQueue(request, sender, sendResponse) {
    try {
      if (!this.domOptimizer) {
        throw new Error('DOM Optimizer not available');
      }

      const { element, operation, priority } = request;

      // Note: In actual content script context, element would be a DOM element
      // Here we simulate for message passing compatibility
      const operationId = this.domOptimizer.queueOperation(
        element,
        operation,
        priority || 'auto'
      );

      sendResponse({
        success: true,
        operationId: operationId,
        priority: priority || 'auto'
      });

      logger.info(`Queued DOM operation: ${operationId}`);
    } catch (error) {
      logger.error('Failed to queue DOM operation:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle DOM optimization metrics request
   */
  async handleDOMMetrics(request, sender, sendResponse) {
    try {
      if (!this.domOptimizer) {
        throw new Error('DOM Optimizer not available');
      }

      const metrics = this.domOptimizer.getMetrics();

      sendResponse({
        success: true,
        metrics: metrics
      });

      logger.info('Retrieved DOM optimization metrics');
    } catch (error) {
      logger.error('Failed to get DOM metrics:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle DOM optimization cleanup
   */
  async handleDOMCleanup(request, sender, sendResponse) {
    try {
      if (!this.domOptimizer) {
        throw new Error('DOM Optimizer not available');
      }

      this.domOptimizer.cleanup();

      sendResponse({
        success: true,
        message: 'DOM optimizer cleanup completed'
      });

      logger.info('DOM optimizer cleanup completed');
    } catch (error) {
      logger.error('Failed to cleanup DOM optimizer:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle adaptive limit status check
   */
  async handleLimitStatus(request, sender, sendResponse) {
    try {
      if (!this.ald) {
        throw new Error('Adaptive Limit Detector not available');
      }

      const status = this.ald.getStatus();

      sendResponse({
        success: true,
        status: status
      });

      logger.info('Retrieved adaptive limit status');
    } catch (error) {
      logger.error('Failed to get limit status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle circuit breaker status check
   */
  async handleCircuitBreakerStatus(request, sender, sendResponse) {
    try {
      if (!this.ald) {
        throw new Error('Adaptive Limit Detector not available');
      }

      const status = this.ald.getStatus();
      const provider = request.provider || 'qwen';

      sendResponse({
        success: true,
        circuitBreaker: status.circuitBreakers[provider] || { state: 'closed' }
      });

      logger.info('Retrieved circuit breaker status for provider:', provider);
    } catch (error) {
      logger.error('Failed to get circuit breaker status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle request allowed check
   */
  async handleRequestAllowed(request, sender, sendResponse) {
    try {
      if (!this.ald) {
        throw new Error('Adaptive Limit Detector not available');
      }

      const provider = request.provider || 'qwen';
      const allowed = this.ald.checkRequestAllowed(provider);

      sendResponse({
        success: true,
        allowed: allowed,
        provider: provider
      });

      logger.info(`Request allowed check for ${provider}: ${allowed}`);
    } catch (error) {
      logger.error('Failed to check if request allowed:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle force cleanup of adaptive limit detector
   */
  async handleLimitDetectorCleanup(request, sender, sendResponse) {
    try {
      if (!this.ald) {
        throw new Error('Adaptive Limit Detector not available');
      }

      this.ald.destroy();

      sendResponse({
        success: true,
        message: 'Adaptive limit detector cleanup completed'
      });

      logger.info('Adaptive limit detector cleanup completed');
    } catch (error) {
      logger.error('Failed to cleanup limit detector:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle offline status check
   */
  async handleOfflineStatus(request, sender, sendResponse) {
    try {
      if (!this.od) {
        throw new Error('Offline Detector not available');
      }

      const status = this.od.getStatus();

      sendResponse({
        success: true,
        status: status
      });

      logger.info('Retrieved offline detector status');
    } catch (error) {
      logger.error('Failed to get offline status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle connectivity check force
   */
  async handleConnectivityCheck(request, sender, sendResponse) {
    try {
      if (!this.od) {
        throw new Error('Offline Detector not available');
      }

      this.od.forceConnectivityCheck();

      sendResponse({
        success: true,
        message: 'Connectivity check initiated'
      });

      logger.info('Forced connectivity check');
    } catch (error) {
      logger.error('Failed to force connectivity check:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle retry queue status and management
   */
  async handleRetryQueue(request, sender, sendResponse) {
    try {
      if (!this.od) {
        throw new Error('Offline Detector not available');
      }

      const action = request.action || 'status';

      if (action === 'status') {
        const status = this.od.getStatus();
        sendResponse({
          success: true,
          retryQueue: status.retryQueue
        });
      } else if (action === 'clear') {
        const clearedCount = this.od.clearRetryQueue();
        sendResponse({
          success: true,
          message: `Cleared ${clearedCount} requests from retry queue`
        });
      } else if (action === 'process') {
        await this.od.processRetryQueue();
        sendResponse({
          success: true,
          message: 'Retry queue processing triggered'
        });
      } else {
        throw new Error(`Unknown retry queue action: ${action}`);
      }

      logger.info(`Retry queue ${action} completed`);
    } catch (error) {
      logger.error('Failed to handle retry queue:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle offline detector cleanup
   */
  async handleOfflineDetectorCleanup(request, sender, sendResponse) {
    try {
      if (!this.od) {
        throw new Error('Offline Detector not available');
      }

      this.od.destroy();

      sendResponse({
        success: true,
        message: 'Offline detector cleanup completed'
      });

      logger.info('Offline detector cleanup completed');
    } catch (error) {
      logger.error('Failed to cleanup offline detector:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle explicit feedback collection
   */
  async handleFeedbackCollection(request, sender, sendResponse) {
    try {
      if (!this.fc) {
        throw new Error('Feedback Collector not available');
      }

      const result = this.fc.collectExplicitFeedback(request.feedbackData);

      sendResponse({
        success: result,
        message: result ? 'Feedback collected successfully' : 'Failed to collect feedback'
      });

      logger.info('Explicit feedback collected:', result);
    } catch (error) {
      logger.error('Failed to collect feedback:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle feedback analytics request
   */
  async handleFeedbackAnalytics(request, sender, sendResponse) {
    try {
      if (!this.fc) {
        throw new Error('Feedback Collector not available');
      }

      const analytics = this.fc.getAnalytics();

      sendResponse({
        success: true,
        analytics: analytics
      });

      logger.info('Feedback analytics requested');
    } catch (error) {
      logger.error('Failed to get feedback analytics:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle feedback prompt request
   */
  async handleFeedbackPrompt(request, sender, sendResponse) {
    try {
      if (!this.fc) {
        throw new Error('Feedback Collector not available');
      }

      const promptData = this.fc.promptForFeedback(request.context || {});

      sendResponse({
        success: !!promptData,
        promptData: promptData
      });

      logger.info('Feedback prompt requested:', !!promptData);
    } catch (error) {
      logger.error('Failed to handle feedback prompt:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle feedback status request
   */
  async handleFeedbackStatus(request, sender, sendResponse) {
    try {
      if (!this.fc) {
        throw new Error('Feedback Collector not available');
      }

      const status = this.fc.getStatus();

      sendResponse({
        success: true,
        status: status
      });

      logger.info('Feedback status requested');
    } catch (error) {
      logger.error('Failed to get feedback status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle security sanitization - simplified version
   */
  async handleSecuritySanitization(request, sender, sendResponse) {
    try {
      const { input, type, context } = request;

      // Basic sanitization without security enhancement module
      const sanitized = input?.replace(/<script[^>]*>.*?<\/script>/gi, '')
                             ?.replace(/javascript:/gi, '')
                             ?.replace(/on\w+=/gi, '') || input;

      const sanitizationResult = {
        safe: true,
        sanitized: sanitized,
        threats: [],
        original: input
      };

      sendResponse({
        success: true,
        result: sanitizationResult
      });

      logger.info(`Basic security sanitization completed: ${type}`);
    } catch (error) {
      logger.error('Failed to sanitize content:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle security validation - simplified version
   */
  async handleSecurityValidation(request, sender, sendResponse) {
    try {
      const { content, type, context } = request;

      // Basic validation without security enhancement module
      const validationResult = {
        valid: true,
        violations: [],
        sanitized: content?.replace(/<script[^>]*>.*?<\/script>/gi, '')
                          ?.replace(/javascript:/gi, '')
                          ?.replace(/on\w+=/gi, '') || content
      };

      sendResponse({
        success: true,
        result: validationResult
      });

      logger.info(`Basic security validation completed: ${type}`);
    } catch (error) {
      logger.error('Failed to validate content:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle security status request - simplified version
   */
  async handleSecurityStatus(request, sender, sendResponse) {
    try {
      const status = {
        enabled: true,
        level: 'basic',
        features: ['input_sanitization', 'output_sanitization'],
        threats_blocked: 0,
        last_update: new Date().toISOString()
      };

      sendResponse({
        success: true,
        status: status
      });

      logger.info('Basic security status requested');
    } catch (error) {
      logger.error('Failed to get security status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle configuration get request
   */
  async handleConfigGet(request, sender, sendResponse) {
    try {
      if (!this.ac) {
        throw new Error('Advanced Configuration not available');
      }

      const { key, fallback } = request;
      const value = this.ac.get(key, fallback);

      sendResponse({
        success: true,
        value: value,
        key: key
      });

      logger.info(`Configuration get: ${key} = ${value}`);
    } catch (error) {
      logger.error('Failed to get configuration:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle configuration set request
   */
  async handleConfigSet(request, sender, sendResponse) {
    try {
      if (!this.ac) {
        throw new Error('Advanced Configuration not available');
      }

      const { key, value, options } = request;
      this.ac.set(key, value, options);

      // Apply configuration overrides after setting
      this.applyConfigurationOverrides();

      sendResponse({
        success: true,
        key: key,
        value: value
      });

      logger.info(`Configuration set: ${key} = ${value}`);
    } catch (error) {
      logger.error('Failed to set configuration:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle feature flag management
   */
  async handleConfigFeature(request, sender, sendResponse) {
    try {
      if (!this.ac) {
        throw new Error('Advanced Configuration not available');
      }

      const { action, featureName, options } = request;

      if (action === 'check') {
        const enabled = this.ac.isFeatureEnabled(featureName);
        sendResponse({
          success: true,
          featureName: featureName,
          enabled: enabled
        });
      } else if (action === 'enable') {
        this.ac.enableFeature(featureName, options);
        this.updateFeatureAvailability();
        sendResponse({
          success: true,
          featureName: featureName,
          enabled: true
        });
      } else if (action === 'disable') {
        this.ac.disableFeature(featureName);
        this.updateFeatureAvailability();
        sendResponse({
          success: true,
          featureName: featureName,
          enabled: false
        });
      } else {
        throw new Error(`Unknown feature action: ${action}`);
      }

      logger.info(`Feature ${action}: ${featureName}`);
    } catch (error) {
      logger.error('Failed to handle feature flag:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle configuration status request
   */
  async handleConfigStatus(request, sender, sendResponse) {
    try {
      if (!this.ac) {
        throw new Error('Advanced Configuration not available');
      }

      const status = this.ac.getStatus();

      sendResponse({
        success: true,
        status: status,
        enabledFeatures: this.enabledFeatures
      });

      logger.info('Configuration status requested');
    } catch (error) {
      logger.error('Failed to get configuration status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle intelligent language selection
   */
  async handleLanguageSelection(request, sender, sendResponse) {
    try {
      if (!this.ils) {
        throw new Error('Intelligent Language Selection not available');
      }

      const { context, options } = request;
      const selection = this.ils.selectLanguages(context, options);

      sendResponse({
        success: true,
        selection: selection
      });

      logger.info('Language selection completed:', selection.source, '->', selection.target);
    } catch (error) {
      logger.error('Failed to select languages:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle language learning from user behavior
   */
  async handleLanguageLearning(request, sender, sendResponse) {
    try {
      if (!this.ils) {
        throw new Error('Intelligent Language Selection not available');
      }

      const { pattern, context } = request;
      const learned = this.ils.learnFromInteraction(pattern, context);

      sendResponse({
        success: true,
        learned: learned
      });

      logger.info('Language learning pattern recorded:', pattern.type);
    } catch (error) {
      logger.error('Failed to learn language pattern:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle language preferences management
   */
  async handleLanguagePreferences(request, sender, sendResponse) {
    try {
      if (!this.ils) {
        throw new Error('Intelligent Language Selection not available');
      }

      const action = request.action || 'get';

      if (action === 'get') {
        const preferences = this.ils.getPreferences();
        sendResponse({
          success: true,
          preferences: preferences
        });
      } else if (action === 'update') {
        const result = this.ils.updatePreferences(request.preferences);
        sendResponse({
          success: result,
          message: result ? 'Preferences updated' : 'Failed to update preferences'
        });
      } else if (action === 'reset') {
        this.ils.resetPreferences();
        sendResponse({
          success: true,
          message: 'Preferences reset to defaults'
        });
      } else {
        throw new Error(`Unknown preferences action: ${action}`);
      }

      logger.info(`Language preferences ${action} completed`);
    } catch (error) {
      logger.error('Failed to handle language preferences:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle language status request
   */
  async handleLanguageStatus(request, sender, sendResponse) {
    try {
      if (!this.ils) {
        throw new Error('Intelligent Language Selection not available');
      }

      const status = this.ils.getStatus();

      sendResponse({
        success: true,
        status: status
      });

      logger.info('Language selection status requested');
    } catch (error) {
      logger.error('Failed to get language status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // Local Model Management Handlers
  async handleLocalModelDownload(request, sender, sendResponse) {
    try {
      if (this.localModel.isDownloading) {
        sendResponse({
          success: false,
          error: 'Model download already in progress'
        });
        return;
      }

      // Start download with progress callback
      try {
        await this.localModel.downloadModel((progress, downloaded, total) => {
          // Send progress updates to requesting tab
          if (sender.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'localModelProgress',
              progress: progress,
              downloaded: downloaded,
              total: total
            }).catch(() => {
              // Tab might have been closed, ignore errors
            });
          }
        });

        logger.info('Local model download completed successfully');

        // Notify completion
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'localModelDownloadComplete'
          }).catch(() => {
            // Tab might have been closed, ignore errors
          });
        }
      } catch (downloadError) {
        logger.error('Local model download failed:', downloadError);

        // Notify failure
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'localModelDownloadError',
            error: downloadError.message
          }).catch(() => {
            // Tab might have been closed, ignore errors
          });
        }

        throw downloadError; // Re-throw to be caught by outer catch
      }

      sendResponse({
        success: true,
        message: 'Download started'
      });

    } catch (error) {
      logger.error('Failed to start local model download:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleLocalModelStatus(request, sendResponse) {
    try {
      const available = await this.localModel.isAvailable();
      const status = this.localModel.getStatus();

      sendResponse({
        success: true,
        available: available,
        loaded: status.loaded,
        ready: typeof status.ready === 'boolean' ? status.ready : false,
        downloadProgress: status.downloadProgress,
        model: status.model,
        provider: status.provider,
        size: status.size,
        threads: status.threads,
        contextSize: status.contextSize
      });

    } catch (error) {
      logger.error('Failed to get local model status:', error);
      sendResponse({
        success: true,
        available: false,
        loaded: false,
        ready: false,
        downloadProgress: 0,
        model: null,
        provider: 'fallback',
        error: error.message
      });
    }
  }

  async handleLocalModelDelete(request, sender, sendResponse) {
    try {
      await this.localModel.deleteModel();

      sendResponse({
        success: true,
        message: 'Local model deleted successfully'
      });

      logger.info('Local model deleted successfully');

    } catch (error) {
      logger.error('Failed to delete local model:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleLocalModelProgress(request, sender, sendResponse) {
    try {
      const downloadProgress = this.localModel.getDownloadProgress();

      sendResponse({
        success: true,
        isDownloading: downloadProgress.isDownloading,
        progress: downloadProgress.progress
      });

    } catch (error) {
      logger.error('Failed to get local model progress:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
}

// Initialize background service
logger.info('Creating BackgroundService instance...');
const backgroundService = new BackgroundService();
logger.info('BackgroundService instance created');

// Context menu click handler
if (chrome.contextMenus && chrome.contextMenus.onClicked && typeof chrome.contextMenus.onClicked.addListener === 'function') {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'translate-selection' && info.selectionText) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'translateSelection',
        text: info.selectionText
      });
    }
  });
}

// Extension installation/startup
if (chrome.runtime && chrome.runtime.onInstalled && typeof chrome.runtime.onInstalled.addListener === 'function') {
  chrome.runtime.onInstalled.addListener(() => {
    console.log('🚀 TRANSLATE! Extension installed/updated');
    logger.info('Extension installed/updated');
    backgroundService.initialize();
  });
}

// Service worker startup
if (chrome.runtime && chrome.runtime.onStartup && typeof chrome.runtime.onStartup.addListener === 'function') {
  chrome.runtime.onStartup.addListener(() => {
    console.log('🚀 TRANSLATE! Service worker starting up');
    logger.info('Service worker starting up');
  });
}

// Debug: Add console log on service worker load
console.log('🚀 TRANSLATE! Background script loaded');

// Initialize immediately
logger.info('Calling backgroundService.initialize()...');
backgroundService.initialize().then(() => {
  logger.info('Initial backgroundService.initialize() completed');
}).catch(error => {
  logger.error('Initial backgroundService.initialize() failed:', error);
});

// Auto-injection system (like legacy extension)
async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ['styles/apple.css']
    });
  } catch (error) {
    logger.debug('CSS injection failed for tab:', tabId, error);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [
        'i18n/index.js',
        'lib/logger.js',
        'lib/messaging.js',
        'lib/batchDelim.js',
        'lib/providers.js',
        'core/provider-loader.js',
        'core/dom-optimizer.js',
        'lib/glossary.js',
        'lib/tm.js',
        'lib/detect.js',
        'lib/feedback.js',
        'lib/offline.js',
        'config.js',
        'throttle.js',
        'translator.js',
        'contentScript.js',
      ]
    });
    logger.info('Content scripts injected into tab:', tabId);
  } catch (error) {
    logger.debug('Content script injection failed for tab:', tabId, error);
  }
}

async function ensureInjected(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'test-read', action: 'test-read' });
    if (response && (typeof response.title === 'string' || typeof response.url === 'string')) {
      return true;
    }
  } catch (error) {
    logger.debug('Content script ping failed, injecting...', error?.message || error);
  }

  await injectContentScripts(tabId);

  // Allow a brief moment for scripts to initialize before returning.
  await new Promise(resolve => setTimeout(resolve, 100));
  return true;
}

function urlEligible(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

async function maybeAutoInject(tabId, url) {
  logger.info('maybeAutoInject called for tab:', tabId, 'url:', url);

  if (!urlEligible(url)) {
    logger.info('URL not eligible:', url);
    return;
  }

  try {
    const tabInfo = await chrome.tabs.get(tabId);
    if (!tabInfo || !tabInfo.active) {
      logger.info('Tab not active or not found:', tabInfo);
      return;
    }

    // Check if auto-translate is enabled
    const config = await backgroundService.getConfig();
    logger.info('Auto-translate config:', config.autoTranslateEnabled);

    if (!config.autoTranslateEnabled) {
      logger.info('Auto-translate is disabled');
      return;
    }

    logger.info('Auto-translate enabled! Injecting content script...');

    // Inject content script and start auto-translation
    await ensureInjected(tabId);

    // Kick off translation on the page using the main content script contract
    setTimeout(() => {
      logger.info('Enabling auto-translate on tab:', tabId);
      chrome.tabs.sendMessage(tabId, { type: 'toggleAutoTranslate', action: 'toggle-auto-translate', enabled: true }).catch((error) => {
        logger.info('Failed to toggle auto-translate:', error);
      });

      logger.info('Sending start message to tab:', tabId);
      chrome.tabs.sendMessage(tabId, { type: 'start', action: 'start', force: true }).catch((error) => {
        logger.info('Failed to send start message:', error);
      });
    }, 300);

  } catch (error) {
    logger.debug('Auto-injection failed for tab:', tabId, error);
  }
}

// Listen for tab updates (page loads)
if (chrome.tabs && chrome.tabs.onUpdated && typeof chrome.tabs.onUpdated.addListener === 'function') {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    logger.info('Tab updated:', tabId, 'status:', changeInfo.status, 'active:', tab?.active);

    if (changeInfo.status === 'complete' && tab && tab.url && tab.active) {
      logger.info('Tab loaded completely, attempting auto-inject...');
      maybeAutoInject(tabId, tab.url);
    }
  });
}

// Listen for tab activation (switching tabs)
if (chrome.tabs && chrome.tabs.onActivated && typeof chrome.tabs.onActivated.addListener === 'function') {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    logger.info('Tab activated:', tabId);

    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url && tab.status === 'complete') {
        logger.info('Activated tab is complete, attempting auto-inject...');
        maybeAutoInject(tabId, tab.url);
      }
    } catch (error) {
      logger.debug('Tab activation handling failed:', error);
    }
  });
}
