/**
 * Prediction Engine
 *
 * Predicts likely translation language pairs based on browsing history.
 * Uses LRU eviction to manage storage and scores by frequency + recency.
 */

import { createLogger } from './logger';
import { safeStorageGet, safeStorageSet } from './storage';

const log = createLogger('PredictionEngine');

/** Maximum number of domain entries to track */
export const MAX_DOMAIN_ENTRIES = 100;

/** Maximum predictions to return */
export const MAX_PREDICTIONS = 3;

/** Time decay factor (halves score every 7 days) */
export const DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimum translation count in last 24h to enable preloading */
export const MIN_RECENT_TRANSLATIONS = 1;

/** Storage key for prediction data */
const STORAGE_KEY = 'predictionData';

/**
 * Language detection record for a domain
 */
export interface LanguageRecord {
  /** ISO 639-1 language code */
  language: string;
  /** Number of times detected */
  count: number;
  /** Last detection timestamp */
  lastSeen: number;
}

/**
 * Domain entry storing language detection history
 */
export interface DomainEntry {
  /** Domain name (e.g., 'example.com') */
  domain: string;
  /** Language detection records */
  languages: LanguageRecord[];
  /** Total detections for this domain */
  totalDetections: number;
  /** First seen timestamp */
  firstSeen: number;
  /** Last seen timestamp */
  lastSeen: number;
}

/**
 * Prediction data structure stored in chrome.storage.local
 */
export interface PredictionData {
  /** Domain entries keyed by domain */
  domains: Record<string, DomainEntry>;
  /** User's preferred target language */
  preferredTarget: string;
  /** Total translation count */
  totalTranslations: number;
  /** Last translation timestamp */
  lastTranslation: number;
  /** Translation count in last 24h */
  recentTranslations: number;
  /** Timestamp when recentTranslations was reset */
  recentWindowStart: number;
}

/**
 * Predicted language pair with confidence score
 */
export interface LanguagePrediction {
  /** Source language (detected) */
  sourceLang: string;
  /** Target language (user preference) */
  targetLang: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Domain this prediction is based on */
  domain?: string;
}

/**
 * Create default prediction data
 */
function createDefaultData(): PredictionData {
  return {
    domains: {},
    preferredTarget: 'en',
    totalTranslations: 0,
    lastTranslation: 0,
    recentTranslations: 0,
    recentWindowStart: Date.now(),
  };
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

/**
 * Calculate time-decayed score for a language record
 */
export function calculateScore(record: LanguageRecord, now: number): number {
  const age = now - record.lastSeen;
  const decayFactor = Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
  return record.count * decayFactor;
}

/**
 * Evict least-recently-used entries when over limit
 */
function evictLRUDomains(data: PredictionData): void {
  const domains = Object.values(data.domains);
  if (domains.length <= MAX_DOMAIN_ENTRIES) {
    return;
  }

  // Sort by lastSeen ascending (oldest first)
  domains.sort((a, b) => a.lastSeen - b.lastSeen);

  // Remove oldest entries until under limit
  const toRemove = domains.length - MAX_DOMAIN_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    const domain = domains[i].domain;
    delete data.domains[domain];
    log.debug(`Evicted LRU domain: ${domain}`);
  }
}

/**
 * Update recent translations window (24h sliding window)
 */
function updateRecentWindow(data: PredictionData, now: number): void {
  const windowMs = 24 * 60 * 60 * 1000; // 24 hours
  if (now - data.recentWindowStart > windowMs) {
    // Reset window
    data.recentTranslations = 0;
    data.recentWindowStart = now;
  }
}

/**
 * Prediction Engine class
 */
export class PredictionEngine {
  private data: PredictionData | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Load prediction data from storage
   */
  async load(): Promise<void> {
    try {
      const stored = await safeStorageGet<{ [STORAGE_KEY]: PredictionData }>([STORAGE_KEY]);
      this.data = stored[STORAGE_KEY] || createDefaultData();
      log.info(`Loaded prediction data: ${Object.keys(this.data.domains).length} domains`);
    } catch (error) {
      log.warn('Failed to load prediction data:', error);
      this.data = createDefaultData();
    }
  }

  /**
   * Save prediction data to storage (debounced)
   */
  private async save(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Debounce saves by 1 second
    this.saveTimeout = setTimeout(async () => {
      if (this.data) {
        const success = await safeStorageSet({ [STORAGE_KEY]: this.data });
        if (success) {
          log.debug('Prediction data saved');
        }
      }
    }, 1000);
  }

  /**
   * Ensure data is loaded
   */
  private async ensureLoaded(): Promise<PredictionData> {
    if (!this.data) {
      await this.load();
    }
    return this.data!;
  }

  /**
   * Record a language detection for a URL
   */
  async recordDetection(url: string, language: string): Promise<void> {
    const data = await this.ensureLoaded();
    const domain = extractDomain(url);

    if (!domain) {
      log.warn('Could not extract domain from URL:', url);
      return;
    }

    const now = Date.now();

    // Get or create domain entry
    if (!data.domains[domain]) {
      data.domains[domain] = {
        domain,
        languages: [],
        totalDetections: 0,
        firstSeen: now,
        lastSeen: now,
      };
    }

    const entry = data.domains[domain];
    entry.lastSeen = now;
    entry.totalDetections++;

    // Find or create language record
    let langRecord = entry.languages.find((r) => r.language === language);
    if (!langRecord) {
      langRecord = { language, count: 0, lastSeen: now };
      entry.languages.push(langRecord);
    }

    langRecord.count++;
    langRecord.lastSeen = now;

    // Evict LRU domains if needed
    evictLRUDomains(data);

    log.debug(`Recorded detection: ${domain} -> ${language} (count: ${langRecord.count})`);

    await this.save();
  }

