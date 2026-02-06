/**
 * Prediction Engine unit tests
 *
 * Tests for predictive model pre-translation based on browsing patterns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PredictionEngine,
  extractDomain,
  calculateScore,
  MAX_DOMAIN_ENTRIES,
  MAX_PREDICTIONS,
  DECAY_HALF_LIFE_MS,
  // MIN_RECENT_TRANSLATIONS used in implementation, may be tested implicitly
  type LanguageRecord,
  type PredictionData,
} from './prediction-engine';

// Mock storage
const mockStorage: Record<string, unknown> = {};

vi.mock('./storage', () => ({
  safeStorageGet: vi.fn(async (keys: string[]) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (mockStorage[key]) {
        result[key] = mockStorage[key];
      }
    }
    return result;
  }),
  safeStorageSet: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(mockStorage, items);
    return true;
  }),
}));

// Mock logger
vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('extractDomain', () => {
  it('extracts domain from valid URL', () => {
    expect(extractDomain('https://example.com/page')).toBe('example.com');
    expect(extractDomain('https://www.example.com/page')).toBe('www.example.com');
    expect(extractDomain('http://sub.domain.example.com:8080/path?query=1')).toBe(
      'sub.domain.example.com'
    );
  });

  it('returns null for invalid URLs', () => {
    expect(extractDomain('not-a-url')).toBeNull();
    expect(extractDomain('')).toBeNull();
    expect(extractDomain('ftp://example.com')).toBe('example.com'); // FTP is valid
  });

  it('handles special URLs', () => {
    expect(extractDomain('chrome://extensions')).toBe('extensions');
    expect(extractDomain('file:///path/to/file')).toBe('');
  });
});

describe('calculateScore', () => {
  const now = Date.now();

  it('returns count for recent records', () => {
    const record: LanguageRecord = {
      language: 'fi',
      count: 10,
      lastSeen: now,
    };
    expect(calculateScore(record, now)).toBe(10);
  });

  it('decays score over time', () => {
    const record: LanguageRecord = {
      language: 'fi',
      count: 10,
      lastSeen: now - DECAY_HALF_LIFE_MS,
    };
    // After one half-life, score should be approximately half
    expect(calculateScore(record, now)).toBeCloseTo(5, 1);
  });

  it('decays further with more time', () => {
    const record: LanguageRecord = {
      language: 'fi',
      count: 10,
      lastSeen: now - 2 * DECAY_HALF_LIFE_MS,
    };
    // After two half-lives, score should be approximately quarter
    expect(calculateScore(record, now)).toBeCloseTo(2.5, 1);
  });

  it('handles zero count', () => {
    const record: LanguageRecord = {
      language: 'fi',
      count: 0,
      lastSeen: now,
    };
    expect(calculateScore(record, now)).toBe(0);
  });
});

describe('PredictionEngine', () => {
  let engine: PredictionEngine;

  beforeEach(() => {
    // Clear mock storage
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    engine = new PredictionEngine();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('load/save', () => {
    it('creates default data on first load', async () => {
      await engine.load();
      const stats = await engine.getStats();
      expect(stats.domainCount).toBe(0);
      expect(stats.totalTranslations).toBe(0);
      expect(stats.preferredTarget).toBe('en');
    });

    it('loads existing data from storage', async () => {
      const existingData: PredictionData = {
        domains: {
          'example.com': {
            domain: 'example.com',
            languages: [{ language: 'fi', count: 5, lastSeen: Date.now() }],
            totalDetections: 5,
            firstSeen: Date.now() - 1000,
            lastSeen: Date.now(),
          },
        },
        preferredTarget: 'en',
        totalTranslations: 10,
        lastTranslation: Date.now(),
        recentTranslations: 3,
        recentWindowStart: Date.now(),
      };
      mockStorage['predictionData'] = existingData;

      await engine.load();
      const stats = await engine.getStats();
      expect(stats.domainCount).toBe(1);
      expect(stats.totalTranslations).toBe(10);
    });
  });

  describe('recordDetection', () => {
    it('records language detection for new domain', async () => {
      await engine.recordDetection('https://example.com/page', 'fi');

      // Fast-forward to allow debounced save
      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();
      expect(stats.domainCount).toBe(1);
    });

    it('increments count for existing language', async () => {
      await engine.recordDetection('https://example.com/page1', 'fi');
      await engine.recordDetection('https://example.com/page2', 'fi');
      await engine.recordDetection('https://example.com/page3', 'fi');

      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();
      expect(stats.domainCount).toBe(1);
      expect(stats.topDomains[0].detections).toBe(3);
    });

    it('tracks multiple languages per domain', async () => {
      await engine.recordDetection('https://example.com/fi', 'fi');
      await engine.recordDetection('https://example.com/sv', 'sv');
      await engine.recordDetection('https://example.com/en', 'en');

      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();
      expect(stats.domainCount).toBe(1);
      expect(stats.topDomains[0].detections).toBe(3);
    });

    it('handles invalid URLs gracefully', async () => {
      await engine.recordDetection('not-a-url', 'fi');

      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();
      expect(stats.domainCount).toBe(0);
    });

    it('evicts LRU domains when over limit', async () => {
      // Record detections for MAX_DOMAIN_ENTRIES + 10 domains
      const domainCount = MAX_DOMAIN_ENTRIES + 10;

      for (let i = 0; i < domainCount; i++) {
        await engine.recordDetection(`https://domain${i}.com/page`, 'fi');
        vi.advanceTimersByTime(100); // Small time increment for LRU ordering
      }

      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();
      expect(stats.domainCount).toBeLessThanOrEqual(MAX_DOMAIN_ENTRIES);
    });
  });

  describe('recordTranslation', () => {
    it('updates translation statistics', async () => {
      await engine.recordTranslation('fi');
      await engine.recordTranslation('fi');
      await engine.recordTranslation('fi');

      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();
      expect(stats.totalTranslations).toBe(3);
      expect(stats.recentTranslations).toBe(3);
      expect(stats.preferredTarget).toBe('fi');
    });

    it('resets recent window after 24h', async () => {
      await engine.recordTranslation('fi');
      await engine.recordTranslation('fi');

      // Fast-forward 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      await engine.recordTranslation('fi');

      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();
      expect(stats.totalTranslations).toBe(3);
      expect(stats.recentTranslations).toBe(1); // Reset after 24h
    });
  });

  describe('hasRecentActivity', () => {
    it('returns false when no translations', async () => {
      const result = await engine.hasRecentActivity();
      expect(result).toBe(false);
    });

    it('returns true after translation', async () => {
      await engine.recordTranslation('fi');
      vi.advanceTimersByTime(2000);

      const result = await engine.hasRecentActivity();
      expect(result).toBe(true);
    });

    it('returns false after 24h inactivity', async () => {
      await engine.recordTranslation('fi');
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      const result = await engine.hasRecentActivity();
      expect(result).toBe(false);
    });
  });

  describe('predict', () => {
    beforeEach(async () => {
      // Setup: record some activity so predictions are enabled
      await engine.recordTranslation('en');
      vi.advanceTimersByTime(100);
    });

    it('returns empty array when no recent activity', async () => {
      const freshEngine = new PredictionEngine();
      const predictions = await freshEngine.predict('https://example.com/page');
      expect(predictions).toEqual([]);
    });

    it('predicts based on domain history', async () => {
      // Record Finnish content on example.com
      await engine.recordDetection('https://example.com/page1', 'fi');
      await engine.recordDetection('https://example.com/page2', 'fi');
      await engine.recordDetection('https://example.com/page3', 'fi');

      vi.advanceTimersByTime(2000);

      const predictions = await engine.predict('https://example.com/newpage');

      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions[0].sourceLang).toBe('fi');
      expect(predictions[0].targetLang).toBe('en');
      expect(predictions[0].confidence).toBeGreaterThan(0);
      expect(predictions[0].domain).toBe('example.com');
    });

    it('excludes source=target predictions', async () => {
      await engine.setPreferredTarget('fi');
      await engine.recordDetection('https://example.com/page', 'fi');

      vi.advanceTimersByTime(2000);

      const predictions = await engine.predict('https://example.com/newpage');

      // Should not predict fi->fi
      expect(predictions.every((p) => p.sourceLang !== p.targetLang)).toBe(true);
    });

    it('returns up to MAX_PREDICTIONS', async () => {
      // Record many different languages
      await engine.recordDetection('https://example.com/fi', 'fi');
      await engine.recordDetection('https://example.com/sv', 'sv');
      await engine.recordDetection('https://example.com/de', 'de');
      await engine.recordDetection('https://example.com/fr', 'fr');
      await engine.recordDetection('https://example.com/es', 'es');

      vi.advanceTimersByTime(2000);

      const predictions = await engine.predict('https://example.com/newpage');

      expect(predictions.length).toBeLessThanOrEqual(MAX_PREDICTIONS);
    });

    it('prioritizes more frequent languages', async () => {
      await engine.recordDetection('https://example.com/sv1', 'sv');
      await engine.recordDetection('https://example.com/fi1', 'fi');
      await engine.recordDetection('https://example.com/fi2', 'fi');
      await engine.recordDetection('https://example.com/fi3', 'fi');

      vi.advanceTimersByTime(2000);

      const predictions = await engine.predict('https://example.com/newpage');

      expect(predictions[0].sourceLang).toBe('fi'); // More frequent
    });

    it('includes global predictions for new domains', async () => {
      // Record activity on other domains
      await engine.recordDetection('https://other1.com/page', 'fi');
      await engine.recordDetection('https://other2.com/page', 'fi');

      vi.advanceTimersByTime(2000);

      const predictions = await engine.predict('https://newdomain.com/page');

      // Should still get predictions from global history
      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions[0].domain).toBeUndefined(); // Global prediction
    });

    it('weighs recent activity higher', async () => {
      // Old detection
      await engine.recordDetection('https://example.com/sv', 'sv');
      await engine.recordDetection('https://example.com/sv', 'sv');
      await engine.recordDetection('https://example.com/sv', 'sv');

      // Fast-forward 14 days (2 half-lives)
      vi.advanceTimersByTime(14 * 24 * 60 * 60 * 1000);

      // Recent detection (only 1 but recent)
      await engine.recordTranslation('en'); // Keep activity window alive
      await engine.recordDetection('https://example.com/fi', 'fi');
      await engine.recordDetection('https://example.com/fi', 'fi');

      vi.advanceTimersByTime(2000);

      const predictions = await engine.predict('https://example.com/newpage');

      // Finnish should rank higher despite fewer total detections
      // because Swedish detections are old (decayed)
      expect(predictions[0].sourceLang).toBe('fi');
    });
  });

  describe('setPreferredTarget / getPreferredTarget', () => {
    it('sets and gets preferred target', async () => {
      await engine.setPreferredTarget('fi');
      vi.advanceTimersByTime(2000);

      const target = await engine.getPreferredTarget();
      expect(target).toBe('fi');
    });

    it('defaults to en', async () => {
      const target = await engine.getPreferredTarget();
      expect(target).toBe('en');
    });
  });

  describe('clear', () => {
    it('clears all prediction data', async () => {
      await engine.recordDetection('https://example.com/page', 'fi');
      await engine.recordTranslation('en');

      vi.advanceTimersByTime(2000);

      let stats = await engine.getStats();
      expect(stats.domainCount).toBe(1);
      expect(stats.totalTranslations).toBe(1);

      await engine.clear();

      stats = await engine.getStats();
      expect(stats.domainCount).toBe(0);
      expect(stats.totalTranslations).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns comprehensive statistics', async () => {
      await engine.recordDetection('https://example1.com/page', 'fi');
      await engine.recordDetection('https://example1.com/page', 'fi');
      await engine.recordDetection('https://example2.com/page', 'sv');
      await engine.recordTranslation('en');

      vi.advanceTimersByTime(2000);

      const stats = await engine.getStats();

      expect(stats.domainCount).toBe(2);
      expect(stats.totalTranslations).toBe(1);
      expect(stats.recentTranslations).toBe(1);
      expect(stats.preferredTarget).toBe('en');
      expect(stats.topDomains).toHaveLength(2);
      expect(stats.topDomains[0].domain).toBe('example1.com');
      expect(stats.topDomains[0].detections).toBe(2);
    });
  });
});
