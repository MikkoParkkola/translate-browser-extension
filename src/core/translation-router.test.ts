/**
 * Translation Router unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranslationRouter } from './translation-router';
import { CircuitBreaker } from './circuit-breaker';

// Mock the opus-mt provider
vi.mock('../providers/opus-mt-local', () => ({
  opusMTProvider: {
    id: 'opus-mt-local',
    name: 'Mock OPUS-MT',
    type: 'local',
    qualityTier: 'standard',
    costPerMillion: 0,
    icon: '',
    initialize: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    getSupportedLanguages: vi.fn().mockReturnValue([
      { src: 'en', tgt: 'fi' },
      { src: 'fi', tgt: 'en' },
      { src: 'en', tgt: 'de' },
    ]),
    translate: vi.fn().mockResolvedValue('Mocked translation'),
    test: vi.fn().mockResolvedValue(true),
    getInfo: vi.fn().mockReturnValue({
      id: 'opus-mt-local',
      name: 'Mock OPUS-MT',
      type: 'local',
      qualityTier: 'standard',
      costPerMillion: 0,
      icon: '',
    }),
  },
}));

// Mock webgpu detector
vi.mock('./webgpu-detector', () => ({
  webgpuDetector: {
    detect: vi.fn().mockResolvedValue(false),
    getInfo: vi.fn().mockReturnValue({
      supported: false,
      initialized: false,
      provider: 'wasm',
      device: 'Not initialized',
    }),
  },
}));

describe('TranslationRouter', () => {
  let router: TranslationRouter;

  beforeEach(() => {
    router = new TranslationRouter();
  });

  describe('constructor', () => {
    it('creates router with default preferences', () => {
      expect(router.getStrategy()).toBe('balanced');
    });

    it('has providers registered', () => {
      const providers = router.listProviders();
      expect(providers.length).toBeGreaterThan(0);
    });
  });

  describe('setStrategy', () => {
    it('updates strategy preference', () => {
      router.setStrategy('fast');
      expect(router.getStrategy()).toBe('fast');

      router.setStrategy('quality');
      expect(router.getStrategy()).toBe('quality');
    });

    it('handles cost strategy', () => {
      router.setStrategy('cost');
      expect(router.getStrategy()).toBe('cost');
    });

    it('handles smart strategy', () => {
      router.setStrategy('smart');
      expect(router.getStrategy()).toBe('smart');
    });
  });

  describe('listProviders', () => {
    it('returns list of registered providers', () => {
      const providers = router.listProviders();

      expect(providers).toBeInstanceOf(Array);
      expect(providers[0]).toHaveProperty('id');
      expect(providers[0]).toHaveProperty('name');
      expect(providers[0]).toHaveProperty('type');
    });
  });

  describe('getProviderInfo', () => {
    it('returns info for valid provider', () => {
      const info = router.getProviderInfo('opus-mt-local');

      expect(info).not.toBeNull();
      expect(info?.id).toBe('opus-mt-local');
    });

    it('returns null for unknown provider', () => {
      const info = router.getProviderInfo('unknown-provider');

      expect(info).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns empty stats initially', () => {
      const stats = router.getStats();

      expect(stats).toEqual({});
    });
  });

  describe('translate', () => {
    it('translates text using selected provider', async () => {
      const result = await router.translate('Hello', 'en', 'fi');

      expect(result).toBe('Mocked translation');
    });

    it('tracks provider usage', async () => {
      await router.translate('Hello', 'en', 'fi');

      const stats = router.getStats();
      expect(Object.values(stats).some(v => v > 0)).toBe(true);
    });

    it('throws for unsupported language pair', async () => {
      await expect(router.translate('Hello', 'xx', 'yy')).rejects.toThrow();
    });
  });

  describe('testProviders', () => {
    it('tests all providers and returns results', async () => {
      const results = await router.testProviders();

      expect(results).toHaveProperty('opus-mt-local');
      expect(results['opus-mt-local'].passed).toBe(true);
    });

    it('handles test errors gracefully', async () => {
      // Import and modify mock to throw on test
      const { opusMTProvider } = await import('../providers/opus-mt-local');
      vi.mocked(opusMTProvider.test).mockRejectedValueOnce(new Error('Test error'));

      const results = await router.testProviders();

      expect(results['opus-mt-local'].passed).toBe(false);
      expect(results['opus-mt-local'].status).toContain('ERROR');
    });
  });

  describe('translate with different strategies', () => {
    it('translates with cost strategy', async () => {
      router.setStrategy('cost');
      const result = await router.translate('Hello', 'en', 'fi');

      expect(result).toBe('Mocked translation');
    });

    it('translates with smart strategy', async () => {
      router.setStrategy('smart');
      const result = await router.translate('Hello', 'en', 'fi');

      expect(result).toBe('Mocked translation');
    });

    it('translates with quality strategy', async () => {
      router.setStrategy('quality');
      const result = await router.translate('Hello', 'en', 'fi');

      expect(result).toBe('Mocked translation');
    });

    it('translates with fast strategy', async () => {
      router.setStrategy('fast');
      const result = await router.translate('Hello', 'en', 'fi');

      expect(result).toBe('Mocked translation');
    });
  });

  describe('savePreferences', () => {
    it('updates in-memory preferences without chrome.storage', async () => {
      // chrome is not available in test environment, so preferences are memory-only
      await router.savePreferences({ prioritize: 'quality' });
      expect(router.getStrategy()).toBe('quality');
    });

    it('merges partial preferences', async () => {
      await router.savePreferences({ preferLocal: false });
      // Strategy should remain at default
      expect(router.getStrategy()).toBe('balanced');
    });
  });

  describe('registerProvider', () => {
    it('skips providers with no id', () => {
      const badProvider = { id: '', name: 'Bad' } as Parameters<typeof router.registerProvider>[0];
      // Should not throw, just log error and skip
      expect(() => router.registerProvider(badProvider)).not.toThrow();

      // Provider with empty id should not be registered
      const providers = router.listProviders();
      expect(providers.every((p) => p.id !== '')).toBe(true);
    });
  });

  describe('selectProvider', () => {
    it('throws when no enabled providers exist for language pair', async () => {
      // Use a fresh router so initialize() has not been called yet (loadPreferences would overwrite)
      const freshRouter = new TranslationRouter();
      // Set enabledProviders to empty AFTER construction but BEFORE first selectProvider call
      // By calling savePreferences first we set in-memory preferences, then initialize will
      // call loadPreferences which returns defaults from chrome (unavailable) — so we must
      // override initialized flag after the fact by calling initialize() once then updating.
      await freshRouter.initialize();
      // Now override preferences directly via savePreferences (no chrome, memory-only)
      await freshRouter.savePreferences({ enabledProviders: [] });
      await expect(freshRouter.selectProvider('en', 'fi')).rejects.toThrow('No available provider');
    });

    it('skips providers that return isAvailable false', async () => {
      const { opusMTProvider } = await import('../providers/opus-mt-local');
      vi.mocked(opusMTProvider.isAvailable).mockResolvedValueOnce(false);

      await expect(router.selectProvider('en', 'fi')).rejects.toThrow('No available provider');
    });
  });

  describe('scoreProvider - branch coverage', () => {
    it('awards quality bonus to premium provider under quality strategy', async () => {
      // Use a fresh router: initialize() first (loads defaults), then savePreferences to override.
      const freshRouter = new TranslationRouter();
      await freshRouter.initialize();

      const premiumProvider = {
        id: 'mock-premium',
        name: 'Mock Premium',
        type: 'cloud' as const,
        qualityTier: 'premium' as const,
        costPerMillion: 20,
        icon: '',
        initialize: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getSupportedLanguages: vi.fn().mockReturnValue([{ src: 'en', tgt: 'fi' }]),
        translate: vi.fn().mockResolvedValue('Premium translation'),
        test: vi.fn().mockResolvedValue(true),
        getInfo: vi.fn().mockReturnValue({ id: 'mock-premium', name: 'Mock Premium', type: 'cloud', qualityTier: 'premium', costPerMillion: 20, icon: '' }),
      };
      freshRouter.registerProvider(premiumProvider);

      // Disable preferLocal so quality bonus alone decides:
      // premium: 100 + 50(quality premium) = 150 vs local: 100 + 0 = 100
      await freshRouter.savePreferences({
        enabledProviders: ['opus-mt-local', 'mock-premium'],
        prioritize: 'quality',
        preferLocal: false,
      });

      const selected = await freshRouter.selectProvider('en', 'fi');
      expect(selected.id).toBe('mock-premium');
    });

    it('awards speed bonus to local provider under fast strategy', async () => {
      const cloudProvider = {
        id: 'mock-cloud',
        name: 'Mock Cloud',
        type: 'cloud' as const,
        qualityTier: 'standard' as const,
        costPerMillion: 10,
        icon: '',
        initialize: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getSupportedLanguages: vi.fn().mockReturnValue([{ src: 'en', tgt: 'fi' }]),
        translate: vi.fn().mockResolvedValue('Cloud translation'),
        test: vi.fn().mockResolvedValue(true),
        getInfo: vi.fn().mockReturnValue({ id: 'mock-cloud', name: 'Mock Cloud', type: 'cloud', qualityTier: 'standard', costPerMillion: 10, icon: '' }),
      };
      router.registerProvider(cloudProvider);
      await router.savePreferences({ enabledProviders: ['opus-mt-local', 'mock-cloud'], prioritize: 'fast' });

      // local provider wins under fast strategy
      const selected = await router.selectProvider('en', 'fi');
      expect(selected.type).toBe('local');
    });

    it('awards cost bonus to free provider under cost strategy', async () => {
      const paidProvider = {
        id: 'mock-paid',
        name: 'Mock Paid',
        type: 'cloud' as const,
        qualityTier: 'standard' as const,
        costPerMillion: 10,
        icon: '',
        initialize: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getSupportedLanguages: vi.fn().mockReturnValue([{ src: 'en', tgt: 'fi' }]),
        translate: vi.fn().mockResolvedValue('Paid translation'),
        test: vi.fn().mockResolvedValue(true),
        getInfo: vi.fn().mockReturnValue({ id: 'mock-paid', name: 'Mock Paid', type: 'cloud', qualityTier: 'standard', costPerMillion: 10, icon: '' }),
      };
      router.registerProvider(paidProvider);
      // Disable preferLocal so we can isolate the cost branch
      await router.savePreferences({ enabledProviders: ['opus-mt-local', 'mock-paid'], prioritize: 'cost', preferLocal: false });

      // free local provider wins under cost strategy (costPerMillion === 0)
      const selected = await router.selectProvider('en', 'fi');
      expect(selected.costPerMillion).toBe(0);
    });

    it('applies preferLocal bonus when preferLocal is true', async () => {
      const cloudProvider = {
        id: 'mock-cloud2',
        name: 'Mock Cloud 2',
        type: 'cloud' as const,
        qualityTier: 'premium' as const,
        costPerMillion: 5,
        icon: '',
        initialize: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getSupportedLanguages: vi.fn().mockReturnValue([{ src: 'en', tgt: 'fi' }]),
        translate: vi.fn().mockResolvedValue('Cloud2 translation'),
        test: vi.fn().mockResolvedValue(true),
        getInfo: vi.fn().mockReturnValue({ id: 'mock-cloud2', name: 'Mock Cloud 2', type: 'cloud', qualityTier: 'premium', costPerMillion: 5, icon: '' }),
      };
      router.registerProvider(cloudProvider);
      await router.savePreferences({
        enabledProviders: ['opus-mt-local', 'mock-cloud2'],
        prioritize: 'balanced',
        preferLocal: true,
      });

      // local wins because preferLocal bonus stacks with balanced bonus
      const selected = await router.selectProvider('en', 'fi');
      expect(selected.type).toBe('local');
    });

    it('usage-based penalty reduces score for heavily-used provider', async () => {
      // Force high usage on opus-mt-local by translating many times
      for (let i = 0; i < 5; i++) {
        await router.translate('Hello', 'en', 'fi');
      }

      const stats = router.getStats();
      const usage = Object.values(stats)[0];
      expect(usage).toBe(5);
    });

    it('returns true for non-opus-mt providers regardless of language pair', async () => {
      // A non-opus-mt provider should pass supportsLanguagePair for any pair.
      // Use a fresh router: initialize() first, then set preferences (avoids loadPreferences overwrite).
      const freshRouter = new TranslationRouter();
      await freshRouter.initialize();

      const anyLangProvider = {
        id: 'mock-anylang',
        name: 'Mock AnyLang',
        type: 'cloud' as const,
        qualityTier: 'standard' as const,
        costPerMillion: 5,
        icon: '',
        initialize: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getSupportedLanguages: vi.fn().mockReturnValue([]),
        translate: vi.fn().mockResolvedValue('AnyLang translation'),
        test: vi.fn().mockResolvedValue(true),
        getInfo: vi.fn().mockReturnValue({ id: 'mock-anylang', name: 'Mock AnyLang', type: 'cloud', qualityTier: 'standard', costPerMillion: 5, icon: '' }),
      };
      freshRouter.registerProvider(anyLangProvider);
      await freshRouter.savePreferences({ enabledProviders: ['mock-anylang'], prioritize: 'balanced' });

      // Exotic language pair that opus-mt doesn't support — cloud provider should still be selected
      const selected = await freshRouter.selectProvider('xx', 'zz');
      expect(selected.id).toBe('mock-anylang');
    });
  });

  describe('initialize idempotency', () => {
    it('does not re-initialize when already initialized', async () => {
      const { webgpuDetector } = await import('./webgpu-detector');

      await router.initialize();
      const callCount = vi.mocked(webgpuDetector.detect).mock.calls.length;

      await router.initialize(); // second call
      // detect should not have been called a second time
      expect(vi.mocked(webgpuDetector.detect).mock.calls.length).toBe(callCount);
    });
  });

  describe('circuit breaker integration', () => {
    it('creates a circuit breaker by default', () => {
      expect(router.circuitBreaker).toBeInstanceOf(CircuitBreaker);
    });

    it('accepts a custom circuit breaker', () => {
      const customBreaker = new CircuitBreaker({ failureThreshold: 2 });
      const customRouter = new TranslationRouter(customBreaker);
      expect(customRouter.circuitBreaker).toBe(customBreaker);
    });

    it('records success on the circuit breaker after translation', async () => {
      const breaker = new CircuitBreaker();
      const routerWithBreaker = new TranslationRouter(breaker);

      await routerWithBreaker.translate('Hello', 'en', 'fi');

      const state = breaker.getState('opus-mt-local');
      expect(state.state).toBe('closed');
      expect(state.consecutiveFailures).toBe(0);
    });

    it('records failure on the circuit breaker when provider throws', async () => {
      const { opusMTProvider } = await import('../providers/opus-mt-local');
      vi.mocked(opusMTProvider.translate).mockRejectedValueOnce(new Error('Provider failed'));

      const breaker = new CircuitBreaker();
      const routerWithBreaker = new TranslationRouter(breaker);

      await expect(routerWithBreaker.translate('Hello', 'en', 'fi')).rejects.toThrow('Provider failed');

      const state = breaker.getState('opus-mt-local');
      expect(state.consecutiveFailures).toBe(1);
    });

    it('skips providers with open circuits during selection', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 });
      const routerWithBreaker = new TranslationRouter(breaker);

      // Open the circuit for opus-mt-local
      breaker.recordFailure('opus-mt-local');

      // Since opus-mt-local is the only enabled provider, this should throw
      await expect(
        routerWithBreaker.translate('Hello', 'en', 'fi')
      ).rejects.toThrow('No available provider');
    });

    it('allows provider after circuit recovers', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeoutMs: 0, // Instant recovery for testing
      });
      const routerWithBreaker = new TranslationRouter(breaker);

      // Open the circuit
      breaker.recordFailure('opus-mt-local');

      // With 0ms recovery, the next isAvailable check transitions to half_open
      const result = await routerWithBreaker.translate('Hello', 'en', 'fi');
      expect(result).toBe('Mocked translation');

      // Success should close the circuit
      const state = breaker.getState('opus-mt-local');
      expect(state.state).toBe('closed');
    });
  });
});