  /**
   * Record a translation event (updates recent activity)
   */
  async recordTranslation(targetLang: string): Promise<void> {
    const data = await this.ensureLoaded();
    const now = Date.now();

    updateRecentWindow(data, now);

    data.totalTranslations++;
    data.lastTranslation = now;
    data.recentTranslations++;
    data.preferredTarget = targetLang;

    log.debug(`Recorded translation: target=${targetLang}, recent=${data.recentTranslations}`);

    await this.save();
  }

  /**
   * Set user's preferred target language
   */
  async setPreferredTarget(targetLang: string): Promise<void> {
    const data = await this.ensureLoaded();
    data.preferredTarget = targetLang;
    await this.save();
  }

  /**
   * Get user's preferred target language
   */
  async getPreferredTarget(): Promise<string> {
    const data = await this.ensureLoaded();
    return data.preferredTarget;
  }

  /**
   * Check if user has been active recently (translated in last 24h)
   */
  async hasRecentActivity(): Promise<boolean> {
    const data = await this.ensureLoaded();
    const now = Date.now();

    updateRecentWindow(data, now);

    return data.recentTranslations >= MIN_RECENT_TRANSLATIONS;
  }

  /**
   * Predict likely language pairs for a URL
   */
  async predict(url: string): Promise<LanguagePrediction[]> {
    const data = await this.ensureLoaded();
    const domain = extractDomain(url);
    const now = Date.now();
    const targetLang = data.preferredTarget;

    const predictions: LanguagePrediction[] = [];

    // Check if user has been active recently
    updateRecentWindow(data, now);
    if (data.recentTranslations < MIN_RECENT_TRANSLATIONS) {
      log.debug('No recent activity, skipping prediction');
      return [];
    }

    // Predict from domain-specific history
    if (domain && data.domains[domain]) {
      const entry = data.domains[domain];

      // Calculate scores for all languages
      const scored = entry.languages.map((record) => ({
        language: record.language,
        score: calculateScore(record, now),
      }));

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Add top predictions
      for (const item of scored.slice(0, MAX_PREDICTIONS)) {
        // Don't predict if source equals target
        if (item.language === targetLang) {
          continue;
        }

        // Normalize confidence (0-1)
        const maxScore = scored[0]?.score || 1;
        const confidence = Math.min(1, item.score / maxScore);

        predictions.push({
          sourceLang: item.language,
          targetLang,
          confidence,
          domain,
        });
      }
    }

    // Fill remaining slots with global predictions from other domains
    if (predictions.length < MAX_PREDICTIONS) {
      const globalScores = new Map<string, number>();

      for (const entry of Object.values(data.domains)) {
        if (entry.domain === domain) continue;

        for (const record of entry.languages) {
          if (record.language === targetLang) continue;

          const score = calculateScore(record, now) * 0.5; // Global gets 50% weight
          const current = globalScores.get(record.language) || 0;
          globalScores.set(record.language, current + score);
        }
      }

      // Sort and add remaining predictions
      const globalSorted = Array.from(globalScores.entries())
        .sort((a, b) => b[1] - a[1])
        .filter(([lang]) => !predictions.some((p) => p.sourceLang === lang));

      const remaining = MAX_PREDICTIONS - predictions.length;
      const maxGlobalScore = globalSorted[0]?.[1] || 1;

      for (const [lang, score] of globalSorted.slice(0, remaining)) {
        predictions.push({
          sourceLang: lang,
          targetLang,
          confidence: Math.min(1, score / maxGlobalScore) * 0.5, // Lower confidence for global
        });
      }
    }

    log.debug(`Predictions for ${domain}: ${predictions.map((p) => `${p.sourceLang}->${p.targetLang}(${p.confidence.toFixed(2)})`).join(', ')}`);

    return predictions;
  }

  /**
   * Get statistics for debugging
   */
  async getStats(): Promise<{
    domainCount: number;
    totalTranslations: number;
    recentTranslations: number;
    preferredTarget: string;
    topDomains: Array<{ domain: string; detections: number }>;
  }> {
    const data = await this.ensureLoaded();
    const now = Date.now();
    updateRecentWindow(data, now);

    const topDomains = Object.values(data.domains)
      .sort((a, b) => b.totalDetections - a.totalDetections)
      .slice(0, 5)
      .map((d) => ({ domain: d.domain, detections: d.totalDetections }));

    return {
      domainCount: Object.keys(data.domains).length,
      totalTranslations: data.totalTranslations,
      recentTranslations: data.recentTranslations,
      preferredTarget: data.preferredTarget,
      topDomains,
    };
  }

  /**
   * Clear all prediction data
   */
  async clear(): Promise<void> {
    this.data = createDefaultData();
    await safeStorageSet({ [STORAGE_KEY]: this.data });
    log.info('Prediction data cleared');
  }
}

// Singleton instance
let instance: PredictionEngine | null = null;

/**
 * Get the singleton prediction engine instance
 */
export function getPredictionEngine(): PredictionEngine {
  if (!instance) {
    instance = new PredictionEngine();
  }
  return instance;
}
