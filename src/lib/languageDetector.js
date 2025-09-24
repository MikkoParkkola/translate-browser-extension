/**
 * Advanced Language Detection System
 * Enhanced language detection with machine learning-like heuristics,
 * real-time content analysis, and integration with Translation Memory
 */

// Avoid redeclaration errors in Brave Browser
if (typeof window !== 'undefined' && window.AdvancedLanguageDetector) {
  console.log('[AdvancedLanguageDetector] Class already exists, skipping redeclaration');
} else {

class AdvancedLanguageDetector {
  constructor(options = {}) {
    this.options = {
      minSampleLength: 50,
      maxSampleLength: 1000,
      confidenceThreshold: 0.7,
      cacheTimeout: 5 * 60 * 1000, // 5 minutes
      realTimeAnalysis: true,
      useTranslationMemory: true,
      ...options
    };

    // Detection results cache
    this.detectionCache = new Map();
    this.domainCache = new Map();

    // Language frequency tracking
    this.languageFrequency = new Map();
    this.userPreferences = new Map();

    // Real-time analysis state
    this.currentAnalysis = null;
    this.analysisTimer = null;

    // Statistics
    this.stats = {
      detectionsPerformed: 0,
      cacheHits: 0,
      averageConfidence: 0,
      mostDetectedLanguages: new Map(),
      detectionMethods: new Map()
    };

    this.initializeLanguagePatterns();
  }

  initializeLanguagePatterns() {
    // Comprehensive language detection patterns
    this.languagePatterns = {
      // Script-based detection (high confidence)
      scripts: {
        'zh': {
          pattern: /[\u4e00-\u9fff]/,
          minMatches: 3,
          confidence: 0.95,
          name: 'Chinese Characters'
        },
        'ja': {
          pattern: /[\u3040-\u309f\u30a0-\u30ff]/,
          minMatches: 2,
          confidence: 0.95,
          name: 'Japanese Hiragana/Katakana'
        },
        'ko': {
          pattern: /[\uac00-\ud7af]/,
          minMatches: 2,
          confidence: 0.95,
          name: 'Korean Hangul'
        },
        'ar': {
          pattern: /[\u0600-\u06ff]/,
          minMatches: 3,
          confidence: 0.95,
          name: 'Arabic Script'
        },
        'ru': {
          pattern: /[\u0400-\u04ff]/,
          minMatches: 3,
          confidence: 0.90,
          name: 'Cyrillic Script'
        },
        'th': {
          pattern: /[\u0e00-\u0e7f]/,
          minMatches: 3,
          confidence: 0.95,
          name: 'Thai Script'
        },
        'hi': {
          pattern: /[\u0900-\u097f]/,
          minMatches: 3,
          confidence: 0.90,
          name: 'Devanagari Script'
        },
        'he': {
          pattern: /[\u0590-\u05ff]/,
          minMatches: 3,
          confidence: 0.95,
          name: 'Hebrew Script'
        }
      },

      // Word-based detection for Latin scripts
      words: {
        'en': {
          common: ['the', 'and', 'of', 'to', 'a', 'in', 'is', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are'],
          distinctive: ['through', 'would', 'could', 'should', 'might', 'about', 'which', 'their', 'there'],
          confidence: 0.8
        },
        'es': {
          common: ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su'],
          distinctive: ['porque', 'también', 'después', 'durante', 'algunos', 'muchos', 'tiempo', 'mundo'],
          confidence: 0.8
        },
        'fr': {
          common: ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son'],
          distinctive: ['avec', 'cette', 'donc', 'même', 'sans', 'encore', 'aussi', 'comme', 'depuis'],
          confidence: 0.8
        },
        'de': {
          common: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im'],
          distinctive: ['aber', 'oder', 'wenn', 'dann', 'noch', 'auch', 'nach', 'über', 'unter', 'zwischen'],
          confidence: 0.8
        },
        'it': {
          common: ['il', 'di', 'che', 'e', 'la', 'per', 'una', 'in', 'con', 'del', 'da', 'non', 'un', 'le', 'si'],
          distinctive: ['come', 'anche', 'dopo', 'prima', 'ancora', 'mentre', 'dove', 'quando', 'perché'],
          confidence: 0.8
        },
        'pt': {
          common: ['o', 'de', 'a', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'uma', 'os', 'no', 'se'],
          distinctive: ['que', 'também', 'quando', 'porque', 'como', 'onde', 'então', 'ainda', 'muito'],
          confidence: 0.8
        },
        'nl': {
          common: ['de', 'het', 'een', 'en', 'van', 'in', 'te', 'dat', 'op', 'voor', 'met', 'als', 'zijn', 'er', 'maar'],
          distinctive: ['omdat', 'tijdens', 'tussen', 'zonder', 'tegen', 'onder', 'boven', 'naast'],
          confidence: 0.8
        }
      },

      // Character frequency patterns for additional validation
      frequencies: {
        'en': { e: 0.127, t: 0.091, a: 0.082, o: 0.075, i: 0.070, n: 0.067, s: 0.063, h: 0.061, r: 0.060 },
        'es': { e: 0.137, a: 0.125, o: 0.086, s: 0.080, r: 0.069, n: 0.067, i: 0.063, d: 0.058, l: 0.052 },
        'fr': { e: 0.121, a: 0.089, i: 0.084, s: 0.081, n: 0.071, r: 0.066, t: 0.059, o: 0.054, l: 0.054 },
        'de': { e: 0.174, n: 0.098, i: 0.075, s: 0.072, r: 0.070, a: 0.065, t: 0.061, d: 0.051, h: 0.048 },
        'it': { e: 0.118, a: 0.117, i: 0.113, o: 0.098, n: 0.069, t: 0.056, r: 0.055, l: 0.051, s: 0.050 }
      }
    };

    // Domain-specific language patterns
    this.domainPatterns = {
      'github.com': ['en'],
      'stackoverflow.com': ['en'],
      'wikipedia.org': ['multi'],
      'reddit.com': ['en'],
      'twitter.com': ['multi'],
      'linkedin.com': ['multi'],
      'facebook.com': ['multi']
    };
  }

  async detectLanguage(text, context = {}) {
    try {
      this.stats.detectionsPerformed++;

      // Quick validation
      if (!text || typeof text !== 'string') {
        return this.createResult(null, 0, 'invalid_input');
      }

      const cleanText = this.preprocessText(text);
      if (cleanText.length < this.options.minSampleLength) {
        return this.createResult(null, 0.1, 'insufficient_text');
      }

      // Check cache first
      const cacheKey = this.createCacheKey(cleanText, context);
      if (this.detectionCache.has(cacheKey)) {
        this.stats.cacheHits++;
        return this.detectionCache.get(cacheKey);
      }

      // Multi-method detection
      const detectionMethods = [
        () => this.detectByScript(cleanText),
        () => this.detectByWords(cleanText),
        () => this.detectByFrequency(cleanText),
        () => this.detectByContext(context),
        () => this.detectByDOM(),
        () => this.detectByTranslationMemory(cleanText)
      ];

      const results = [];
      for (const method of detectionMethods) {
        try {
          const result = await method();
          if (result && result.confidence > 0) {
            results.push(result);
          }
        } catch (error) {
          console.warn('[LanguageDetector] Detection method failed:', error);
        }
      }

      // Combine results with weighted scoring
      const finalResult = this.combineResults(results, cleanText);

      // Cache result
      this.detectionCache.set(cacheKey, finalResult);
      setTimeout(() => this.detectionCache.delete(cacheKey), this.options.cacheTimeout);

      // Update statistics
      this.updateStatistics(finalResult);

      return finalResult;

    } catch (error) {
      console.error('[LanguageDetector] Detection failed:', error);
      return this.createResult(null, 0, 'detection_error');
    }
  }

  detectByScript(text) {
    for (const [lang, config] of Object.entries(this.languagePatterns.scripts)) {
      const matches = (text.match(config.pattern) || []).length;
      if (matches >= config.minMatches) {
        const confidence = Math.min(config.confidence, matches / text.length * 10);
        return this.createResult(lang, confidence, 'script_analysis', {
          matches,
          pattern: config.name
        });
      }
    }
    return null;
  }

  detectByWords(text) {
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    if (words.length < 5) return null;

    const scores = new Map();

    for (const [lang, config] of Object.entries(this.languagePatterns.words)) {
      let commonMatches = 0;
      let distinctiveMatches = 0;

      for (const word of words) {
        if (config.common.includes(word)) {
          commonMatches++;
        }
        if (config.distinctive.includes(word)) {
          distinctiveMatches += 2; // Weight distinctive words more
        }
      }

      const totalScore = (commonMatches + distinctiveMatches) / words.length;
      if (totalScore > 0) {
        scores.set(lang, {
          score: totalScore,
          confidence: Math.min(config.confidence, totalScore * 3),
          commonMatches,
          distinctiveMatches
        });
      }
    }

    if (scores.size === 0) return null;

    // Find the best match
    const bestMatch = Array.from(scores.entries()).reduce((best, [lang, data]) =>
      data.score > best.score ? { lang, ...data } : best
    , { score: 0 });

    if (bestMatch.score > 0.05) { // Minimum threshold
      return this.createResult(bestMatch.lang, bestMatch.confidence, 'word_analysis', {
        wordScore: bestMatch.score,
        commonMatches: bestMatch.commonMatches,
        distinctiveMatches: bestMatch.distinctiveMatches,
        totalWords: words.length
      });
    }

    return null;
  }

  detectByFrequency(text) {
    if (text.length < 100) return null; // Need sufficient text for frequency analysis

    const charCounts = {};
    const totalChars = text.length;

    for (const char of text.toLowerCase()) {
      if (/[a-z]/.test(char)) {
        charCounts[char] = (charCounts[char] || 0) + 1;
      }
    }

    const frequencies = {};
    for (const [char, count] of Object.entries(charCounts)) {
      frequencies[char] = count / totalChars;
    }

    const languageScores = new Map();

    for (const [lang, expectedFreq] of Object.entries(this.languagePatterns.frequencies)) {
      let score = 0;
      let validChars = 0;

      for (const [char, freq] of Object.entries(expectedFreq)) {
        if (frequencies[char] !== undefined) {
          // Calculate difference and penalize large deviations
          const diff = Math.abs(frequencies[char] - freq);
          score += 1 - (diff / freq); // Normalized score
          validChars++;
        }
      }

      if (validChars > 3) { // Need at least 4 matching characters
        const avgScore = score / validChars;
        if (avgScore > 0.5) {
          languageScores.set(lang, avgScore);
        }
      }
    }

    if (languageScores.size === 0) return null;

    const [bestLang, bestScore] = Array.from(languageScores.entries())
      .reduce((best, current) => current[1] > best[1] ? current : best);

    return this.createResult(bestLang, Math.min(0.7, bestScore), 'frequency_analysis', {
      frequencyScore: bestScore,
      analyzedChars: Object.keys(frequencies).length
    });
  }

  detectByContext(context) {
    const { url, domain, userAgent, timezone, previousDetections } = context;

    // Domain-based hints
    if (domain && this.domainPatterns[domain]) {
      const domainLangs = this.domainPatterns[domain];
      if (domainLangs.length === 1 && domainLangs[0] !== 'multi') {
        return this.createResult(domainLangs[0], 0.3, 'domain_hint', { domain });
      }
    }

    // Geographic hints from timezone
    if (timezone) {
      const geoHints = this.getGeographicLanguageHints(timezone);
      if (geoHints.length > 0) {
        return this.createResult(geoHints[0], 0.2, 'geographic_hint', { timezone, hints: geoHints });
      }
    }

    // Previous detection consistency
    if (previousDetections && previousDetections.length > 0) {
      const consistentLang = this.findConsistentLanguage(previousDetections);
      if (consistentLang) {
        return this.createResult(consistentLang, 0.4, 'consistency_hint', {
          previousDetections: previousDetections.length
        });
      }
    }

    return null;
  }

  detectByDOM() {
    try {
      // HTML lang attribute (highest priority for DOM-based detection)
      const htmlLang = document.documentElement.lang;
      if (htmlLang && this.isValidLanguageCode(htmlLang)) {
        return this.createResult(htmlLang.split('-')[0], 0.8, 'html_lang_attribute');
      }

      // Meta tags
      const metaLang = document.querySelector('meta[http-equiv="content-language"]')?.content;
      if (metaLang && this.isValidLanguageCode(metaLang)) {
        return this.createResult(metaLang.split('-')[0], 0.7, 'meta_content_language');
      }

      // OpenGraph locale
      const ogLocale = document.querySelector('meta[property="og:locale"]')?.content;
      if (ogLocale && this.isValidLanguageCode(ogLocale)) {
        return this.createResult(ogLocale.split('-')[0], 0.6, 'opengraph_locale');
      }

      // Browser language as fallback
      const browserLang = navigator.language || navigator.userLanguage;
      if (browserLang) {
        return this.createResult(browserLang.split('-')[0], 0.2, 'browser_language');
      }

    } catch (error) {
      console.warn('[LanguageDetector] DOM detection failed:', error);
    }

    return null;
  }

  async detectByTranslationMemory(text) {
    if (!this.options.useTranslationMemory) return null;

    try {
      // Check if Translation Memory is available
      if (typeof window !== 'undefined' && window.getTranslationMemory) {
        const tm = window.getTranslationMemory();

        // Look for existing translations of this text
        const textSample = text.substring(0, 200);

        // Simple heuristic: if we've translated similar text before,
        // use the source language from those translations
        const stats = tm.getStats();
        if (stats.hits > 0) {
          // This is a simplified approach - in practice, we'd want to
          // search for similar texts in the TM
          return this.createResult('auto', 0.1, 'translation_memory_hint', {
            tmEntries: stats.cacheSize
          });
        }
      }
    } catch (error) {
      console.warn('[LanguageDetector] Translation Memory detection failed:', error);
    }

    return null;
  }

  combineResults(results, text) {
    if (results.length === 0) {
      return this.createResult('auto', 0.1, 'no_detection_methods');
    }

    // Group results by language
    const languageGroups = new Map();

    for (const result of results) {
      if (!result.language) continue;

      if (!languageGroups.has(result.language)) {
        languageGroups.set(result.language, []);
      }
      languageGroups.get(result.language).push(result);
    }

    // Calculate combined scores for each language
    const languageScores = new Map();

    for (const [lang, langResults] of languageGroups) {
      let totalWeight = 0;
      let weightedScore = 0;

      for (const result of langResults) {
        const weight = this.getMethodWeight(result.method);
        totalWeight += weight;
        weightedScore += result.confidence * weight;
      }

      const avgConfidence = totalWeight > 0 ? weightedScore / totalWeight : 0;
      languageScores.set(lang, {
        confidence: avgConfidence,
        methodCount: langResults.length,
        methods: langResults.map(r => r.method),
        details: langResults
      });
    }

    // Find the best result
    let bestLang = 'auto';
    let bestData = { confidence: 0, methodCount: 0, methods: [], details: [] };

    for (const [lang, data] of languageScores) {
      // Prefer higher confidence, then more methods
      if (data.confidence > bestData.confidence ||
          (data.confidence === bestData.confidence && data.methodCount > bestData.methodCount)) {
        bestLang = lang;
        bestData = data;
      }
    }

    return this.createResult(bestLang, bestData.confidence, 'combined_analysis', {
      methodCount: bestData.methodCount,
      methods: bestData.methods,
      alternativeLanguages: Array.from(languageScores.entries())
        .filter(([lang]) => lang !== bestLang)
        .map(([lang, data]) => ({ language: lang, confidence: data.confidence }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
    });
  }

  getMethodWeight(method) {
    const weights = {
      'script_analysis': 1.0,      // Highest weight - script detection is very reliable
      'html_lang_attribute': 0.9,  // HTML lang is usually accurate
      'word_analysis': 0.8,        // Word patterns are quite reliable
      'frequency_analysis': 0.7,   // Character frequency is moderately reliable
      'meta_content_language': 0.6, // Meta tags are sometimes accurate
      'opengraph_locale': 0.5,     // OpenGraph is decent
      'consistency_hint': 0.4,     // Previous detections provide context
      'domain_hint': 0.3,          // Domain gives weak hints
      'geographic_hint': 0.2,      // Geographic context is weak
      'browser_language': 0.1,     // Browser language is very weak
      'translation_memory_hint': 0.1 // TM provides weak hints
    };

    return weights[method] || 0.5;
  }

  preprocessText(text) {
    // Clean and normalize text for analysis
    return text
      .replace(/[\r\n\t]+/g, ' ')  // Normalize whitespace
      .replace(/\s+/g, ' ')        // Collapse multiple spaces
      .trim()
      .substring(0, this.options.maxSampleLength); // Limit length
  }

  createCacheKey(text, context) {
    const textHash = this.simpleHash(text.substring(0, 100));
    const contextHash = this.simpleHash(JSON.stringify(context || {}));
    return `${textHash}_${contextHash}`;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  createResult(language, confidence, method, details = {}) {
    return {
      language: language || 'auto',
      confidence: Math.max(0, Math.min(1, confidence || 0)),
      method,
      details,
      timestamp: Date.now()
    };
  }

  isValidLanguageCode(code) {
    if (!code || typeof code !== 'string') return false;

    const validCodes = [
      'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'th', 'he',
      'da', 'no', 'sv', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sl', 'et', 'lv', 'lt',
      'tr', 'el', 'vi', 'id', 'ms', 'tl', 'sw', 'am', 'ur', 'fa', 'ps', 'ku', 'hy', 'ka', 'az',
      'kk', 'ky', 'uz', 'tk', 'mn', 'my', 'km', 'lo', 'si', 'ta', 'te', 'kn', 'ml', 'gu', 'pa',
      'bn', 'as', 'or', 'ne', 'dz', 'bo', 'ii', 'chr', 'iu', 'oj', 'cr', 'gd', 'cy', 'ga', 'gv',
      'br', 'kw', 'eu', 'ca', 'gl', 'oc', 'mt', 'is', 'fo', 'gn', 'qu', 'ay', 'nv', 'haw', 'mg',
      'ny', 'sn', 'st', 'tn', 'ts', 've', 'xh', 'zu', 'af', 'sq', 'be', 'bs', 'mk', 'sr', 'uk'
    ];

    return validCodes.includes(code.toLowerCase().split('-')[0]);
  }

  getGeographicLanguageHints(timezone) {
    const geoMapping = {
      'America': ['en', 'es', 'pt', 'fr'],
      'Europe': ['en', 'de', 'fr', 'es', 'it', 'ru'],
      'Asia': ['zh', 'ja', 'ko', 'hi', 'ar', 'th', 'vi'],
      'Africa': ['en', 'fr', 'ar', 'sw'],
      'Australia': ['en'],
      'Pacific': ['en']
    };

    for (const [region, languages] of Object.entries(geoMapping)) {
      if (timezone.includes(region)) {
        return languages;
      }
    }

    return [];
  }

  findConsistentLanguage(previousDetections) {
    if (previousDetections.length < 2) return null;

    const langCounts = new Map();
    for (const detection of previousDetections) {
      if (detection.language && detection.confidence > 0.5) {
        langCounts.set(detection.language, (langCounts.get(detection.language) || 0) + 1);
      }
    }

    if (langCounts.size === 0) return null;

    const [mostFrequentLang, count] = Array.from(langCounts.entries())
      .reduce((best, current) => current[1] > best[1] ? current : best);

    // Require at least 60% consistency
    return count / previousDetections.length >= 0.6 ? mostFrequentLang : null;
  }

  updateStatistics(result) {
    // Update average confidence
    const currentAvg = this.stats.averageConfidence;
    const newCount = this.stats.detectionsPerformed;
    this.stats.averageConfidence = (currentAvg * (newCount - 1) + result.confidence) / newCount;

    // Track most detected languages
    if (result.language && result.language !== 'auto') {
      const current = this.stats.mostDetectedLanguages.get(result.language) || 0;
      this.stats.mostDetectedLanguages.set(result.language, current + 1);
    }

    // Track detection methods
    const methodCount = this.stats.detectionMethods.get(result.method) || 0;
    this.stats.detectionMethods.set(result.method, methodCount + 1);
  }

  // Real-time content analysis
  startRealTimeAnalysis(contentObserver) {
    if (!this.options.realTimeAnalysis || !contentObserver) return;

    // Listen to ContentObserver for new content
    this.contentObserver = contentObserver;
    this.realTimeQueue = [];

    console.log('[LanguageDetector] Real-time analysis started');
  }

  async analyzeNewContent(nodes, metadata = {}) {
    if (!this.options.realTimeAnalysis) return;

    try {
      // Extract text from nodes
      const textSamples = nodes
        .map(node => node.textContent?.trim())
        .filter(text => text && text.length > 20)
        .slice(0, 5); // Limit to first 5 samples for performance

      if (textSamples.length === 0) return;

      const combinedText = textSamples.join(' ').substring(0, 500);

      const result = await this.detectLanguage(combinedText, {
        context: 'real_time_content',
        priority: metadata.priority,
        visible: metadata.visible,
        nodeCount: nodes.length
      });

      // Store result for trend analysis
      this.realTimeQueue.push({
        timestamp: Date.now(),
        result,
        nodeCount: nodes.length,
        metadata
      });

      // Keep only recent results (last 10 minutes)
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      this.realTimeQueue = this.realTimeQueue.filter(item => item.timestamp > tenMinutesAgo);

      return result;

    } catch (error) {
      console.warn('[LanguageDetector] Real-time analysis failed:', error);
    }
  }

  getRealTimeLanguageTrends() {
    if (!this.realTimeQueue || this.realTimeQueue.length === 0) {
      return { dominant: 'auto', confidence: 0, trends: [] };
    }

    const languageCounts = new Map();
    let totalConfidence = 0;

    for (const item of this.realTimeQueue) {
      const { language, confidence } = item.result;
      if (language && language !== 'auto') {
        const current = languageCounts.get(language) || { count: 0, totalConfidence: 0 };
        languageCounts.set(language, {
          count: current.count + 1,
          totalConfidence: current.totalConfidence + confidence
        });
        totalConfidence += confidence;
      }
    }

    if (languageCounts.size === 0) {
      return { dominant: 'auto', confidence: 0, trends: [] };
    }

    const trends = Array.from(languageCounts.entries())
      .map(([lang, data]) => ({
        language: lang,
        frequency: data.count / this.realTimeQueue.length,
        avgConfidence: data.totalConfidence / data.count,
        detections: data.count
      }))
      .sort((a, b) => b.frequency - a.frequency);

    const dominant = trends[0];

    return {
      dominant: dominant.language,
      confidence: dominant.avgConfidence,
      frequency: dominant.frequency,
      trends,
      totalAnalyses: this.realTimeQueue.length
    };
  }

  getStatistics() {
    return {
      ...this.stats,
      cacheSize: this.detectionCache.size,
      domainCacheSize: this.domainCache.size,
      realtimeQueueSize: this.realTimeQueue?.length || 0,
      mostDetectedLanguages: Array.from(this.stats.mostDetectedLanguages.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      detectionMethods: Array.from(this.stats.detectionMethods.entries())
        .sort((a, b) => b[1] - a[1])
    };
  }

  clearCache() {
    this.detectionCache.clear();
    this.domainCache.clear();
    console.log('[LanguageDetector] Cache cleared');
  }

  destroy() {
    this.clearCache();
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
    }
    this.realTimeQueue = [];
    console.log('[LanguageDetector] Detector destroyed');
  }
}

// Export for different environments
if (typeof window !== 'undefined') {
  window.AdvancedLanguageDetector = AdvancedLanguageDetector;
} else if (typeof self !== 'undefined') {
  self.AdvancedLanguageDetector = AdvancedLanguageDetector;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdvancedLanguageDetector;
}

} // End of redeclaration protection