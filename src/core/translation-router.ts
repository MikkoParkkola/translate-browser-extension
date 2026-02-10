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
import { webgpuDetector } from './webgpu-detector';
import { CircuitBreaker } from './circuit-breaker';
import type {
  TranslationProvider,
  TranslationOptions,
  RouterPreferences,
  ProviderConfig,
  Strategy,
} from '../types';

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
  enabledProviders: ['opus-mt-local'],
  primaryProvider: 'opus-mt-local',
};

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
    // Register default providers
    this.registerProvider(opusMTProvider);
    // Register cloud providers
    this.registerProvider(deeplProvider);
    this.registerProvider(openaiProvider);
    this.registerProvider(googleCloudProvider);
    this.registerProvider(anthropicProvider);
  }

  /**
   * Load user preferences from chrome.storage.local
   */
  private async loadPreferences(): Promise<RouterPreferences> {
    try {
      // Check if chrome.storage is available (may not be in tests or non-extension context)
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        console.log('[Router] chrome.storage not available, using defaults');
        return { ...DEFAULT_PREFERENCES };
      }

      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as RouterPreferences | undefined;

      if (stored) {
        console.log('[Router] Loaded preferences from storage:', stored);
        // Merge with defaults to handle any new fields added in updates
        return { ...DEFAULT_PREFERENCES, ...stored };
      }

      console.log('[Router] No stored preferences, using defaults');
      return { ...DEFAULT_PREFERENCES };
    } catch (error) {
      console.error('[Router] Failed to load preferences:', error);
      return { ...DEFAULT_PREFERENCES };
    }
  }

  /**
   * Save preferences to chrome.storage.local
   */
  async savePreferences(prefs: Partial<RouterPreferences>): Promise<void> {
    this.preferences = { ...this.preferences, ...prefs };

    try {
      // Check if chrome.storage is available
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        console.log('[Router] chrome.storage not available, preferences saved in memory only');
        return;
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: this.preferences });
      console.log('[Router] Saved preferences to storage:', this.preferences);
    } catch (error) {
      console.error('[Router] Failed to save preferences:', error);
      throw error;
    }
  }

  /**
   * Initialize router and detect WebGPU
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[Router] Initializing...');

    // Load preferences from storage (only once)
    if (!this.preferencesLoaded) {
      this.preferences = await this.loadPreferences();
      this.preferencesLoaded = true;
    }

    // Detect WebGPU support
    await webgpuDetector.detect();
    console.log('[Router] WebGPU detection:', webgpuDetector.getInfo());

    // Initialize providers
    for (const provider of this.providers.values()) {
      try {
        await provider.initialize();
      } catch (error) {
        console.error(`[Router] Failed to initialize ${provider.name}:`, error);
      }
    }

    this.initialized = true;
    console.log('[Router] Initialized');
  }

  /**
   * Register a provider
   */
  registerProvider(provider: TranslationProvider): void {
    if (!provider.id) {
      console.error('[Router] Provider must have id property');
      return;
    }
    this.providers.set(provider.id, provider);
    console.log(`[Router] Registered provider: ${provider.name}`);
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
        console.log(`[Router] Provider ${provider.name} circuit is open, skipping`);
        continue;
      }

      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        console.log(`[Router] Provider ${provider.name} not available`);
        continue;
      }

      const supportsLanguages = this.supportsLanguagePair(provider, sourceLang, targetLang);
      if (!supportsLanguages) {
        console.log(`[Router] ${provider.name} doesn't support ${sourceLang}->${targetLang}`);
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

    console.log(`[Router] Selected ${selected.name} (score: ${candidates[0].score})`);

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
    // Special handling for OPUS-MT
    if (provider.id === 'opus-mt-local') {
      const pair = `${sourceLang}-${targetLang}`;
      const supported = provider.getSupportedLanguages();
      return supported.some((p) => `${p.src}-${p.tgt}` === pair);
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

      console.log(`[Router] Translating with ${provider.name}: ${sourceLang}->${targetLang}`);

      try {
        const result = await provider.translate(text, sourceLang, targetLang, options);
        this.circuitBreaker.recordSuccess(provider.id);
        return result;
      } catch (providerError) {
        this.circuitBreaker.recordFailure(provider.id);
        throw providerError;
      }
    } catch (error) {
      console.error('[Router] Translation error:', error);
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
    console.log('[Router] Testing providers...');
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

    console.log('[Router] Test results:', results);
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
