/**
 * Intelligent Text Splitter
 *
 * Splits text at natural linguistic boundaries (sentences, clauses, paragraphs)
 * while respecting API token limits and preserving context for better translations.
 *
 * Features:
 * - Sentence-boundary detection with multi-language support
 * - Clause and phrase boundary recognition
 * - Token limit awareness with configurable thresholds
 * - Context preservation across splits
 * - Special handling for code, URLs, and structured content
 * - Smart rejoining with proper spacing and formatting
 */

import { logger } from './logger.js';

(function(global) {
  'use strict';

  class IntelligentTextSplitter {
    constructor(options = {}) {
      this.options = {
        // Token limits and sizing
        maxTokensPerChunk: options.maxTokensPerChunk || 4000,
        minTokensPerChunk: options.minTokensPerChunk || 100,
        overlapTokens: options.overlapTokens || 50,

        // Language-specific settings
        defaultLanguage: options.defaultLanguage || 'en',
        enableMultiLanguageDetection: options.enableMultiLanguageDetection !== false,

        // Splitting behavior
        preferSentenceBoundaries: options.preferSentenceBoundaries !== false,
        preserveFormatting: options.preserveFormatting !== false,
        handleCodeBlocks: options.handleCodeBlocks !== false,
        preserveUrls: options.preserveUrls !== false,

        // Quality settings
        enableContextualHints: options.enableContextualHints !== false,
        addTransitionMarkers: options.addTransitionMarkers !== false,

        // Performance
        enableCaching: options.enableCaching !== false,
        maxCacheSize: options.maxCacheSize || 1000
      };

      // Language-specific sentence boundary patterns
      this.sentencePatterns = {
        // Western languages (period, exclamation, question)
        western: /([.!?]+)[\s\u200B]*(?=[A-ZÀ-ÿ\u0100-\u017F\u0180-\u024F]|$)/g,

        // Chinese (sentence-ending punctuation)
        chinese: /([。！？；])\s*/g,

        // Japanese (sentence-ending with various punctuation)
        japanese: /([。！？]|です|ます|だ|である)\s*/g,

        // Arabic (sentence-ending punctuation)
        arabic: /([.!?؟])\s*/g,

        // Korean (sentence-ending particles and punctuation)
        korean: /([.!?다요네요습니다])[\s]*(?=[가-힣A-Z]|$)/g,

        // Russian and Cyrillic
        cyrillic: /([.!?]+)[\s]*(?=[А-ЯЁ]|$)/g,

        // Thai (no spaces, special sentence markers)
        thai: /([\u0e01-\u0e5b]+[.!?]?)\s*/g,

        // Generic fallback
        generic: /([.!?:;]+)[\s\u200B]*(?=\p{Lu}|$)/gu
      };

      // Clause boundary patterns for sub-sentence splitting
      this.clausePatterns = {
        western: /([,;:])\s+(?=[A-ZÀ-ÿ\u0100-\u017F\u0180-\u024F])/g,
        chinese: /([，；：])\s*/g,
        japanese: /([、])\s*/g,
        arabic: /([،؛:])\s*/g,
        korean: /([，；：])\s*/g,
        generic: /([,;:])\s+(?=\p{Lu})/gu
      };

      // Special content patterns to preserve
      this.preservePatterns = {
        urls: /https?:\/\/[^\s<>"']+/gi,
        emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
        codeBlocks: /```[\s\S]*?```|`[^`]+`/gi,
        htmlTags: /<[^>]+>/gi,
        numbers: /\d+(?:[.,]\d+)*(?:\s*[%$€£¥])?/gi,
        abbreviations: /\b[A-Z]{2,}\b\.?/g,
        timeFormats: /\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/gi,
        dates: /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/gi
      };

      // Language detection patterns
      this.languagePatterns = {
        chinese: /[\u4e00-\u9fff]/,
        japanese: /[\u3040-\u309f\u30a0-\u30ff]/,
        korean: /[\uac00-\ud7af]/,
        arabic: /[\u0600-\u06ff]/,
        cyrillic: /[\u0400-\u04ff]/,
        thai: /[\u0e01-\u0e5b]/,
        western: /[a-zA-ZÀ-ÿ\u0100-\u017F\u0180-\u024F]/
      };

      // Token estimation (rough approximation)
      this.tokenMultipliers = {
        chinese: 1.5,  // Characters count as more tokens
        japanese: 1.3,
        korean: 1.2,
        arabic: 1.1,
        thai: 1.4,
        western: 0.25, // ~4 characters per token
        generic: 0.3
      };

      // Caching for performance
      this.cache = this.options.enableCaching ? new Map() : null;

      // Context hints for better translation continuity
      this.contextMarkers = {
        continuation: '◦ [CONTINUES] ◦',
        previousContext: '◦ [CONTEXT: ',
        nextHint: '◦ [NEXT: ',
        endMarker: '] ◦'
      };

      logger.debug('TextSplitter', 'Initialized with options:', this.options);
    }

    /**
     * Split text into intelligent chunks suitable for translation
     * @param {string} text - Text to split
     * @param {Object} options - Override options for this split
     * @returns {Array} Array of chunk objects with text, metadata, and context
     */
    splitText(text, options = {}) {
      if (!text || typeof text !== 'string') {
        return [];
      }

      const config = { ...this.options, ...options };
      const cacheKey = this.getCacheKey(text, config);

      // Check cache
      if (this.cache && this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      try {
        // Pre-process: extract and preserve special content
        const { processedText, preservedItems } = this.preprocessText(text);

        // Detect primary language
        const language = this.detectLanguage(processedText);

        // Estimate total tokens
        const totalTokens = this.estimateTokens(processedText, language);

        // If text fits in one chunk, return as-is
        if (totalTokens <= config.maxTokensPerChunk) {
          const result = [{
            text: this.restorePreservedContent(processedText, preservedItems),
            originalText: text,
            tokens: totalTokens,
            language: language,
            index: 0,
            total: 1,
            boundaries: ['start', 'end'],
            preservedItems: preservedItems.length,
            contextHints: []
          }];

          this.cacheResult(cacheKey, result);
          return result;
        }

        // Split into chunks at intelligent boundaries
        const chunks = this.performIntelligentSplit(processedText, language, config);

        // Restore preserved content and add context hints
        const finalChunks = this.postprocessChunks(chunks, preservedItems, text, config);

        this.cacheResult(cacheKey, finalChunks);
        return finalChunks;

      } catch (error) {
        logger.warn('TextSplitter', 'Error during splitting, falling back to simple split:', error);
        return this.fallbackSplit(text, config);
      }
    }

    /**
     * Preprocess text to extract and preserve special content
     */
    preprocessText(text) {
      const preservedItems = [];
      let processedText = text;
      let itemIndex = 0;

      // Extract and replace special patterns
      Object.entries(this.preservePatterns).forEach(([type, pattern]) => {
        processedText = processedText.replace(pattern, (match) => {
          const placeholder = `__PRESERVED_${itemIndex}__`;
          preservedItems.push({
            type,
            content: match,
            placeholder,
            index: itemIndex
          });
          itemIndex++;
          return placeholder;
        });
      });

      return { processedText, preservedItems };
    }

    /**
     * Detect the primary language of the text
     */
    detectLanguage(text) {
      if (!this.options.enableMultiLanguageDetection) {
        return this.options.defaultLanguage;
      }

      const sampleText = text.substring(0, 1000); // Sample first 1000 chars
      const scores = {};

      // Count matches for each language pattern
      Object.entries(this.languagePatterns).forEach(([lang, pattern]) => {
        const matches = sampleText.match(pattern);
        scores[lang] = matches ? matches.length : 0;
      });

      // Find language with highest score
      const detected = Object.entries(scores)
        .sort(([,a], [,b]) => b - a)[0];

      return detected && detected[1] > 0 ? detected[0] : this.options.defaultLanguage;
    }

    /**
     * Estimate token count for text in given language
     */
    estimateTokens(text, language = 'western') {
      const multiplier = this.tokenMultipliers[language] || this.tokenMultipliers.generic;

      // Basic estimation: character count * language multiplier
      let tokens = text.length * multiplier;

      // Adjust for whitespace (tokens typically don't include spaces)
      const whitespaceRatio = (text.match(/\s/g) || []).length / text.length;
      tokens = tokens * (1 - whitespaceRatio * 0.5);

      return Math.ceil(tokens);
    }

    /**
     * Perform intelligent splitting based on linguistic boundaries
     */
    performIntelligentSplit(text, language, config) {
      const chunks = [];
      const maxTokens = config.maxTokensPerChunk;
      const minTokens = config.minTokensPerChunk;

      // First attempt: split by sentences
      let sentences = this.splitBySentences(text, language);

      // If sentences are too small, try to group them
      if (sentences.length > 1) {
        sentences = this.groupSmallSentences(sentences, language, minTokens);
      }

      // Process each sentence/group
      let currentChunk = '';
      let currentTokens = 0;

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const sentenceTokens = this.estimateTokens(sentence, language);

        // If single sentence exceeds limit, split it further
        if (sentenceTokens > maxTokens) {
          // Save current chunk if it has content
          if (currentChunk.trim()) {
            chunks.push({
              text: currentChunk.trim(),
              tokens: currentTokens,
              language: language,
              boundaryType: 'sentence'
            });
            currentChunk = '';
            currentTokens = 0;
          }

          // Split oversized sentence
          const subChunks = this.splitOversizedSentence(sentence, language, maxTokens);
          chunks.push(...subChunks);
          continue;
        }

        // Check if adding this sentence would exceed limit
        if (currentTokens + sentenceTokens > maxTokens && currentChunk.trim()) {
          // Save current chunk
          chunks.push({
            text: currentChunk.trim(),
            tokens: currentTokens,
            language: language,
            boundaryType: 'sentence'
          });
          currentChunk = sentence;
          currentTokens = sentenceTokens;
        } else {
          // Add sentence to current chunk
          if (currentChunk) {
            currentChunk += this.getSentenceSeparator(language);
          }
          currentChunk += sentence;
          currentTokens += sentenceTokens;
        }
      }

      // Add final chunk
      if (currentChunk.trim()) {
        chunks.push({
          text: currentChunk.trim(),
          tokens: currentTokens,
          language: language,
          boundaryType: 'sentence'
        });
      }

      return chunks;
    }

    /**
     * Split text by sentences using language-appropriate patterns
     */
    splitBySentences(text, language) {
      const pattern = this.sentencePatterns[language] || this.sentencePatterns.generic;

      // Reset pattern to ensure clean state
      pattern.lastIndex = 0;

      const sentences = [];
      let lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const sentenceEnd = match.index + match[0].length;
        const sentence = text.substring(lastIndex, sentenceEnd).trim();

        if (sentence) {
          sentences.push(sentence);
        }

        lastIndex = sentenceEnd;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        const remaining = text.substring(lastIndex).trim();
        if (remaining) {
          sentences.push(remaining);
        }
      }

      return sentences.length > 0 ? sentences : [text];
    }

    /**
     * Group small sentences together to reach minimum token threshold
     */
    groupSmallSentences(sentences, language, minTokens) {
      const grouped = [];
      let currentGroup = '';
      let currentTokens = 0;

      for (const sentence of sentences) {
        const sentenceTokens = this.estimateTokens(sentence, language);

        if (currentTokens + sentenceTokens < minTokens || !currentGroup) {
          if (currentGroup) {
            currentGroup += this.getSentenceSeparator(language);
          }
          currentGroup += sentence;
          currentTokens += sentenceTokens;
        } else {
          grouped.push(currentGroup);
          currentGroup = sentence;
          currentTokens = sentenceTokens;
        }
      }

      if (currentGroup) {
        grouped.push(currentGroup);
      }

      return grouped;
    }

    /**
     * Split oversized sentence using clause boundaries
     */
    splitOversizedSentence(sentence, language, maxTokens) {
      const chunks = [];

      // Try splitting by clauses
      const clausePattern = this.clausePatterns[language] || this.clausePatterns.generic;
      const clauses = this.splitByClauses(sentence, clausePattern);

      if (clauses.length > 1) {
        // Group clauses that fit together
        let currentChunk = '';
        let currentTokens = 0;

        for (const clause of clauses) {
          const clauseTokens = this.estimateTokens(clause, language);

          if (currentTokens + clauseTokens > maxTokens && currentChunk) {
            chunks.push({
              text: currentChunk.trim(),
              tokens: currentTokens,
              language: language,
              boundaryType: 'clause'
            });
            currentChunk = clause;
            currentTokens = clauseTokens;
          } else {
            currentChunk += clause;
            currentTokens += clauseTokens;
          }
        }

        if (currentChunk.trim()) {
          chunks.push({
            text: currentChunk.trim(),
            tokens: currentTokens,
            language: language,
            boundaryType: 'clause'
          });
        }
      } else {
        // Last resort: split by word boundaries
        chunks.push(...this.splitByWords(sentence, language, maxTokens));
      }

      return chunks;
    }

    /**
     * Split text by clause boundaries
     */
    splitByClauses(text, pattern) {
      pattern.lastIndex = 0;
      const clauses = [];
      let lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const clauseEnd = match.index + match[0].length;
        const clause = text.substring(lastIndex, clauseEnd);

        if (clause.trim()) {
          clauses.push(clause);
        }

        lastIndex = clauseEnd;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        const remaining = text.substring(lastIndex);
        if (remaining.trim()) {
          clauses.push(remaining);
        }
      }

      return clauses.length > 0 ? clauses : [text];
    }

    /**
     * Last resort: split by word boundaries
     */
    splitByWords(text, language, maxTokens) {
      const chunks = [];
      const words = text.split(/\s+/);
      let currentChunk = '';
      let currentTokens = 0;

      for (const word of words) {
        const wordTokens = this.estimateTokens(word, language);

        if (currentTokens + wordTokens > maxTokens && currentChunk) {
          chunks.push({
            text: currentChunk.trim(),
            tokens: currentTokens,
            language: language,
            boundaryType: 'word'
          });
          currentChunk = word;
          currentTokens = wordTokens;
        } else {
          if (currentChunk) currentChunk += ' ';
          currentChunk += word;
          currentTokens += wordTokens;
        }
      }

      if (currentChunk.trim()) {
        chunks.push({
          text: currentChunk.trim(),
          tokens: currentTokens,
          language: language,
          boundaryType: 'word'
        });
      }

      return chunks;
    }

    /**
     * Get appropriate sentence separator for language
     */
    getSentenceSeparator(language) {
      switch (language) {
        case 'chinese':
        case 'japanese':
        case 'korean':
        case 'thai':
          return '';
        default:
          return ' ';
      }
    }

    /**
     * Restore preserved content and add context hints
     */
    postprocessChunks(chunks, preservedItems, originalText, config) {
      return chunks.map((chunk, index) => {
        // Restore preserved content
        let text = this.restorePreservedContent(chunk.text, preservedItems);

        // Add context hints if enabled
        const contextHints = [];
        if (config.enableContextualHints && chunks.length > 1) {
          if (index > 0) {
            const prevContext = this.extractContext(chunks[index - 1].text, 'end');
            if (prevContext) {
              contextHints.push(`Previous: "${prevContext}"`);
            }
          }

          if (index < chunks.length - 1) {
            const nextContext = this.extractContext(chunks[index + 1].text, 'start');
            if (nextContext) {
              contextHints.push(`Next: "${nextContext}"`);
            }
          }
        }

        // Add transition markers if enabled
        if (config.addTransitionMarkers && chunks.length > 1) {
          if (index > 0) {
            text = this.contextMarkers.continuation + ' ' + text;
          }
        }

        return {
          text: text,
          originalText: originalText,
          tokens: chunk.tokens,
          language: chunk.language,
          boundaryType: chunk.boundaryType,
          index: index,
          total: chunks.length,
          boundaries: this.determineBoundaries(index, chunks.length),
          preservedItems: preservedItems.filter(item =>
            chunk.text.includes(item.placeholder)
          ).length,
          contextHints: contextHints,
          estimatedQuality: this.estimateChunkQuality(chunk, index, chunks.length)
        };
      });
    }

    /**
     * Restore preserved content placeholders with original content
     */
    restorePreservedContent(text, preservedItems) {
      let restoredText = text;

      preservedItems.forEach(item => {
        restoredText = restoredText.replace(item.placeholder, item.content);
      });

      return restoredText;
    }

    /**
     * Extract context snippet for continuity hints
     */
    extractContext(text, position) {
      const maxLength = 30;

      if (position === 'start') {
        return text.substring(0, maxLength).trim();
      } else {
        const start = Math.max(0, text.length - maxLength);
        return text.substring(start).trim();
      }
    }

    /**
     * Determine chunk boundary types
     */
    determineBoundaries(index, total) {
      const boundaries = [];

      if (index === 0) boundaries.push('start');
      if (index === total - 1) boundaries.push('end');
      if (index > 0 && index < total - 1) boundaries.push('middle');

      return boundaries;
    }

    /**
     * Estimate translation quality for this chunk
     */
    estimateChunkQuality(chunk, index, total) {
      let quality = 0.8; // Base quality

      // Sentence boundaries are better than word boundaries
      if (chunk.boundaryType === 'sentence') quality += 0.15;
      else if (chunk.boundaryType === 'clause') quality += 0.1;
      else if (chunk.boundaryType === 'word') quality -= 0.1;

      // Single chunks (no splitting) are highest quality
      if (total === 1) quality = 1.0;

      // First and last chunks may have better context
      if (index === 0 || index === total - 1) quality += 0.05;

      // Clamp between 0 and 1
      return Math.max(0, Math.min(1, quality));
    }

    /**
     * Join translated chunks back together
     * @param {Array} translatedChunks - Array of translated chunk objects
     * @returns {string} Joined translation with proper spacing
     */
    joinTranslations(translatedChunks) {
      if (!Array.isArray(translatedChunks) || translatedChunks.length === 0) {
        return '';
      }

      if (translatedChunks.length === 1) {
        return this.cleanTransitionMarkers(translatedChunks[0].translatedText || translatedChunks[0]);
      }

      const language = translatedChunks[0].language || 'western';
      const separator = this.getSentenceSeparator(language);

      return translatedChunks
        .map(chunk => {
          const text = chunk.translatedText || chunk;
          return this.cleanTransitionMarkers(text);
        })
        .join(separator)
        .trim();
    }

    /**
     * Clean transition markers from translated text
     */
    cleanTransitionMarkers(text) {
      if (typeof text !== 'string') return text;

      let cleaned = text;

      // Remove transition markers
      Object.values(this.contextMarkers).forEach(marker => {
        cleaned = cleaned.replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      });

      return cleaned.trim();
    }

    /**
     * Fallback splitting when intelligent splitting fails
     */
    fallbackSplit(text, config) {
      const maxTokens = config.maxTokensPerChunk;
      const chunks = [];

      // Simple character-based splitting
      const charsPerToken = 4; // Rough estimate
      const maxChars = maxTokens * charsPerToken;

      for (let i = 0; i < text.length; i += maxChars) {
        const chunk = text.substring(i, i + maxChars);
        chunks.push({
          text: chunk,
          originalText: text,
          tokens: this.estimateTokens(chunk, 'western'),
          language: 'western',
          boundaryType: 'character',
          index: chunks.length,
          total: Math.ceil(text.length / maxChars),
          boundaries: [],
          preservedItems: 0,
          contextHints: [],
          estimatedQuality: 0.3 // Low quality for character splits
        });
      }

      return chunks;
    }

    /**
     * Generate cache key for memoization
     */
    getCacheKey(text, config) {
      const textHash = this.simpleHash(text);
      const configKey = `${config.maxTokensPerChunk}-${config.defaultLanguage}-${config.preferSentenceBoundaries}`;
      return `${textHash}-${configKey}`;
    }

    /**
     * Simple hash function for caching
     */
    simpleHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash.toString(36);
    }

    /**
     * Cache result with LRU eviction
     */
    cacheResult(key, result) {
      if (!this.cache) return;

      // Simple LRU: remove oldest if at capacity
      if (this.cache.size >= this.options.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      this.cache.set(key, result);
    }

    /**
     * Get performance stats
     */
    getStats() {
      return {
        cacheSize: this.cache ? this.cache.size : 0,
        supportedLanguages: Object.keys(this.languagePatterns),
        preservePatterns: Object.keys(this.preservePatterns),
        options: { ...this.options }
      };
    }

    /**
     * Clear cache
     */
    clearCache() {
      if (this.cache) {
        this.cache.clear();
      }
    }

    /**
     * Reset to default options
     */
    reset() {
      this.clearCache();
      logger.debug('TextSplitter', 'Reset completed');
    }
  }

  // Export for different environments
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = IntelligentTextSplitter;
  } else if (typeof global !== 'undefined') {
    // Browser global
    global.IntelligentTextSplitter = IntelligentTextSplitter;
  } else if (typeof window !== 'undefined') {
    // Browser window
    window.IntelligentTextSplitter = IntelligentTextSplitter;
  }

})(typeof globalThis !== 'undefined' ? globalThis :
   typeof window !== 'undefined' ? window :
   typeof global !== 'undefined' ? global : this);