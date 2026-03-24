/**
 * Translation Router
 * Intelligently selects the best provider for each translation request
 * based on user preferences, language pair support, and availability
 */

import { opusMTProvider } from '../providers/opus-mt-local';
import { deeplProvider } from '../providers/deepl';
import { openaiProvider } from '../providers/openai';
import { googleCloudProvider } from '../providers/google-cloud';
import { anthropicProvider } from '../providers/anthropic';
import { chromeTranslatorProvider } from '../providers/chrome-translator';
import { nllb200Provider } from '../providers/nllb-200';
import { webgpuDetector } from './webgpu-detector';
import { CircuitBreaker } from './circuit-breaker';
import { safeStorageGet } from './storage';
import { browserAPI } from './browser-api';
import type {
  TranslationProvider,
  TranslationOptions,
  RouterPreferences,
  ProviderConfig,
  Strategy,
} from '../types';
import { createLogger } from './logger';
import { supportsOpusMtLanguagePair } from '../offscreen/model-maps';

const log = createLogger('Router');
const LEGACY_OPUS_PROVIDER_ID = 'opus-mt-local';

interface ProviderCandidate {
  provider: TranslationProvider;
  score: number;
}

// Storage key for router preferences
const STORAGE_KEY = 'routerPreferences';

// Default preferences
const DEFAULT_PREFERENCES: RouterPreferences = {
  prioritize: 'balanced',
  preferLocal: true,
  enabledProviders: ['opus-mt'],
  primaryProvider: 'opus-mt',
};

function normalizeRouterProviderId(providerId: string): string {
  return providerId === LEGACY_OPUS_PROVIDER_ID ? 'opus-mt' : providerId;
}

function normalizeRouterPreferences(preferences: RouterPreferences): RouterPreferences {
  return {
    ...preferences,
    enabledProviders: [...new Set(preferences.enabledProviders.map(normalizeRouterProviderId))],
    primaryProvider: normalizeRouterProviderId(preferences.primaryProvider),
  };
}

export class TranslationRouter {
  private providers = new Map<string, TranslationProvider>();
  private preferences: RouterPreferences;
  private stats = new Map<string, number>();
  private initialized = false;
  private preferencesLoaded = false;
  readonly circuitBreaker: CircuitBreaker;

  constructor(circuitBreaker?: CircuitBreaker) {
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker();
    // Start with defaults, will be overwritten by loadPreferences()
    this.preferences = { ...DEFAULT_PREFERENCES };
    // Chrome built-in translator (zero-cost, on-device, Chrome 138+) — highest priority when available
    this.registerProvider(chromeTranslatorProvider);
    // OPUS-MT local model
    this.registerProvider(opusMTProvider);
    // NLLB-200-distilled-600M: single model covering 200 language pairs
    this.registerProvider(nllb200Provider);
    // Cloud providers
    this.registerProvider(deeplProvider);
    this.registerProvider(openaiProvider);
    this.registerProvider(googleCloudProvider);
    this.registerProvider(anthropicProvider);
  }

  /**
   * Load user preferences from chrome.storage.local
   */
  private async loadPreferences(): Promise<RouterPreferences> {
    const stored = await safeStorageGet<Record<string, RouterPreferences>>(STORAGE_KEY);
    const preferences = stored[STORAGE_KEY];
    if (preferences) {
      const normalizedPreferences = normalizeRouterPreferences({
        ...DEFAULT_PREFERENCES,
        ...preferences,
      });
      log.info('Loaded preferences from storage:', normalizedPreferences);
      return normalizedPreferences;
    }
    log.info('No stored preferences, using defaults');
    return { ...DEFAULT_PREFERENCES };
  }

