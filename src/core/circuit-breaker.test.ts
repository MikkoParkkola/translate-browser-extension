/**
 * Circuit Breaker unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeoutMs: 30_000,
    });
  });

  describe('initial state', () => {
    it('returns closed state for unknown provider', () => {
      const state = breaker.getState('test-provider');
      expect(state.state).toBe('closed');
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastFailureTime).toBeNull();
    });

    it('reports unknown provider as available', () => {
      expect(breaker.isAvailable('test-provider')).toBe(true);
    });

    it('returns empty summary when no circuits exist', () => {
      expect(breaker.getSummary()).toEqual({});
    });
  });

  describe('recording successes', () => {
    it('keeps circuit closed on success', () => {
      breaker.recordSuccess('test-provider');
      const state = breaker.getState('test-provider');
      expect(state.state).toBe('closed');
    });

    it('resets consecutive failures on success', () => {
      breaker.recordFailure('test-provider');
      breaker.recordFailure('test-provider');
      breaker.recordSuccess('test-provider');
      const state = breaker.getState('test-provider');
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('recording failures', () => {
    it('increments consecutive failures', () => {
      breaker.recordFailure('test-provider');
      expect(breaker.getState('test-provider').consecutiveFailures).toBe(1);

      breaker.recordFailure('test-provider');
      expect(breaker.getState('test-provider').consecutiveFailures).toBe(2);
    });

    it('stays closed below threshold', () => {
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure('test-provider');
      }
      expect(breaker.getState('test-provider').state).toBe('closed');
      expect(breaker.isAvailable('test-provider')).toBe(true);
    });

    it('opens circuit at failure threshold', () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('test-provider');
      }
      expect(breaker.getState('test-provider').state).toBe('open');
      expect(breaker.isAvailable('test-provider')).toBe(false);
    });

    it('opens circuit beyond failure threshold', () => {
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure('test-provider');
      }
      expect(breaker.getState('test-provider').state).toBe('open');
    });

    it('records lastFailureTime', () => {
      const now = 1000;
      breaker.recordFailure('test-provider', now);
      expect(breaker.getState('test-provider').lastFailureTime).toBe(1000);
    });
  });

  describe('circuit state transitions', () => {
    it('transitions from closed to open after threshold failures', () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('test-provider', 1000 + i);
      }
      expect(breaker.getState('test-provider').state).toBe('open');
    });

    it('transitions from open to half_open after recovery timeout', () => {
      const failTime = 1000;
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('test-provider', failTime);
      }
      expect(breaker.isAvailable('test-provider', failTime)).toBe(false);

      // Just before timeout - still open
      expect(breaker.isAvailable('test-provider', failTime + 29_999)).toBe(false);

      // At timeout - transitions to half_open
      expect(breaker.isAvailable('test-provider', failTime + 30_000)).toBe(true);
      expect(breaker.getState('test-provider').state).toBe('half_open');
    });

    it('transitions from half_open to closed on probe success', () => {
      const failTime = 1000;
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('test-provider', failTime);
      }

      // Transition to half_open
      breaker.isAvailable('test-provider', failTime + 30_000);

      // Probe succeeds
      breaker.recordSuccess('test-provider');
      expect(breaker.getState('test-provider').state).toBe('closed');
      expect(breaker.getState('test-provider').consecutiveFailures).toBe(0);
    });

    it('transitions from half_open to open on probe failure', () => {
      const failTime = 1000;
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('test-provider', failTime);
      }

      // Transition to half_open
      breaker.isAvailable('test-provider', failTime + 30_000);
      expect(breaker.getState('test-provider').state).toBe('half_open');

      // Probe fails
      breaker.recordFailure('test-provider', failTime + 31_000);
      expect(breaker.getState('test-provider').state).toBe('open');
    });
  });

  describe('multiple providers', () => {
    it('tracks circuits independently per provider', () => {
      // Open circuit for provider A
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('provider-a');
      }

      // Provider B should be unaffected
      expect(breaker.isAvailable('provider-a')).toBe(false);
      expect(breaker.isAvailable('provider-b')).toBe(true);
    });

    it('returns all circuits in summary', () => {
      breaker.recordFailure('provider-a');
      breaker.recordFailure('provider-b');

      const summary = breaker.getSummary();
      expect(Object.keys(summary)).toContain('provider-a');
      expect(Object.keys(summary)).toContain('provider-b');
    });
  });

  describe('reset', () => {
    it('resets a single provider circuit', () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('test-provider');
      }
      expect(breaker.isAvailable('test-provider')).toBe(false);

      breaker.reset('test-provider');
      expect(breaker.isAvailable('test-provider')).toBe(true);
      expect(breaker.getState('test-provider').state).toBe('closed');
    });

    it('resetAll clears all circuits', () => {
      breaker.recordFailure('provider-a');
      breaker.recordFailure('provider-b');

      breaker.resetAll();
      expect(breaker.getSummary()).toEqual({});
    });
  });

  describe('custom configuration', () => {
    it('respects custom failure threshold', () => {
      const custom = new CircuitBreaker({ failureThreshold: 2 });

      custom.recordFailure('test');
      expect(custom.isAvailable('test')).toBe(true);

      custom.recordFailure('test');
      expect(custom.isAvailable('test')).toBe(false);
    });

    it('respects custom recovery timeout', () => {
      const custom = new CircuitBreaker({
        failureThreshold: 1,
        recoveryTimeoutMs: 5_000,
      });

      custom.recordFailure('test', 1000);
      expect(custom.isAvailable('test', 1000)).toBe(false);

      // Before custom timeout
      expect(custom.isAvailable('test', 5_999)).toBe(false);

      // At custom timeout
      expect(custom.isAvailable('test', 6_000)).toBe(true);
    });
  });

  describe('state immutability', () => {
    it('getState returns a copy, not the internal state', () => {
      breaker.recordFailure('test-provider');
      const state = breaker.getState('test-provider');
      state.consecutiveFailures = 999;

      // Internal state should not be modified
      expect(breaker.getState('test-provider').consecutiveFailures).toBe(1);
    });

    it('getSummary returns copies of state', () => {
      breaker.recordFailure('test-provider');
      const summary = breaker.getSummary();
      summary['test-provider'].consecutiveFailures = 999;

      expect(breaker.getState('test-provider').consecutiveFailures).toBe(1);
    });
  });
});
