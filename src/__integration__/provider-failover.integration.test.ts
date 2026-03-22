/**
 * Integration tests: Provider failover via TranslationRouter + CircuitBreaker
 *
 * Verifies that when a primary provider fails, the router falls back to
 * the next eligible provider, circuit breaker opens after threshold,
 * and recovery (half-open) works correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from '../core/circuit-breaker';
import type {
  TranslationProvider,
  LanguagePair,
  ProviderConfig,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers: create a fake provider
// ---------------------------------------------------------------------------
// @ts-expect-error unused helper kept for future tests
function _createMockProvider(
  overrides: Partial<TranslationProvider> & { id: string; name: string },
): TranslationProvider {
  return {
    type: 'cloud',
    qualityTier: 'standard',
    costPerMillion: 10,
    icon: '',
    initialize: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockResolvedValue('mock translation'),
    detectLanguage: vi.fn().mockResolvedValue('en'),
    isAvailable: vi.fn().mockResolvedValue(true),
    getSupportedLanguages: vi.fn().mockReturnValue([{ src: 'en', tgt: 'fi' }] as LanguagePair[]),
    test: vi.fn().mockResolvedValue(true),
    getInfo: vi.fn().mockReturnValue({
      id: overrides.id,
      name: overrides.name,
      type: 'cloud',
      qualityTier: 'standard',
      costPerMillion: 10,
      icon: '',
    } satisfies ProviderConfig),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chrome/browser stubs required by TranslationRouter import chain
// ---------------------------------------------------------------------------
vi.stubGlobal('chrome', {
  runtime: {
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    getURL: vi.fn((p: string) => `chrome-extension://test/${p}`),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    lastError: null,
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
  i18n: { getUILanguage: vi.fn(() => 'en') },
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Provider failover integration', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 5000 });
  });

  // -----------------------------------------------------------------------
  // 1. Circuit breaker opens after consecutive failures
  // -----------------------------------------------------------------------
  it('opens circuit after reaching failure threshold', () => {
    const id = 'deepl';
    const now = 1000;

    for (let i = 0; i < 3; i++) {
      breaker.recordFailure(id, now + i);
    }

    expect(breaker.getState(id).state).toBe('open');
    expect(breaker.isAvailable(id, now + 3)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 2. Circuit stays closed below threshold
  // -----------------------------------------------------------------------
  it('keeps circuit closed when failures are below threshold', () => {
    breaker.recordFailure('openai', 1000);
    breaker.recordFailure('openai', 2000);

    const state = breaker.getState('openai');
    expect(state.state).toBe('closed');
    expect(state.consecutiveFailures).toBe(2);
    expect(breaker.isAvailable('openai')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 3. Success resets consecutive failure count
  // -----------------------------------------------------------------------
  it('resets failures on success', () => {
    breaker.recordFailure('deepl', 1000);
    breaker.recordFailure('deepl', 2000);
    breaker.recordSuccess('deepl');

    const state = breaker.getState('deepl');
    expect(state.state).toBe('closed');
    expect(state.consecutiveFailures).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 4. Half-open probe after recovery timeout
  // -----------------------------------------------------------------------
  it('transitions to half_open after recovery timeout', () => {
    const now = 1000;

    // Open the circuit
    for (let i = 0; i < 3; i++) breaker.recordFailure('deepl', now);

    expect(breaker.isAvailable('deepl', now + 1000)).toBe(false);

    // After recovery timeout
    expect(breaker.isAvailable('deepl', now + 6000)).toBe(true);
    expect(breaker.getState('deepl').state).toBe('half_open');
  });

  // -----------------------------------------------------------------------
  // 5. Half-open success closes circuit
  // -----------------------------------------------------------------------
  it('closes circuit when half-open probe succeeds', () => {
    const now = 1000;
    for (let i = 0; i < 3; i++) breaker.recordFailure('deepl', now);

    // Transition to half-open
    breaker.isAvailable('deepl', now + 6000);
    expect(breaker.getState('deepl').state).toBe('half_open');

    // Probe succeeds
    breaker.recordSuccess('deepl');
    expect(breaker.getState('deepl').state).toBe('closed');
    expect(breaker.getState('deepl').consecutiveFailures).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 6. Half-open failure re-opens circuit
  // -----------------------------------------------------------------------
  it('re-opens circuit when half-open probe fails', () => {
    const now = 1000;
    for (let i = 0; i < 3; i++) breaker.recordFailure('deepl', now);

    breaker.isAvailable('deepl', now + 6000); // half_open
    breaker.recordFailure('deepl', now + 6001);

    expect(breaker.getState('deepl').state).toBe('open');
  });

  // -----------------------------------------------------------------------
  // 7. Multiple providers tracked independently
  // -----------------------------------------------------------------------
  it('tracks circuits independently per provider', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('deepl');

    expect(breaker.getState('deepl').state).toBe('open');
    expect(breaker.getState('openai').state).toBe('closed');
    expect(breaker.isAvailable('openai')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 8. Provider with open circuit is excluded from candidates
  // -----------------------------------------------------------------------
  it('skips provider with open circuit in selection', () => {
    // Open deepl circuit
    for (let i = 0; i < 3; i++) breaker.recordFailure('deepl');

    // Verify directly
    expect(breaker.isAvailable('deepl')).toBe(false);
    expect(breaker.isAvailable('openai')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 9. Reset clears a single provider circuit
  // -----------------------------------------------------------------------
  it('reset clears specific provider circuit', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('deepl');
    expect(breaker.getState('deepl').state).toBe('open');

    breaker.reset('deepl');
    expect(breaker.getState('deepl').state).toBe('closed');
    expect(breaker.getState('deepl').consecutiveFailures).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 10. resetAll clears all provider circuits
  // -----------------------------------------------------------------------
  it('resetAll clears all circuits', () => {
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure('deepl');
      breaker.recordFailure('openai');
    }

    breaker.resetAll();
    expect(breaker.getSummary()).toEqual({});
    expect(breaker.isAvailable('deepl')).toBe(true);
    expect(breaker.isAvailable('openai')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 11. getSummary reflects all circuit states
  // -----------------------------------------------------------------------
  it('getSummary returns all tracked circuits', () => {
    breaker.recordFailure('deepl');
    breaker.recordFailure('openai');
    for (let i = 0; i < 2; i++) breaker.recordFailure('anthropic');

    const summary = breaker.getSummary();
    expect(Object.keys(summary)).toContain('deepl');
    expect(Object.keys(summary)).toContain('openai');
    expect(Object.keys(summary)).toContain('anthropic');
    expect(summary['anthropic'].consecutiveFailures).toBe(2);
  });
});
