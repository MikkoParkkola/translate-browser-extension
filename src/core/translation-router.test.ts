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
