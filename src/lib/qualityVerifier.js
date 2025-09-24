/**
 * Translation Quality Verification System
 * Analyzes translation quality using multiple verification methods
 */

// Avoid redeclaration errors in Brave Browser
if (typeof window !== 'undefined' && window.TranslationQualityVerifier) {
  console.log('[TranslationQualityVerifier] Class already exists, skipping redeclaration');
} else {

class TranslationQualityVerifier {
  constructor(options = {}) {
    this.options = {
      enableLengthAnalysis: true,
      enableCharacterSetAnalysis: true,
      enableLanguageConsistency: true,
      enableContentPreservation: true,
      enableFormattingVerification: true,
      enableSemanticChecks: true,
      enableFlaggingSystem: true,
      confidenceThreshold: 0.7,
      maxLengthRatio: 3.0,
      minLengthRatio: 0.3,
      ...options
    };

    // Quality metrics tracking
    this.qualityMetrics = {
      lengthRatio: 0,
      characterSetConsistency: 0,
      languageConsistency: 0,
      contentPreservation: 0,
      formattingPreservation: 0,
      semanticCoherence: 0,
      overallScore: 0
    };

    // Issue detection patterns
    this.issuePatterns = {
      // Common translation problems
      untranslatedText: /[a-zA-Z]{3,}/g, // Latin characters in non-Latin target
      mixedLanguages: /([a-zA-Z]+[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+|[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+[a-zA-Z]+)/g,
      repeatedPhrases: /(.{10,})\1{2,}/g,
      malformedHtml: /<[^>]*$/g,
      brokenLinks: /https?:\/\/[^\s]*[^\s.]/g,
      truncatedSentences: /[.!?]\s*$/g
    };

    // Language-specific patterns for verification
    this.languagePatterns = {
      en: /^[a-zA-Z0-9\s\p{P}\p{S}]*$/u,
      es: /^[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ0-9\s\p{P}\p{S}]*$/u,
      fr: /^[a-zA-ZàâäéèêëïîôöùûüÿçÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ0-9\s\p{P}\p{S}]*$/u,
      de: /^[a-zA-ZäöüßÄÖÜ0-9\s\p{P}\p{S}]*$/u,
      it: /^[a-zA-ZàéèíìîóòúùÀÉÈÍÌÎÓÒÚÙ0-9\s\p{P}\p{S}]*$/u,
      pt: /^[a-zA-ZáâãàéêíóôõúçÁÂÃÀÉÊÍÓÔÕÚÇ0-9\s\p{P}\p{S}]*$/u,
      ru: /^[\u0400-\u04FF0-9\s\p{P}\p{S}]*$/u,
      zh: /^[\u4e00-\u9fff0-9\s\p{P}\p{S}]*$/u,
      ja: /^[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff0-9\s\p{P}\p{S}]*$/u,
      ko: /^[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f0-9\s\p{P}\p{S}]*$/u,
      ar: /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF0-9\s\p{P}\p{S}]*$/u,
      hi: /^[\u0900-\u097F0-9\s\p{P}\p{S}]*$/u,
      th: /^[\u0e00-\u0e7f0-9\s\p{P}\p{S}]*$/u
    };

    // Initialize quality cache
    this.qualityCache = new Map();
    this.cacheMaxSize = options.cacheSize || 1000;
    this.cacheTTL = options.cacheTTL || 10 * 60 * 1000; // 10 minutes

    console.log('[QualityVerifier] Initialized with options:', this.options);
  }

  /**
   * Verify translation quality comprehensively
   */
  async verifyTranslation(original, translated, context = {}) {
    const startTime = Date.now();

    try {
      const {
        sourceLanguage = 'auto',
        targetLanguage = 'en',
        translationId = null,
        provider = 'unknown'
      } = context;

      // Check cache first
      const cacheKey = this.generateCacheKey(original, translated, sourceLanguage, targetLanguage);
      const cached = this.qualityCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.result;
      }

      console.log(`[QualityVerifier] Verifying translation quality for ${original.length} chars`);

      // Initialize verification result
      const verification = {
        translationId,
        provider,
        timestamp: Date.now(),
        sourceLength: original.length,
        targetLength: translated.length,
        sourceLanguage,
        targetLanguage,
        metrics: {},
        issues: [],
        flags: [],
        recommendations: [],
        overallScore: 0,
        confidence: 0,
        status: 'unknown'
      };

      // Run verification methods
      const verificationMethods = [
        () => this.verifyLength(original, translated, verification),
        () => this.verifyCharacterSet(translated, targetLanguage, verification),
        () => this.verifyLanguageConsistency(translated, targetLanguage, verification),
        () => this.verifyContentPreservation(original, translated, verification),
        () => this.verifyFormatting(original, translated, verification),
        () => this.verifySemanticCoherence(original, translated, verification),
        () => this.detectCommonIssues(original, translated, verification)
      ];

      for (const method of verificationMethods) {
        try {
          await method();
        } catch (error) {
          console.warn('[QualityVerifier] Verification method failed:', error);
        }
      }

      // Calculate overall quality score
      this.calculateOverallScore(verification);

      // Determine verification status
      this.determineVerificationStatus(verification);

      // Generate recommendations
      this.generateRecommendations(verification);

      // Cache result
      this.qualityCache.set(cacheKey, {
        result: verification,
        timestamp: Date.now()
      });

      // Cleanup cache if needed
      this.cleanupCache();

      const duration = Date.now() - startTime;
      console.log(`[QualityVerifier] Verification completed in ${duration}ms, score: ${verification.overallScore.toFixed(2)}`);

      return verification;

    } catch (error) {
      console.error('[QualityVerifier] Verification failed:', error);
      return {
        status: 'error',
        error: error.message,
        overallScore: 0,
        confidence: 0,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Verify translation length appropriateness
   */
  verifyLength(original, translated, verification) {
    if (!this.options.enableLengthAnalysis) return;

    const sourceLength = original.trim().length;
    const targetLength = translated.trim().length;

    if (sourceLength === 0) {
      verification.metrics.lengthRatio = 0;
      return;
    }

    const lengthRatio = targetLength / sourceLength;
    verification.metrics.lengthRatio = lengthRatio;

    // Check for suspicious length ratios
    if (lengthRatio > this.options.maxLengthRatio) {
      verification.issues.push({
        type: 'length_excessive',
        severity: 'warning',
        message: `Translation is ${lengthRatio.toFixed(1)}x longer than original`,
        metric: lengthRatio
      });
    } else if (lengthRatio < this.options.minLengthRatio) {
      verification.issues.push({
        type: 'length_insufficient',
        severity: 'warning',
        message: `Translation is only ${(lengthRatio * 100).toFixed(0)}% of original length`,
        metric: lengthRatio
      });
    }

    // Score based on reasonable length ratio (ideal range: 0.7-1.5)
    const idealMin = 0.7;
    const idealMax = 1.5;
    let lengthScore = 1.0;

    if (lengthRatio < idealMin) {
      lengthScore = Math.max(0, lengthRatio / idealMin);
    } else if (lengthRatio > idealMax) {
      lengthScore = Math.max(0, idealMax / lengthRatio);
    }

    verification.metrics.lengthScore = lengthScore;
  }

  /**
   * Verify character set consistency with target language
   */
  verifyCharacterSet(translated, targetLanguage, verification) {
    if (!this.options.enableCharacterSetAnalysis) return;

    const pattern = this.languagePatterns[targetLanguage];
    if (!pattern) {
      verification.metrics.characterSetScore = 0.5; // Unknown language
      return;
    }

    const matches = translated.match(pattern);
    const consistency = matches && matches[0] === translated ? 1.0 : 0.0;

    verification.metrics.characterSetScore = consistency;

    if (consistency < 0.9) {
      verification.issues.push({
        type: 'character_set_inconsistency',
        severity: 'warning',
        message: `Text contains characters inconsistent with ${targetLanguage}`,
        metric: consistency
      });
    }
  }

  /**
   * Verify language consistency within translation
   */
  verifyLanguageConsistency(translated, targetLanguage, verification) {
    if (!this.options.enableLanguageConsistency) return;

    // Check for mixed language patterns
    const mixedLanguages = translated.match(this.issuePatterns.mixedLanguages);
    let consistencyScore = 1.0;

    if (mixedLanguages && mixedLanguages.length > 0) {
      consistencyScore = Math.max(0, 1 - (mixedLanguages.length * 0.2));
      verification.issues.push({
        type: 'mixed_languages',
        severity: 'warning',
        message: `Found ${mixedLanguages.length} mixed language segments`,
        examples: mixedLanguages.slice(0, 3)
      });
    }

    // Check for untranslated text (if target is non-Latin)
    if (!['en', 'es', 'fr', 'de', 'it', 'pt'].includes(targetLanguage)) {
      const untranslated = translated.match(this.issuePatterns.untranslatedText);
      if (untranslated && untranslated.length > 0) {
        consistencyScore *= 0.7;
        verification.issues.push({
          type: 'untranslated_segments',
          severity: 'error',
          message: `Found ${untranslated.length} potentially untranslated segments`,
          examples: untranslated.slice(0, 3)
        });
      }
    }

    verification.metrics.languageConsistencyScore = consistencyScore;
  }

  /**
   * Verify content preservation (URLs, numbers, formatting)
   */
  verifyContentPreservation(original, translated, verification) {
    if (!this.options.enableContentPreservation) return;

    let preservationScore = 1.0;
    const issues = [];

    // Check URL preservation
    const originalUrls = (original.match(/https?:\/\/[^\s]+/g) || []);
    const translatedUrls = (translated.match(/https?:\/\/[^\s]+/g) || []);

    if (originalUrls.length !== translatedUrls.length) {
      preservationScore *= 0.8;
      issues.push({
        type: 'url_preservation',
        severity: 'error',
        message: `URL count mismatch: ${originalUrls.length} → ${translatedUrls.length}`
      });
    }

    // Check number preservation
    const originalNumbers = (original.match(/\b\d+(?:\.\d+)?\b/g) || []);
    const translatedNumbers = (translated.match(/\b\d+(?:\.\d+)?\b/g) || []);

    if (originalNumbers.length > 0) {
      const numberPreservation = translatedNumbers.length / originalNumbers.length;
      if (numberPreservation < 0.8) {
        preservationScore *= 0.9;
        issues.push({
          type: 'number_preservation',
          severity: 'warning',
          message: `Potential number loss: ${originalNumbers.length} → ${translatedNumbers.length}`
        });
      }
    }

    // Check email preservation
    const originalEmails = (original.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || []);
    const translatedEmails = (translated.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || []);

    if (originalEmails.length !== translatedEmails.length) {
      preservationScore *= 0.8;
      issues.push({
        type: 'email_preservation',
        severity: 'error',
        message: `Email count mismatch: ${originalEmails.length} → ${translatedEmails.length}`
      });
    }

    verification.metrics.contentPreservationScore = preservationScore;
    verification.issues.push(...issues);
  }

  /**
   * Verify formatting preservation
   */
  verifyFormatting(original, translated, verification) {
    if (!this.options.enableFormattingVerification) return;

    let formattingScore = 1.0;
    const issues = [];

    // Check HTML tag preservation
    const originalTags = (original.match(/<[^>]+>/g) || []);
    const translatedTags = (translated.match(/<[^>]+>/g) || []);

    if (originalTags.length !== translatedTags.length) {
      formattingScore *= 0.7;
      issues.push({
        type: 'html_tag_mismatch',
        severity: 'error',
        message: `HTML tag count mismatch: ${originalTags.length} → ${translatedTags.length}`
      });
    }

    // Check for malformed HTML
    const malformedHtml = translated.match(this.issuePatterns.malformedHtml);
    if (malformedHtml) {
      formattingScore *= 0.8;
      issues.push({
        type: 'malformed_html',
        severity: 'error',
        message: 'Detected malformed HTML tags'
      });
    }

    // Check whitespace preservation patterns
    const originalWhitespace = original.match(/^\s+|\s+$/g);
    const translatedWhitespace = translated.match(/^\s+|\s+$/g);

    if ((originalWhitespace?.length || 0) !== (translatedWhitespace?.length || 0)) {
      formattingScore *= 0.95;
      issues.push({
        type: 'whitespace_formatting',
        severity: 'info',
        message: 'Leading/trailing whitespace pattern changed'
      });
    }

    verification.metrics.formattingScore = formattingScore;
    verification.issues.push(...issues);
  }

  /**
   * Verify semantic coherence
   */
  verifySemanticCoherence(original, translated, verification) {
    if (!this.options.enableSemanticChecks) return;

    let coherenceScore = 1.0;
    const issues = [];

    // Check for repeated phrases (potential translation loop)
    const repeatedPhrases = translated.match(this.issuePatterns.repeatedPhrases);
    if (repeatedPhrases && repeatedPhrases.length > 0) {
      coherenceScore *= 0.6;
      issues.push({
        type: 'repeated_phrases',
        severity: 'error',
        message: `Found ${repeatedPhrases.length} repeated phrase patterns`,
        examples: repeatedPhrases.slice(0, 2)
      });
    }

    // Check sentence completion
    const originalSentences = original.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const translatedSentences = translated.split(/[.!?]+/).filter(s => s.trim().length > 0);

    if (originalSentences.length > 0) {
      const sentenceRatio = translatedSentences.length / originalSentences.length;
      if (sentenceRatio < 0.5 || sentenceRatio > 2.0) {
        coherenceScore *= 0.8;
        issues.push({
          type: 'sentence_structure',
          severity: 'warning',
          message: `Sentence count ratio unusual: ${sentenceRatio.toFixed(1)}`
        });
      }
    }

    // Check for truncated content
    if (translated.length < original.length * 0.3 && original.length > 100) {
      coherenceScore *= 0.5;
      issues.push({
        type: 'potential_truncation',
        severity: 'error',
        message: 'Translation appears significantly truncated'
      });
    }

    verification.metrics.semanticCoherenceScore = coherenceScore;
    verification.issues.push(...issues);
  }

  /**
   * Detect common translation issues
   */
  detectCommonIssues(original, translated, verification) {
    const issues = [];

    // Empty translation
    if (!translated.trim()) {
      issues.push({
        type: 'empty_translation',
        severity: 'error',
        message: 'Translation is empty'
      });
    }

    // Identical translation (potential untranslated)
    if (original.trim() === translated.trim() && original.length > 10) {
      issues.push({
        type: 'identical_content',
        severity: 'warning',
        message: 'Translation is identical to original'
      });
    }

    // Single character translations
    if (translated.trim().length === 1 && original.length > 10) {
      issues.push({
        type: 'single_character',
        severity: 'error',
        message: 'Translation reduced to single character'
      });
    }

    // Broken formatting indicators
    if (original.includes('\n') && !translated.includes('\n') && original.length > 100) {
      issues.push({
        type: 'line_break_loss',
        severity: 'warning',
        message: 'Line breaks not preserved in translation'
      });
    }

    verification.issues.push(...issues);
  }

  /**
   * Calculate overall quality score
   */
  calculateOverallScore(verification) {
    const metrics = verification.metrics;
    const weights = {
      lengthScore: 0.15,
      characterSetScore: 0.20,
      languageConsistencyScore: 0.25,
      contentPreservationScore: 0.20,
      formattingScore: 0.10,
      semanticCoherenceScore: 0.10
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [metric, weight] of Object.entries(weights)) {
      if (metrics[metric] !== undefined) {
        weightedSum += metrics[metric] * weight;
        totalWeight += weight;
      }
    }

    // Base score from metrics
    let overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

    // Apply penalties for critical issues
    const criticalIssues = verification.issues.filter(issue => issue.severity === 'error');
    const warningIssues = verification.issues.filter(issue => issue.severity === 'warning');

    overallScore *= Math.max(0.1, 1 - (criticalIssues.length * 0.2));
    overallScore *= Math.max(0.5, 1 - (warningIssues.length * 0.1));

    // Ensure score is between 0 and 1
    verification.overallScore = Math.max(0, Math.min(1, overallScore));

    // Calculate confidence based on score consistency
    verification.confidence = this.calculateConfidence(verification);
  }

  /**
   * Calculate confidence in the quality assessment
   */
  calculateConfidence(verification) {
    const metrics = verification.metrics;
    const scores = Object.values(metrics).filter(val => typeof val === 'number' && val >= 0 && val <= 1);

    if (scores.length === 0) return 0.5;

    // Confidence is higher when scores are consistent
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const consistency = Math.max(0, 1 - variance);

    // High consistency and reasonable number of metrics = high confidence
    return Math.min(1, consistency * (scores.length / 6));
  }

  /**
   * Determine overall verification status
   */
  determineVerificationStatus(verification) {
    const score = verification.overallScore;
    const criticalIssues = verification.issues.filter(issue => issue.severity === 'error').length;

    if (criticalIssues > 0) {
      verification.status = 'failed';
      verification.flags.push('quality_issues_detected');
    } else if (score >= 0.8) {
      verification.status = 'excellent';
    } else if (score >= 0.6) {
      verification.status = 'good';
    } else if (score >= 0.4) {
      verification.status = 'fair';
      verification.flags.push('quality_concerns');
    } else {
      verification.status = 'poor';
      verification.flags.push('significant_quality_issues');
    }
  }

  /**
   * Generate improvement recommendations
   */
  generateRecommendations(verification) {
    const recommendations = [];
    const issues = verification.issues;

    // Recommendations based on detected issues
    if (issues.some(i => i.type === 'length_excessive')) {
      recommendations.push('Consider using a more concise translation approach');
    }

    if (issues.some(i => i.type === 'length_insufficient')) {
      recommendations.push('Translation may be missing content - verify completeness');
    }

    if (issues.some(i => i.type === 'untranslated_segments')) {
      recommendations.push('Review translation for untranslated segments');
    }

    if (issues.some(i => i.type === 'character_set_inconsistency')) {
      recommendations.push('Verify character encoding and target language settings');
    }

    if (issues.some(i => i.type.includes('preservation'))) {
      recommendations.push('Check preservation of URLs, numbers, and special content');
    }

    if (issues.some(i => i.type.includes('html') || i.type.includes('formatting'))) {
      recommendations.push('Verify HTML tags and formatting preservation');
    }

    if (verification.overallScore < 0.5) {
      recommendations.push('Consider retranslating with different parameters');
    }

    verification.recommendations = recommendations;
  }

  /**
   * Generate cache key for quality verification
   */
  generateCacheKey(original, translated, sourceLanguage, targetLanguage) {
    const content = original + '|' + translated + '|' + sourceLanguage + '|' + targetLanguage;
    return this.simpleHash(content);
  }

  /**
   * Simple hash function for cache keys
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Clean up old cache entries
   */
  cleanupCache() {
    if (this.qualityCache.size <= this.cacheMaxSize) return;

    const now = Date.now();
    const entries = Array.from(this.qualityCache.entries());

    // Remove expired entries first
    for (const [key, value] of entries) {
      if (now - value.timestamp > this.cacheTTL) {
        this.qualityCache.delete(key);
      }
    }

    // If still over limit, remove oldest entries
    if (this.qualityCache.size > this.cacheMaxSize) {
      const sortedEntries = entries
        .filter(([key]) => this.qualityCache.has(key))
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const entriesToRemove = sortedEntries.slice(0, sortedEntries.length - this.cacheMaxSize);
      for (const [key] of entriesToRemove) {
        this.qualityCache.delete(key);
      }
    }
  }

  /**
   * Get quality verification statistics
   */
  getStats() {
    return {
      cacheSize: this.qualityCache.size,
      cacheMaxSize: this.cacheMaxSize,
      cacheTTL: this.cacheTTL,
      options: this.options,
      supportedLanguages: Object.keys(this.languagePatterns)
    };
  }

  /**
   * Clear quality cache
   */
  clearCache() {
    this.qualityCache.clear();
    console.log('[QualityVerifier] Cache cleared');
  }

  /**
   * Configure quality verifier options
   */
  configure(newOptions) {
    this.options = { ...this.options, ...newOptions };
    console.log('[QualityVerifier] Configuration updated:', newOptions);
  }
}

// Export for different environments
if (typeof window !== 'undefined') {
  window.TranslationQualityVerifier = TranslationQualityVerifier;
} else if (typeof self !== 'undefined') {
  self.TranslationQualityVerifier = TranslationQualityVerifier;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationQualityVerifier;
}

} // End of redeclaration protection