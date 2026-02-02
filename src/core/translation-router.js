/**
 * Translation Router
 * Intelligently selects the best provider for each translation request
 * based on user preferences, language pair support, and availability
 */

import opusMTProvider from '../providers/opus-mt-local.js';
import webgpuDetector from './webgpu-detector.js';

class TranslationRouter {
  constructor() {
    this.providers = new Map();
    this.preferences = this.loadPreferences();
    this.stats = new Map(); // Track provider usage
    this.initialized = false;

    // Register default providers
    this.registerProvider(opusMTProvider);
  }

  /**
   * Load user preferences
   */
  loadPreferences() {
    return {
      prioritize: 'balanced', // 'quality' | 'speed' | 'cost' | 'balanced'
      preferLocal: true,
      enabledProviders: ['opus-mt-local'],
      primaryProvider: 'opus-mt-local',
    };
  }

  /**
   * Initialize router and detect WebGPU
   */
  async initialize() {
    if (this.initialized) return;

    console.log('[Router] Initializing...');

    // Detect WebGPU support
    await webgpuDetector.detect();
    console.log('[Router] WebGPU detection:', webgpuDetector.getInfo());

    // Initialize providers
    for (const provider of this.providers.values()) {
      try {
        if (provider.initialize) {
          await provider.initialize();
        }
      } catch (error) {
        console.error(
          `[Router] Failed to initialize ${provider.name}:`,
          error
        );
      }
    }

    this.initialized = true;
    console.log('[Router] Initialized');
  }

  /**
   * Register a provider
   */
  registerProvider(provider) {
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
  async selectProvider(sourceLang, targetLang) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Build candidate list based on user preferences
    const candidates = [];

    for (const provider of this.providers.values()) {
      if (!this.preferences.enabledProviders.includes(provider.id)) {
        continue;
      }

      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        console.log(`[Router] Provider ${provider.name} not available`);
        continue;
      }

      const supportsLanguages = this.supportsLanguagePair(
        provider,
        sourceLang,
        targetLang
      );

      if (!supportsLanguages) {
        console.log(
          `[Router] ${provider.name} doesn't support ${sourceLang}→${targetLang}`
        );
        continue;
      }

      candidates.push({
        provider,
        score: this.scoreProvider(provider, sourceLang, targetLang),
      });
    }

    if (candidates.length === 0) {
      throw new Error(
        `No available provider for ${sourceLang}→${targetLang}`
      );
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates[0].provider;

    console.log(
      `[Router] Selected ${selected.name} (score: ${candidates[0].score})`
    );

    return selected;
  }

  /**
   * Check if provider supports language pair
   */
  supportsLanguagePair(provider, sourceLang, targetLang) {
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
  scoreProvider(provider, sourceLang, targetLang) {
    let score = 100; // Base score

    // Quality preference
    if (this.preferences.prioritize === 'quality') {
      score += provider.qualityTier === 'premium' ? 50 : 0;
    }

    // Speed preference (local is fastest)
    if (this.preferences.prioritize === 'speed') {
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
  async translate(text, sourceLang, targetLang, options = {}) {
    try {
      const provider = await this.selectProvider(sourceLang, targetLang);

      // Track usage
      const usage = (this.stats.get(provider.id) || 0) + 1;
      this.stats.set(provider.id, usage);

      console.log(
        `[Router] Translating with ${provider.name}: ${sourceLang}→${targetLang}`
      );

      const result = await provider.translate(
        text,
        sourceLang,
        targetLang,
        options
      );

      return result;
    } catch (error) {
      console.error('[Router] Translation error:', error);
      throw error;
    }
  }

  /**
   * Get provider info
   */
  getProviderInfo(providerId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return null;
    }
    return provider.getInfo();
  }

  /**
   * List all providers
   */
  listProviders() {
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
  async testProviders() {
    console.log('[Router] Testing providers...');
    const results = {};

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
          status: `ERROR: ${error.message}`,
        };
      }
    }

    console.log('[Router] Test results:', results);
    return results;
  }

  /**
   * Get stats
   */
  getStats() {
    const stats = {};
    for (const [id, count] of this.stats) {
      const provider = this.providers.get(id);
      if (provider) {
        stats[provider.name] = count;
      }
    }
    return stats;
  }
}

// Singleton instance
const router = new TranslationRouter();

// Export for use
if (typeof window !== 'undefined') {
  window.translationRouter = router;
}

export default router;
export { TranslationRouter };