  /**
   * Save preferences to chrome.storage.local
   */
  async savePreferences(prefs: Partial<RouterPreferences>): Promise<void> {
    this.preferences = normalizeRouterPreferences({ ...this.preferences, ...prefs });

    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        log.info('chrome.storage not available, preferences saved in memory only');
        return;
      }
      await browserAPI.storage.local.set({ [STORAGE_KEY]: this.preferences });
      log.info('Saved preferences to storage:', this.preferences);
    } catch (error) {
      log.error('Failed to save preferences:', error);
      throw error;
    }
  }

  /**
   * Initialize router and detect WebGPU
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing...');

    // Load preferences from storage (only once)
    /* v8 ignore start */
    if (!this.preferencesLoaded) {
    /* v8 ignore stop */
      this.preferences = await this.loadPreferences();
      this.preferencesLoaded = true;
    }

    // Detect WebGPU support
    await webgpuDetector.detect();
    log.info('WebGPU detection:', webgpuDetector.getInfo());

    // Initialize providers
    for (const provider of this.providers.values()) {
      try {
        await provider.initialize();
      } catch (error) {
        log.error(`Failed to initialize ${provider.name}:`, error);
      }
    }

    this.initialized = true;
    log.info('Initialized');
  }

  /**
   * Register a provider
   */
  registerProvider(provider: TranslationProvider): void {
    if (!provider.id) {
      log.error('Provider must have id property');
      return;
    }
    this.providers.set(provider.id, provider);
    log.info(`Registered provider: ${provider.name}`);
  }

  /**
   * Get best provider for language pair
   */
  async selectProvider(sourceLang: string, targetLang: string): Promise<TranslationProvider> {
    if (!this.initialized) {
      await this.initialize();
    }

    const candidates: ProviderCandidate[] = [];

    for (const provider of this.providers.values()) {
      if (!this.preferences.enabledProviders.includes(provider.id)) {
        continue;
      }

      // Check circuit breaker before attempting provider
      if (!this.circuitBreaker.isAvailable(provider.id)) {
        log.info(`Provider ${provider.name} circuit is open, skipping`);
        continue;
      }

      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        log.info(`Provider ${provider.name} not available`);
        continue;
      }

      const supportsLanguages = this.supportsLanguagePair(provider, sourceLang, targetLang);
      if (!supportsLanguages) {
        log.info(`${provider.name} doesn't support ${sourceLang}->${targetLang}`);
        continue;
      }

      candidates.push({
        provider,
        score: this.scoreProvider(provider, sourceLang, targetLang),
      });
    }

    if (candidates.length === 0) {
      throw new Error(`No available provider for ${sourceLang}->${targetLang}`);
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates[0].provider;

    log.info(`Selected ${selected.name} (score: ${candidates[0].score})`);

    return selected;
  }

  /**
   * Check if provider supports language pair
   */
  private supportsLanguagePair(
    provider: TranslationProvider,
    sourceLang: string,
    targetLang: string
  ): boolean {
    // Keep OPUS-MT routing aligned with the canonical direct + pivot capability map.
    if (provider.id === 'opus-mt') {
      return supportsOpusMtLanguagePair(sourceLang, targetLang);
    }

    return true; // Other providers typically support all pairs
  }

  /**
   * Score provider based on preferences
   */
  private scoreProvider(
    provider: TranslationProvider,
    _sourceLang: string,
    _targetLang: string
  ): number {
    let score = 100; // Base score

    // Chrome built-in: free, on-device, maintained by Google — always preferred when available
    // User can override by setting preferLocal: false + primaryProvider to something else
    if (provider.id === 'chrome-builtin') {
      score += 60; // Highest base bonus
    }

    // Quality preference
    if (this.preferences.prioritize === 'quality') {
      score += provider.qualityTier === 'premium' ? 50 : 0;
    }

    // Speed preference (local is fastest)
    if (this.preferences.prioritize === 'fast') {
      score += provider.type === 'local' ? 50 : 0;
    }

    // Cost preference
    if (this.preferences.prioritize === 'cost') {
      score += provider.costPerMillion === 0 ? 50 : 0;
    }

    // Balanced (default)
    if (this.preferences.prioritize === 'balanced') {
      if (provider.type === 'local') score += 40;
      if (provider.qualityTier === 'premium') score += 20;
    }

    // Prefer local if setting enabled
    if (this.preferences.preferLocal && provider.type === 'local') {
      score += 30;
    }

    // Usage-based scoring (prefer less-used providers for load balancing)
    const usage = this.stats.get(provider.id) || 0;
    score -= Math.min(usage / 100, 10); // Penalize high usage

    return score;
  }

  /**
   * Translate text
   */
  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    options: TranslationOptions = {}
  ): Promise<string | string[]> {
    try {
      const provider = await this.selectProvider(sourceLang, targetLang);

      // Track usage
      const usage = (this.stats.get(provider.id) || 0) + 1;
      this.stats.set(provider.id, usage);

      log.info(`Translating with ${provider.name}: ${sourceLang}->${targetLang}`);

      try {
        const result = await provider.translate(text, sourceLang, targetLang, options);
        this.circuitBreaker.recordSuccess(provider.id);
        return result;
      } catch (providerError) {
        this.circuitBreaker.recordFailure(provider.id);
        throw providerError;
      }
    } catch (error) {
      log.error('Translation error:', error);
      throw error;
    }
  }

  /**
   * Get provider info
   */
  getProviderInfo(providerId: string): ProviderConfig | null {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return null;
    }
    return provider.getInfo();
  }

  /**
   * List all providers
   */
  listProviders(): Array<{
    id: string;
    name: string;
    type: string;
    qualityTier: string;
    icon: string;
  }> {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      qualityTier: p.qualityTier,
      icon: p.icon,
    }));
  }

  /**
   * Test providers
   */
  async testProviders(): Promise<Record<string, { name: string; passed: boolean; status: string }>> {
    log.info('Testing providers...');
    const results: Record<string, { name: string; passed: boolean; status: string }> = {};

    for (const [id, provider] of this.providers) {
      try {
        const passed = await provider.test();
        results[id] = {
          name: provider.name,
          passed,
          status: passed ? 'OK' : 'FAILED',
        };
      } catch (error) {
        results[id] = {
          name: provider.name,
          passed: false,
          status: `ERROR: ${(error as Error).message}`,
        };
      }
    }

    log.info('Test results:', results);
    return results;
  }

  /**
   * Get stats
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [id, count] of this.stats) {
      const provider = this.providers.get(id);
      if (provider) {
        stats[provider.name] = count;
      }
    }
    return stats;
  }

  /**
   * Set strategy preference
   */
  setStrategy(strategy: Strategy): void {
    this.preferences.prioritize = strategy;
  }

  /**
   * Get current strategy
   */
  getStrategy(): Strategy {
    return this.preferences.prioritize;
  }
}

// Singleton instance
export const translationRouter = new TranslationRouter();

export default translationRouter;
