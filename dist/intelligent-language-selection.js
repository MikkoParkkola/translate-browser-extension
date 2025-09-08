/**
 * @fileoverview Intelligent Language Selection with smart suggestions
 * Analyzes page content, user history, and context to suggest optimal language pairs
 */

const IntelligentLanguageSelection = {
  // Cache for analysis results
  analysisCache: new Map(),
  
  // User history tracking
  languagePairHistory: [],
  recentTranslations: [],
  
  // Time-based context
  timeBasedSuggestions: {
    work: ['en', 'es', 'fr', 'de'], // Common business languages
    personal: ['zh', 'ja', 'ko', 'ar'], // More diverse languages
    mixed: ['en', 'es', 'zh', 'fr'] // Balanced mix
  },

  // --------------------------------------------------------------------------
  // Initialization and Setup
  // --------------------------------------------------------------------------
  
  async init() {
    await this.loadUserHistory();
    this.setupLanguageDetection();
    this.setupSmartSuggestions();
  },

  async loadUserHistory() {
    try {
      const data = await chrome.storage.local.get({
        languagePairHistory: [],
        recentTranslations: [],
        usagePattern: 'mixed'
      });
      
      this.languagePairHistory = data.languagePairHistory || [];
      this.recentTranslations = data.recentTranslations || [];
      this.usagePattern = data.usagePattern || 'mixed';
    } catch (error) {
      console.warn('Failed to load language selection history:', error);
    }
  },

  async saveUserHistory() {
    try {
      await chrome.storage.local.set({
        languagePairHistory: this.languagePairHistory.slice(-50), // Keep last 50
        recentTranslations: this.recentTranslations.slice(-100) // Keep last 100
      });
    } catch (error) {
      console.warn('Failed to save language selection history:', error);
    }
  },

  // --------------------------------------------------------------------------
  // Page Content Analysis
  // --------------------------------------------------------------------------
  
  async analyzeCurrentPage() {
    const url = window.location.href;
    
    // Check cache first
    if (this.analysisCache.has(url)) {
      return this.analysisCache.get(url);
    }

    const analysis = {
      detectedLanguage: await this.detectPageLanguage(),
      confidence: 0.5,
      domain: window.location.hostname,
      textSample: this.getPageTextSample(),
      suggestedPairs: []
    };

    // Enhance analysis
    analysis.confidence = await this.calculateConfidence(analysis);
    analysis.suggestedPairs = this.generateSmartSuggestions(analysis);
    
    // Cache result for 5 minutes
    this.analysisCache.set(url, analysis);
    setTimeout(() => this.analysisCache.delete(url), 5 * 60 * 1000);
    
    return analysis;
  },

  async detectPageLanguage() {
    // Try multiple detection methods
    const methods = [
      () => document.documentElement.lang,
      () => document.querySelector('meta[http-equiv="content-language"]')?.content,
      () => this.detectFromContent(),
      () => navigator.language.split('-')[0]
    ];

    for (const method of methods) {
      try {
        const result = method();
        if (result && this.isValidLanguageCode(result)) {
          return result;
        }
      } catch (error) {
        // Continue to next method
      }
    }

    return 'auto'; // Fallback
  },

  detectFromContent() {
    const textSample = this.getPageTextSample();
    return this.detectLanguageFromText(textSample);
  },

  detectLanguageFromText(text) {
    if (!text || text.length < 10) return null;

    // Simple heuristic-based detection for common languages
    const patterns = {
      'zh': /[\u4e00-\u9fff]/,
      'ja': /[\u3040-\u309f\u30a0-\u30ff]/,
      'ko': /[\uac00-\ud7af]/,
      'ar': /[\u0600-\u06ff]/,
      'ru': /[\u0400-\u04ff]/,
      'th': /[\u0e00-\u0e7f]/,
      'hi': /[\u0900-\u097f]/
    };

    for (const [lang, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        return lang;
      }
    }

    // For Latin scripts, use more sophisticated detection
    return this.detectLatinLanguage(text);
  },

  detectLatinLanguage(text) {
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    if (words.length < 5) return null;

    // Common words for different languages
    const commonWords = {
      'en': ['the', 'and', 'of', 'to', 'a', 'in', 'is', 'it', 'you', 'that'],
      'es': ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no'],
      'fr': ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir'],
      'de': ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich'],
      'it': ['il', 'di', 'che', 'e', 'la', 'per', 'una', 'in', 'con', 'del'],
      'pt': ['o', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'é']
    };

    let bestMatch = { lang: null, score: 0 };

    for (const [lang, commonList] of Object.entries(commonWords)) {
      let matches = 0;
      for (const word of commonList) {
        if (words.includes(word)) matches++;
      }
      
      const score = matches / commonList.length;
      if (score > bestMatch.score && score > 0.2) {
        bestMatch = { lang, score };
      }
    }

    return bestMatch.lang;
  },

  getPageTextSample() {
    // Get visible text from key elements
    const selectors = [
      'h1', 'h2', 'h3', 
      'p', 
      '[role="main"]',
      'article',
      '.content',
      '#content'
    ];

    let text = '';
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (this.isElementVisible(el)) {
          text += el.textContent.trim() + ' ';
          if (text.length > 500) break; // Enough sample
        }
      }
      if (text.length > 500) break;
    }

    return text.substring(0, 1000); // Max 1000 chars
  },

  isElementVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    return rect.width > 0 &&
           rect.height > 0 &&
           style.visibility !== 'hidden' &&
           style.display !== 'none' &&
           style.opacity !== '0';
  },

  async calculateConfidence(analysis) {
    let confidence = 0.5; // Base confidence

    // Increase confidence based on detection methods
    if (analysis.detectedLanguage !== 'auto') {
      confidence += 0.2;
    }

    if (document.documentElement.lang) {
      confidence += 0.2;
    }

    if (analysis.textSample && analysis.textSample.length > 100) {
      confidence += 0.1;
    }

    // Domain-based confidence boost
    if (this.isKnownDomain(analysis.domain)) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95); // Cap at 95%
  },

  isKnownDomain(domain) {
    // Common domains with known languages
    const knownDomains = [
      'google.com', 'wikipedia.org', 'github.com', 
      'stackoverflow.com', 'reddit.com', 'twitter.com'
    ];
    
    return knownDomains.some(known => domain.includes(known));
  },

  isValidLanguageCode(code) {
    const validCodes = [
      'auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'zh-TW',
      'ja', 'ko', 'ar', 'hi', 'th', 'vi', 'nl', 'sv', 'da', 'no'
    ];
    return validCodes.includes(code);
  },

  // --------------------------------------------------------------------------
  // Smart Suggestions Generation
  // --------------------------------------------------------------------------
  
  generateSmartSuggestions(analysis) {
    const suggestions = [];
    const currentHour = new Date().getHours();
    
    // 1. Based on detected page language
    if (analysis.detectedLanguage && analysis.detectedLanguage !== 'auto') {
      suggestions.push({
        from: analysis.detectedLanguage,
        to: this.getBestTargetLanguage(analysis.detectedLanguage),
        reason: 'Page content detected',
        confidence: analysis.confidence,
        priority: 1
      });
    }

    // 2. Based on user history
    const frequentPairs = this.getFrequentLanguagePairs();
    frequentPairs.forEach((pair, index) => {
      if (index < 3) { // Top 3 frequent pairs
        suggestions.push({
          from: pair.from,
          to: pair.to,
          reason: `Used ${pair.count} times`,
          confidence: 0.8,
          priority: 2
        });
      }
    });

    // 3. Time-based suggestions
    const isWorkHours = currentHour >= 9 && currentHour <= 17;
    const timeContext = isWorkHours ? 'work' : 'personal';
    const timeSuggestions = this.timeBasedSuggestions[timeContext] || this.timeBasedSuggestions.mixed;
    
    timeSuggestions.forEach(lang => {
      suggestions.push({
        from: 'auto',
        to: lang,
        reason: `Popular for ${timeContext} hours`,
        confidence: 0.6,
        priority: 3
      });
    });

    // 4. Browser language based
    const browserLang = navigator.language.split('-')[0];
    if (browserLang && browserLang !== 'en') {
      suggestions.push({
        from: 'auto',
        to: browserLang,
        reason: 'Browser language',
        confidence: 0.7,
        priority: 2
      });
    }

    // Sort by priority and confidence
    return suggestions
      .sort((a, b) => (a.priority - b.priority) || (b.confidence - a.confidence))
      .slice(0, 5); // Top 5 suggestions
  },

  getBestTargetLanguage(sourceLanguage) {
    // Smart target language selection based on source
    const preferences = {
      'en': 'es', // English -> Spanish (most common translation)
      'zh': 'en', // Chinese -> English
      'ja': 'en', // Japanese -> English
      'ko': 'en', // Korean -> English
      'ar': 'en', // Arabic -> English
      'es': 'en', // Spanish -> English
      'fr': 'en', // French -> English
      'de': 'en', // German -> English
      'it': 'en', // Italian -> English
      'pt': 'en', // Portuguese -> English
      'ru': 'en'  // Russian -> English
    };

    // Check user's most used target language for this source
    const userPreference = this.getUserPreferredTarget(sourceLanguage);
    if (userPreference) {
      return userPreference;
    }

    return preferences[sourceLanguage] || 'en';
  },

  getUserPreferredTarget(sourceLanguage) {
    const pairs = this.languagePairHistory.filter(p => p.from === sourceLanguage);
    if (pairs.length === 0) return null;

    // Count frequency of target languages
    const targetCounts = {};
    pairs.forEach(p => {
      targetCounts[p.to] = (targetCounts[p.to] || 0) + 1;
    });

    // Return most frequent target
    return Object.keys(targetCounts)
      .sort((a, b) => targetCounts[b] - targetCounts[a])[0];
  },

  getFrequentLanguagePairs() {
    const pairCounts = {};
    
    this.languagePairHistory.forEach(pair => {
      const key = `${pair.from}:${pair.to}`;
      pairCounts[key] = (pairCounts[key] || 0) + 1;
    });

    return Object.entries(pairCounts)
      .map(([key, count]) => {
        const [from, to] = key.split(':');
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count);
  },

  // --------------------------------------------------------------------------
  // User Interface Integration
  // --------------------------------------------------------------------------
  
  async enhanceLanguageSelectors() {
    const sourceSelect = document.getElementById('source-language');
    const targetSelect = document.getElementById('target-language');
    const confidenceIndicator = document.getElementById('source-confidence');
    
    if (!sourceSelect || !targetSelect) return;

    // Analyze current page
    const analysis = await this.analyzeCurrentPage();
    
    // Update confidence indicator
    if (confidenceIndicator) {
      this.updateConfidenceIndicator(confidenceIndicator, analysis);
    }

    // Add smart suggestions
    this.addSmartSuggestions(sourceSelect, targetSelect, analysis);
    
    // Add swap functionality
    this.setupLanguageSwap();
    
    // Add recent pairs quick access
    this.addRecentPairs(sourceSelect, targetSelect);
  },

  updateConfidenceIndicator(indicator, analysis) {
    const confidence = Math.round(analysis.confidence * 100);
    const confidenceValue = indicator.querySelector('.confidence-value');
    const confidenceFill = indicator.querySelector('.confidence-fill');
    
    if (confidenceValue) {
      confidenceValue.textContent = `${confidence}%`;
    }
    
    if (confidenceFill) {
      confidenceFill.style.width = `${confidence}%`;
      
      // Color coding based on confidence
      if (confidence >= 80) {
        confidenceFill.style.background = 'var(--color-green-500)';
      } else if (confidence >= 60) {
        confidenceFill.style.background = 'var(--color-yellow-500)';
      } else {
        confidenceFill.style.background = 'var(--color-red-500)';
      }
    }

    // Show/hide based on detection
    if (analysis.detectedLanguage === 'auto') {
      indicator.style.display = 'none';
    } else {
      indicator.style.display = 'block';
    }
  },

  addSmartSuggestions(sourceSelect, targetSelect, analysis) {
    // Create suggestions container if it doesn't exist
    let suggestionsContainer = document.querySelector('.language-suggestions');
    if (!suggestionsContainer) {
      suggestionsContainer = document.createElement('div');
      suggestionsContainer.className = 'language-suggestions';
      sourceSelect.parentNode.insertBefore(suggestionsContainer, sourceSelect.nextSibling);
    }

    // Clear existing suggestions
    suggestionsContainer.innerHTML = '';

    // Add suggestions
    if (analysis.suggestedPairs.length > 0) {
      const title = document.createElement('div');
      title.className = 'suggestions-title';
      title.textContent = '💡 Smart Suggestions';
      suggestionsContainer.appendChild(title);

      const suggestionsList = document.createElement('div');
      suggestionsList.className = 'suggestions-list';

      analysis.suggestedPairs.slice(0, 3).forEach((suggestion, index) => {
        const item = document.createElement('button');
        item.className = 'suggestion-item';
        item.innerHTML = `
          <div class="suggestion-pair">
            <span class="from-lang">${this.getLanguageName(suggestion.from)}</span>
            <svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2"/>
            </svg>
            <span class="to-lang">${this.getLanguageName(suggestion.to)}</span>
          </div>
          <div class="suggestion-reason">${suggestion.reason}</div>
        `;
        
        item.addEventListener('click', () => {
          sourceSelect.value = suggestion.from;
          targetSelect.value = suggestion.to;
          
          // Trigger change events
          sourceSelect.dispatchEvent(new Event('change'));
          targetSelect.dispatchEvent(new Event('change'));
          
          // Add to history
          this.recordLanguagePair(suggestion.from, suggestion.to);
        });

        suggestionsList.appendChild(item);
      });

      suggestionsContainer.appendChild(suggestionsList);
    }
  },

  setupLanguageSwap() {
    const swapButton = document.getElementById('swap-languages');
    if (!swapButton) return;

    swapButton.addEventListener('click', () => {
      const sourceSelect = document.getElementById('source-language');
      const targetSelect = document.getElementById('target-language');
      
      if (sourceSelect && targetSelect) {
        const sourceValue = sourceSelect.value;
        const targetValue = targetSelect.value;
        
        // Don't swap if source is 'auto'
        if (sourceValue === 'auto') {
          // Just record the current pair
          this.recordLanguagePair(sourceValue, targetValue);
          return;
        }
        
        // Perform swap with animation
        this.animateSwap(swapButton, () => {
          sourceSelect.value = targetValue;
          targetSelect.value = sourceValue;
          
          // Trigger change events
          sourceSelect.dispatchEvent(new Event('change'));
          targetSelect.dispatchEvent(new Event('change'));
          
          // Record the new pair
          this.recordLanguagePair(targetValue, sourceValue);
        });
      }
    });
  },

  animateSwap(button, callback) {
    button.classList.add('swapping');
    setTimeout(() => {
      callback();
      button.classList.remove('swapping');
    }, 200);
  },

  addRecentPairs(sourceSelect, targetSelect) {
    const recentPairs = this.getRecentUniquePairs();
    if (recentPairs.length === 0) return;

    // Create recent pairs container
    let recentContainer = document.querySelector('.recent-pairs');
    if (!recentContainer) {
      recentContainer = document.createElement('div');
      recentContainer.className = 'recent-pairs';
      
      const suggestionsContainer = document.querySelector('.language-suggestions');
      if (suggestionsContainer) {
        suggestionsContainer.parentNode.insertBefore(recentContainer, suggestionsContainer.nextSibling);
      } else {
        targetSelect.parentNode.insertBefore(recentContainer, targetSelect.nextSibling);
      }
    }

    recentContainer.innerHTML = `
      <div class="recent-title">🕐 Recent Pairs</div>
      <div class="recent-list">
        ${recentPairs.slice(0, 3).map(pair => `
          <button class="recent-item" data-from="${pair.from}" data-to="${pair.to}">
            <span class="recent-pair">${this.getLanguageName(pair.from)} → ${this.getLanguageName(pair.to)}</span>
            <span class="recent-time">${this.formatRelativeTime(pair.timestamp)}</span>
          </button>
        `).join('')}
      </div>
    `;

    // Add click handlers
    recentContainer.querySelectorAll('.recent-item').forEach(item => {
      item.addEventListener('click', () => {
        const from = item.dataset.from;
        const to = item.dataset.to;
        
        sourceSelect.value = from;
        targetSelect.value = to;
        
        // Trigger change events
        sourceSelect.dispatchEvent(new Event('change'));
        targetSelect.dispatchEvent(new Event('change'));
        
        // Move to top of recent list
        this.recordLanguagePair(from, to);
      });
    });
  },

  getRecentUniquePairs() {
    const seen = new Set();
    const uniquePairs = [];
    
    // Go through recent history in reverse (newest first)
    for (let i = this.languagePairHistory.length - 1; i >= 0; i--) {
      const pair = this.languagePairHistory[i];
      const key = `${pair.from}:${pair.to}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        uniquePairs.push(pair);
        
        if (uniquePairs.length >= 5) break; // Max 5 recent unique pairs
      }
    }
    
    return uniquePairs;
  },

  getLanguageName(code) {
    const languageNames = {
      'auto': 'Auto',
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'zh': 'Chinese',
      'zh-TW': 'Chinese (TW)',
      'ja': 'Japanese',
      'ko': 'Korean',
      'ar': 'Arabic',
      'hi': 'Hindi'
    };
    
    return languageNames[code] || code.toUpperCase();
  },

  formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60 * 1000) return 'Just now';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
    return `${Math.floor(diff / (24 * 60 * 60 * 1000))}d ago`;
  },

  // --------------------------------------------------------------------------
  // History Management
  // --------------------------------------------------------------------------
  
  recordLanguagePair(from, to, context = {}) {
    const pair = {
      from,
      to,
      timestamp: Date.now(),
      domain: window.location.hostname,
      ...context
    };
    
    this.languagePairHistory.push(pair);
    
    // Keep only last 50 pairs
    if (this.languagePairHistory.length > 50) {
      this.languagePairHistory.shift();
    }
    
    this.saveUserHistory();
  },

  recordTranslation(originalText, translatedText, from, to) {
    const translation = {
      original: originalText.substring(0, 100), // First 100 chars
      translated: translatedText.substring(0, 100),
      from,
      to,
      timestamp: Date.now(),
      domain: window.location.hostname
    };
    
    this.recentTranslations.push(translation);
    
    // Keep only last 100 translations
    if (this.recentTranslations.length > 100) {
      this.recentTranslations.shift();
    }
    
    this.saveUserHistory();
  },

  // --------------------------------------------------------------------------
  // Setup and Event Binding
  // --------------------------------------------------------------------------
  
  setupLanguageDetection() {
    // Watch for page changes
    if (window.MutationObserver) {
      const observer = new MutationObserver(() => {
        // Clear cache when page content changes significantly
        this.analysisCache.clear();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  },

  setupSmartSuggestions() {
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.enhanceLanguageSelectors();
      });
    } else {
      this.enhanceLanguageSelectors();
    }
  }
};

// Initialize when the script loads
if (typeof window !== 'undefined') {
  window.IntelligentLanguageSelection = IntelligentLanguageSelection;
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      IntelligentLanguageSelection.init();
    });
  } else {
    IntelligentLanguageSelection.init();
  }
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = IntelligentLanguageSelection;
}