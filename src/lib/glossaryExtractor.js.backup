/**
 * Smart Glossary/Terminology Extraction System
 *
 * Intelligent terminology detection and management for consistent translation of:
 * - Technical terms and jargon
 * - Brand names and proper nouns
 * - Domain-specific vocabulary
 * - Acronyms and abbreviations
 * - Cultural and contextual terms
 *
 * Features:
 * - Automatic term detection using linguistic patterns
 * - User-defined glossary management
 * - Context-aware term suggestion
 * - Multi-language terminology mapping
 * - Frequency-based importance scoring
 * - Export/import functionality for glossaries
 */

(function() {
  'use strict';

  /**
   * Smart Glossary and Terminology Extractor
   */
  class GlossaryExtractor {
    constructor(options = {}) {
      this.options = {
        // Detection settings
        minTermLength: options.minTermLength || 3,
        maxTermLength: options.maxTermLength || 50,
        minFrequency: options.minFrequency || 2,
        caseSensitive: options.caseSensitive || false,

        // Feature toggles
        enableAutomaticDetection: options.enableAutomaticDetection !== false,
        enableProperNounDetection: options.enableProperNounDetection !== false,
        enableTechnicalTermDetection: options.enableTechnicalTermDetection !== false,
        enableAcronymDetection: options.enableAcronymDetection !== false,
        enablePhraseDetection: options.enablePhraseDetection !== false,

        // Language settings
        sourceLanguage: options.sourceLanguage || 'auto',
        targetLanguage: options.targetLanguage || 'en',

        // Storage settings
        maxCacheSize: options.maxCacheSize || 1000,
        persistentStorage: options.persistentStorage !== false,

        // Scoring weights
        frequencyWeight: options.frequencyWeight || 0.4,
        contextWeight: options.contextWeight || 0.3,
        lengthWeight: options.lengthWeight || 0.2,
        typeWeight: options.typeWeight || 0.1
      };

      // Initialize data structures
      this.userGlossary = new Map(); // User-defined terms
      this.detectedTerms = new Map(); // Automatically detected terms
      this.termFrequency = new Map(); // Term frequency counts
      this.contextPatterns = new Map(); // Contextual usage patterns
      this.termTranslations = new Map(); // Term translation mappings
      this.domainCategories = new Map(); // Domain classification

      // Detection patterns
      this.patterns = {
        // Technical terms
        technical: {
          // Programming/IT terms
          programming: /(?:API|SDK|JSON|XML|HTTP|HTTPS|REST|SOAP|SQL|NoSQL|CSS|HTML|JavaScript|TypeScript|Python|Java|React|Vue|Angular|Node\.js|Docker|Kubernetes|CI\/CD|DevOps|Git|GitHub|OAuth|JWT|SSL|TLS|UI\/UX|SaaS|PaaS|IaaS|CRM|ERP|IDE|CLI|GUI|OOP|CRUD|MVC|MVP|MVVM)/gi,

          // Medical/Scientific terms
          medical: /(?:[A-Z][a-z]+-[a-z]+(?:itis|osis|emia|pathy|therapy|scopy|gram|metry)|(?:cardio|neuro|gastro|hepato|nephro|pulmo|dermato|ophthalmol|ortho|gyneco|pediatr|geriatr|psycho|radio|onco|hemato)[a-z]+)/gi,

          // Financial terms
          financial: /(?:ROI|KPI|EBITDA|CAPEX|OPEX|P&L|B2B|B2C|IPO|M&A|VC|PE|FDI|GDP|CPI|YoY|QoQ|MoM|CAGR|LTV|CAC|ARR|MRR|SaaS|ARPU|CLV)/gi,

          // Legal terms
          legal: /(?:NDA|SLA|ToS|GDPR|CCPA|HIPAA|SOX|PCI|DSS|IP|IP|LLC|Inc|Corp|Ltd|PLC|GmbH|AG|SA|BV|AB|Pty|EULA|USPTO|WIPO)/gi
        },

        // Proper nouns
        properNouns: {
          // Company/Brand names
          companies: /(?:Google|Microsoft|Apple|Amazon|Facebook|Meta|Twitter|LinkedIn|Instagram|YouTube|Netflix|Spotify|Uber|Lyft|Airbnb|PayPal|Stripe|Slack|Zoom|Salesforce|Oracle|IBM|Intel|AMD|NVIDIA|Tesla|SpaceX|OpenAI|Anthropic)/gi,

          // Geographic locations
          locations: /(?:[A-Z][a-z]+ (?:City|State|Province|Country|Region|County|District|Territory|Republic|Kingdom|Federation|Union|Emirates))/gi,

          // Product names
          products: /(?:iPhone|iPad|MacBook|Windows|Linux|Android|Chrome|Firefox|Safari|Edge|Photoshop|Illustrator|Office|Word|Excel|PowerPoint|Outlook|Teams|Skype|WhatsApp|Telegram)/gi
        },

        // Acronyms and abbreviations
        acronyms: {
          // Common acronyms
          common: /\b[A-Z]{2,}(?:\.[A-Z]{1,3})*\b/g,

          // Mixed case acronyms
          mixed: /\b[A-Z][a-z]*[A-Z][A-Za-z]*\b/g,

          // Dotted abbreviations
          dotted: /\b[A-Z](?:\.[A-Z])+\.?\b/g
        },

        // Multi-word phrases
        phrases: {
          // Technical phrases
          technical: /(?:machine learning|artificial intelligence|data science|cloud computing|software engineering|web development|mobile development|user experience|user interface|database management|network security|cyber security|information technology|digital transformation|business intelligence|content management|project management|quality assurance|version control|continuous integration|continuous deployment)/gi,

          // Business phrases
          business: /(?:customer relationship management|enterprise resource planning|supply chain management|human resources|return on investment|key performance indicator|customer acquisition cost|lifetime value|market research|competitive analysis|business development|strategic planning|change management|risk management|compliance management)/gi
        },

        // Domain-specific patterns
        domains: {
          // Medical abbreviations
          medical: /\b(?:mg|ml|kg|lb|oz|cc|IU|BID|TID|QID|PRN|AC|PC|HS|NPO|DNR|ICU|ER|OR|PACU|NICU|PICU|CCU|CVA|MI|CHF|COPD|DM|HTN|CAD|PVD|DVT|PE|UTI|URI|STD|HIV|AIDS|TB|MRSA|VRE|C\.diff)/gi,

          // Legal abbreviations
          legal: /\b(?:LLC|Inc|Corp|Ltd|PLC|LLP|LP|PC|PA|PLLC|vs|v\.|et al|etc|i\.e|e\.g|cf|ibid|supra|infra|inter alia|per se|de facto|de jure|ad hoc|pro bono|amicus curiae)/gi,

          // Academic abbreviations
          academic: /\b(?:PhD|MD|JD|MBA|MA|MS|BS|BA|MSc|BSc|DPhil|EdD|PsyD|Prof|Dr|Mr|Mrs|Ms|Sr|Jr|II|III|IV|et al|pp|vol|no|ed|eds|rev|trans|ISBN|ISSN|DOI|URL|URI)/gi
        }
      };

      // Context indicators for better term classification
      this.contextIndicators = {
        technical: ['software', 'system', 'platform', 'application', 'tool', 'framework', 'library', 'protocol', 'standard', 'specification'],
        business: ['company', 'organization', 'enterprise', 'corporation', 'firm', 'business', 'industry', 'market', 'sector', 'vertical'],
        medical: ['patient', 'treatment', 'diagnosis', 'therapy', 'clinical', 'medical', 'health', 'disease', 'condition', 'symptom'],
        legal: ['law', 'legal', 'court', 'judge', 'attorney', 'lawyer', 'contract', 'agreement', 'clause', 'litigation'],
        academic: ['research', 'study', 'paper', 'journal', 'conference', 'university', 'college', 'academic', 'scholar', 'publication']
      };

      // Initialize storage
      this.initializeStorage();

      console.log('[GlossaryExtractor] Initialized with options:', this.options);
    }

    /**
     * Initialize storage for persistent glossary data
     */
    async initializeStorage() {
      if (this.options.persistentStorage && typeof chrome !== 'undefined' && chrome.storage) {
        try {
          const data = await chrome.storage.local.get(['glossaryTerms', 'termTranslations', 'domainCategories']);

          if (data.glossaryTerms) {
            this.userGlossary = new Map(Object.entries(data.glossaryTerms));
          }

          if (data.termTranslations) {
            this.termTranslations = new Map(Object.entries(data.termTranslations));
          }

          if (data.domainCategories) {
            this.domainCategories = new Map(Object.entries(data.domainCategories));
          }

          console.log('[GlossaryExtractor] Loaded persistent data:', {
            userTerms: this.userGlossary.size,
            translations: this.termTranslations.size,
            categories: this.domainCategories.size
          });
        } catch (error) {
          console.warn('[GlossaryExtractor] Failed to load persistent data:', error);
        }
      }
    }

    /**
     * Save data to persistent storage
     */
    async saveToStorage() {
      if (this.options.persistentStorage && typeof chrome !== 'undefined' && chrome.storage) {
        try {
          await chrome.storage.local.set({
            glossaryTerms: Object.fromEntries(this.userGlossary),
            termTranslations: Object.fromEntries(this.termTranslations),
            domainCategories: Object.fromEntries(this.domainCategories)
          });

          console.log('[GlossaryExtractor] Saved persistent data');
        } catch (error) {
          console.warn('[GlossaryExtractor] Failed to save persistent data:', error);
        }
      }
    }

    /**
     * Extract terminology from text
     */
    extractTerms(text, context = {}) {
      if (!text || typeof text !== 'string') {
        return { terms: [], patterns: {}, summary: {} };
      }

      const results = {
        terms: [],
        patterns: {},
        summary: {
          totalTerms: 0,
          uniqueTerms: 0,
          domains: [],
          confidence: 0
        }
      };

      try {
        // Update term frequencies
        this.updateTermFrequencies(text);

        // Detect different types of terms
        if (this.options.enableAutomaticDetection) {
          // Technical terms
          if (this.options.enableTechnicalTermDetection) {
            results.patterns.technical = this.detectTechnicalTerms(text);
          }

          // Proper nouns
          if (this.options.enableProperNounDetection) {
            results.patterns.properNouns = this.detectProperNouns(text);
          }

          // Acronyms
          if (this.options.enableAcronymDetection) {
            results.patterns.acronyms = this.detectAcronyms(text);
          }

          // Phrases
          if (this.options.enablePhraseDetection) {
            results.patterns.phrases = this.detectPhrases(text);
          }
        }

        // Combine all detected terms
        const allTerms = [];
        Object.values(results.patterns).forEach(patternResults => {
          if (Array.isArray(patternResults)) {
            allTerms.push(...patternResults);
          } else if (patternResults && typeof patternResults === 'object') {
            Object.values(patternResults).forEach(terms => {
              if (Array.isArray(terms)) {
                allTerms.push(...terms);
              }
            });
          }
        });

        // Process and score terms
        results.terms = this.processAndScoreTerms(allTerms, text, context);

        // Generate summary
        results.summary = this.generateSummary(results.terms, text);

        // Update detected terms cache
        results.terms.forEach(term => {
          this.detectedTerms.set(term.term, term);
        });

        console.log('[GlossaryExtractor] Extracted terms:', {
          total: results.terms.length,
          unique: results.summary.uniqueTerms,
          domains: results.summary.domains
        });

        return results;

      } catch (error) {
        console.error('[GlossaryExtractor] Error during term extraction:', error);
        return results;
      }
    }

    /**
     * Update term frequency tracking
     */
    updateTermFrequencies(text) {
      // Simple word frequency counting
      const words = text.toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length >= this.options.minTermLength);

      words.forEach(word => {
        const count = this.termFrequency.get(word) || 0;
        this.termFrequency.set(word, count + 1);
      });
    }

    /**
     * Detect technical terms
     */
    detectTechnicalTerms(text) {
      const results = {};

      Object.keys(this.patterns.technical).forEach(category => {
        const pattern = this.patterns.technical[category];
        const matches = [...text.matchAll(pattern)];

        results[category] = matches.map(match => ({
          term: match[0],
          position: match.index,
          type: 'technical',
          category: category,
          confidence: 0.8
        }));
      });

      return results;
    }

    /**
     * Detect proper nouns
     */
    detectProperNouns(text) {
      const results = {};

      Object.keys(this.patterns.properNouns).forEach(category => {
        const pattern = this.patterns.properNouns[category];
        const matches = [...text.matchAll(pattern)];

        results[category] = matches.map(match => ({
          term: match[0],
          position: match.index,
          type: 'properNoun',
          category: category,
          confidence: 0.9
        }));
      });

      // Additional proper noun detection using capitalization patterns
      const capitalizationPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
      const capitalizedMatches = [...text.matchAll(capitalizationPattern)];

      results.capitalized = capitalizedMatches
        .filter(match => {
          const term = match[0];
          // Filter out common words and sentence beginnings
          return term.length > 3 &&
                 !this.isCommonWord(term) &&
                 !this.isSentenceBeginning(text, match.index);
        })
        .map(match => ({
          term: match[0],
          position: match.index,
          type: 'properNoun',
          category: 'capitalized',
          confidence: 0.6
        }));

      return results;
    }

    /**
     * Detect acronyms and abbreviations
     */
    detectAcronyms(text) {
      const results = {};

      Object.keys(this.patterns.acronyms).forEach(category => {
        const pattern = this.patterns.acronyms[category];
        const matches = [...text.matchAll(pattern)];

        results[category] = matches
          .filter(match => {
            const term = match[0];
            return term.length >= 2 &&
                   term.length <= 10 &&
                   !this.isCommonAbbreviation(term);
          })
          .map(match => ({
            term: match[0],
            position: match.index,
            type: 'acronym',
            category: category,
            confidence: 0.7
          }));
      });

      return results;
    }

    /**
     * Detect multi-word phrases
     */
    detectPhrases(text) {
      const results = {};

      Object.keys(this.patterns.phrases).forEach(category => {
        const pattern = this.patterns.phrases[category];
        const matches = [...text.matchAll(pattern)];

        results[category] = matches.map(match => ({
          term: match[0],
          position: match.index,
          type: 'phrase',
          category: category,
          confidence: 0.85
        }));
      });

      return results;
    }

    /**
     * Process and score detected terms
     */
    processAndScoreTerms(terms, text, context) {
      const uniqueTerms = new Map();

      // Deduplicate and aggregate terms
      terms.forEach(termData => {
        const key = this.options.caseSensitive ? termData.term : termData.term.toLowerCase();

        if (!uniqueTerms.has(key)) {
          uniqueTerms.set(key, {
            ...termData,
            frequency: 0,
            positions: [],
            contexts: []
          });
        }

        const existing = uniqueTerms.get(key);
        existing.frequency++;
        existing.positions.push(termData.position);

        // Add context information
        const termContext = this.extractTermContext(text, termData.position, termData.term.length);
        existing.contexts.push(termContext);
      });

      // Score and filter terms
      const scoredTerms = Array.from(uniqueTerms.values())
        .filter(term => {
          // Filter by frequency threshold
          return term.frequency >= this.options.minFrequency;
        })
        .map(term => {
          // Calculate composite score
          term.score = this.calculateTermScore(term, text, context);

          // Determine domain classification
          term.domain = this.classifyTermDomain(term);

          // Get suggested translation if available
          term.suggestedTranslation = this.getSuggestedTranslation(term.term);

          return term;
        })
        .sort((a, b) => b.score - a.score) // Sort by score descending
        .slice(0, this.options.maxCacheSize); // Limit results

      return scoredTerms;
    }

    /**
     * Calculate term importance score
     */
    calculateTermScore(term, text, context) {
      // Frequency score (0-1)
      const maxFreq = Math.max(...Array.from(this.termFrequency.values()));
      const frequencyScore = maxFreq > 0 ? term.frequency / maxFreq : 0;

      // Context score (0-1)
      const contextScore = this.calculateContextScore(term, context);

      // Length score (0-1) - favor medium-length terms
      const optimalLength = 8;
      const lengthScore = 1 - Math.abs(term.term.length - optimalLength) / optimalLength;

      // Type score (0-1) - weight different term types
      const typeScores = {
        technical: 0.9,
        properNoun: 0.8,
        phrase: 0.85,
        acronym: 0.7
      };
      const typeScore = typeScores[term.type] || 0.5;

      // Weighted composite score
      return (
        frequencyScore * this.options.frequencyWeight +
        contextScore * this.options.contextWeight +
        lengthScore * this.options.lengthWeight +
        typeScore * this.options.typeWeight
      );
    }

    /**
     * Calculate context relevance score
     */
    calculateContextScore(term, context) {
      if (!context || Object.keys(context).length === 0) {
        return 0.5; // Neutral score when no context
      }

      let score = 0;
      let indicators = 0;

      // Check for domain-specific context indicators
      Object.keys(this.contextIndicators).forEach(domain => {
        const domainIndicators = this.contextIndicators[domain];
        const termText = term.term.toLowerCase();

        domainIndicators.forEach(indicator => {
          if (term.contexts.some(ctx => ctx.toLowerCase().includes(indicator))) {
            score += 0.1;
            indicators++;
          }
        });
      });

      // Normalize score
      return indicators > 0 ? Math.min(score / indicators, 1.0) : 0.5;
    }

    /**
     * Extract context around a term
     */
    extractTermContext(text, position, termLength) {
      const contextRadius = 50; // Characters before and after
      const start = Math.max(0, position - contextRadius);
      const end = Math.min(text.length, position + termLength + contextRadius);

      return text.substring(start, end).trim();
    }

    /**
     * Classify term domain
     */
    classifyTermDomain(term) {
      // Check if term matches domain patterns
      for (const [domain, indicators] of Object.entries(this.contextIndicators)) {
        const termText = term.term.toLowerCase();

        // Check if term or its context contains domain indicators
        if (indicators.some(indicator =>
          termText.includes(indicator) ||
          term.contexts.some(ctx => ctx.toLowerCase().includes(indicator))
        )) {
          return domain;
        }
      }

      // Check pattern categories
      if (term.category) {
        const categoryDomainMap = {
          programming: 'technical',
          medical: 'medical',
          financial: 'business',
          legal: 'legal',
          companies: 'business',
          products: 'technical'
        };

        return categoryDomainMap[term.category] || 'general';
      }

      return 'general';
    }

    /**
     * Generate extraction summary
     */
    generateSummary(terms, text) {
      const domains = [...new Set(terms.map(t => t.domain))];
      const totalTerms = terms.reduce((sum, t) => sum + t.frequency, 0);
      const uniqueTerms = terms.length;

      // Calculate overall confidence based on term scores
      const avgConfidence = terms.length > 0
        ? terms.reduce((sum, t) => sum + t.confidence, 0) / terms.length
        : 0;

      return {
        totalTerms,
        uniqueTerms,
        domains,
        confidence: avgConfidence,
        topTerms: terms.slice(0, 10).map(t => t.term),
        domainDistribution: this.calculateDomainDistribution(terms)
      };
    }

    /**
     * Calculate domain distribution
     */
    calculateDomainDistribution(terms) {
      const distribution = {};

      terms.forEach(term => {
        const domain = term.domain || 'general';
        distribution[domain] = (distribution[domain] || 0) + 1;
      });

      return distribution;
    }

    /**
     * Add user-defined term to glossary
     */
    addUserTerm(term, translation, domain = 'user', metadata = {}) {
      const termData = {
        term,
        translation,
        domain,
        type: 'user',
        confidence: 1.0,
        frequency: 1,
        dateAdded: new Date().toISOString(),
        ...metadata
      };

      this.userGlossary.set(term.toLowerCase(), termData);
      this.termTranslations.set(term.toLowerCase(), translation);

      if (domain !== 'general') {
        this.domainCategories.set(term.toLowerCase(), domain);
      }

      // Save to persistent storage
      this.saveToStorage();

      console.log('[GlossaryExtractor] Added user term:', { term, translation, domain });
      return termData;
    }

    /**
     * Remove user-defined term
     */
    removeUserTerm(term) {
      const key = term.toLowerCase();
      const removed = this.userGlossary.delete(key);
      this.termTranslations.delete(key);
      this.domainCategories.delete(key);

      if (removed) {
        this.saveToStorage();
        console.log('[GlossaryExtractor] Removed user term:', term);
      }

      return removed;
    }

    /**
     * Get suggested translation for a term
     */
    getSuggestedTranslation(term) {
      const key = term.toLowerCase();

      // Check user-defined translations first
      if (this.termTranslations.has(key)) {
        return this.termTranslations.get(key);
      }

      // Check if it's a detected term with translation
      if (this.detectedTerms.has(key)) {
        const termData = this.detectedTerms.get(key);
        return termData.suggestedTranslation;
      }

      return null;
    }

    /**
     * Get all user-defined terms
     */
    getUserGlossary() {
      return Array.from(this.userGlossary.values());
    }

    /**
     * Get terms by domain
     */
    getTermsByDomain(domain) {
      const userTerms = Array.from(this.userGlossary.values())
        .filter(term => term.domain === domain);

      const detectedTerms = Array.from(this.detectedTerms.values())
        .filter(term => term.domain === domain);

      return [...userTerms, ...detectedTerms];
    }

    /**
     * Export glossary data
     */
    exportGlossary(format = 'json') {
      const data = {
        userTerms: Array.from(this.userGlossary.entries()),
        termTranslations: Array.from(this.termTranslations.entries()),
        domainCategories: Array.from(this.domainCategories.entries()),
        exportDate: new Date().toISOString(),
        version: '1.0'
      };

      switch (format.toLowerCase()) {
        case 'json':
          return JSON.stringify(data, null, 2);

        case 'csv':
          return this.exportToCSV(data);

        case 'txt':
          return this.exportToText(data);

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    }

    /**
     * Import glossary data
     */
    importGlossary(data, format = 'json') {
      try {
        let parsedData;

        switch (format.toLowerCase()) {
          case 'json':
            parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            break;

          case 'csv':
            parsedData = this.parseCSV(data);
            break;

          default:
            throw new Error(`Unsupported import format: ${format}`);
        }

        // Import user terms
        if (parsedData.userTerms) {
          parsedData.userTerms.forEach(([key, termData]) => {
            this.userGlossary.set(key, termData);
          });
        }

        // Import translations
        if (parsedData.termTranslations) {
          parsedData.termTranslations.forEach(([key, translation]) => {
            this.termTranslations.set(key, translation);
          });
        }

        // Import domain categories
        if (parsedData.domainCategories) {
          parsedData.domainCategories.forEach(([key, domain]) => {
            this.domainCategories.set(key, domain);
          });
        }

        // Save to storage
        this.saveToStorage();

        console.log('[GlossaryExtractor] Imported glossary data:', {
          userTerms: this.userGlossary.size,
          translations: this.termTranslations.size,
          categories: this.domainCategories.size
        });

        return true;

      } catch (error) {
        console.error('[GlossaryExtractor] Failed to import glossary:', error);
        return false;
      }
    }

    /**
     * Export to CSV format
     */
    exportToCSV(data) {
      const headers = ['Term', 'Translation', 'Domain', 'Type', 'Confidence', 'Date Added'];
      const rows = [headers.join(',')];

      data.userTerms.forEach(([key, termData]) => {
        const row = [
          `"${termData.term}"`,
          `"${termData.translation || ''}"`,
          `"${termData.domain || 'general'}"`,
          `"${termData.type || 'user'}"`,
          termData.confidence || 1.0,
          `"${termData.dateAdded || ''}"`
        ];
        rows.push(row.join(','));
      });

      return rows.join('\n');
    }

    /**
     * Export to text format
     */
    exportToText(data) {
      const lines = ['=== Translation Glossary ===', ''];

      const domains = {};
      data.userTerms.forEach(([key, termData]) => {
        const domain = termData.domain || 'general';
        if (!domains[domain]) domains[domain] = [];
        domains[domain].push(termData);
      });

      Object.keys(domains).sort().forEach(domain => {
        lines.push(`[${domain.toUpperCase()}]`);
        domains[domain].forEach(termData => {
          lines.push(`${termData.term} -> ${termData.translation || '(no translation)'}`);
        });
        lines.push('');
      });

      return lines.join('\n');
    }

    /**
     * Helper methods
     */
    isCommonWord(word) {
      const commonWords = new Set([
        'The', 'This', 'That', 'These', 'Those', 'Here', 'There', 'Where', 'When', 'What', 'Who', 'Why', 'How',
        'And', 'But', 'Or', 'So', 'Yet', 'For', 'Nor', 'With', 'Without', 'About', 'After', 'Before',
        'First', 'Second', 'Third', 'Last', 'Next', 'Previous', 'New', 'Old', 'Good', 'Bad', 'Best', 'Better'
      ]);
      return commonWords.has(word);
    }

    isSentenceBeginning(text, position) {
      if (position === 0) return true;
      const precedingChars = text.substring(Math.max(0, position - 10), position);
      return /[.!?]\s*$/.test(precedingChars);
    }

    isCommonAbbreviation(term) {
      const commonAbbrevs = new Set(['AM', 'PM', 'US', 'UK', 'EU', 'UN', 'AI', 'IT', 'TV', 'PC', 'AC', 'DC']);
      return commonAbbrevs.has(term.toUpperCase());
    }

    /**
     * Clear all data
     */
    clear() {
      this.userGlossary.clear();
      this.detectedTerms.clear();
      this.termFrequency.clear();
      this.contextPatterns.clear();
      this.termTranslations.clear();
      this.domainCategories.clear();

      if (this.options.persistentStorage) {
        this.saveToStorage();
      }

      console.log('[GlossaryExtractor] Cleared all data');
    }

    /**
     * Get statistics
     */
    getStats() {
      return {
        userTerms: this.userGlossary.size,
        detectedTerms: this.detectedTerms.size,
        translations: this.termTranslations.size,
        domains: this.domainCategories.size,
        uniqueFrequencies: this.termFrequency.size,
        topFrequencyTerms: Array.from(this.termFrequency.entries())
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
      };
    }
  }

  // Export for different environments
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = GlossaryExtractor;
  } else if (typeof global !== 'undefined') {
    // Browser global
    global.GlossaryExtractor = GlossaryExtractor;
  } else if (typeof window !== 'undefined') {
    // Browser window
    window.GlossaryExtractor = GlossaryExtractor;
  }

})();