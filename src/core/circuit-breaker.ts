/**
 * Circuit Breaker for translation providers.
 *
 * Prevents cascading failures by tracking consecutive errors per provider
 * and temporarily skipping providers that are consistently failing.
 *
 * States:
 *   CLOSED   - Normal operation, requests pass through
 *   OPEN     - Provider is failing, requests are blocked
 *   HALF_OPEN - Allowing a single probe request to test recovery
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Milliseconds to wait before allowing a probe request (default: 30000) */
  recoveryTimeoutMs: number;
}

export interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  lastProbeTime: number | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
};

export class CircuitBreaker {
  private circuits = new Map<string, CircuitBreakerState>();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the current state for a provider.
   * Creates a new CLOSED circuit if none exists.
   */
  getState(providerId: string): CircuitBreakerState {
    let circuit = this.circuits.get(providerId);
    if (!circuit) {
      circuit = {
        state: 'closed',
        consecutiveFailures: 0,
        lastFailureTime: null,
        lastProbeTime: null,
      };
      this.circuits.set(providerId, circuit);
    }
    return { ...circuit };
  }

  /**
   * Check if a provider is available (circuit is not open).
   * Transitions OPEN -> HALF_OPEN when recovery timeout has elapsed.
   *
   * @param now - Current timestamp (injectable for testing)
   */
  isAvailable(providerId: string, now: number = Date.now()): boolean {
    const circuit = this.circuits.get(providerId);
    if (!circuit) return true; // No circuit = never failed = available

    if (circuit.state === 'closed') return true;

    if (circuit.state === 'open') {
      // Check if recovery timeout has elapsed
      const elapsed = now - (circuit.lastFailureTime ?? 0);
      if (elapsed >= this.config.recoveryTimeoutMs) {
        // Transition to half-open, allow one probe
        circuit.state = 'half_open';
        circuit.lastProbeTime = now;
        return true;
      }
      return false;
    }

    // half_open: allow the probe request through
    return true;
  }

  /**
   * Record a successful request for a provider.
   * Resets the circuit to CLOSED.
   */
  recordSuccess(providerId: string): void {
    const circuit = this.circuits.get(providerId);
    if (!circuit) return;

    circuit.state = 'closed';
    circuit.consecutiveFailures = 0;
    circuit.lastFailureTime = null;
    circuit.lastProbeTime = null;
  }

  /**
   * Record a failed request for a provider.
   * Increments consecutive failures and may open the circuit.
   *
   * @param now - Current timestamp (injectable for testing)
   */
  recordFailure(providerId: string, now: number = Date.now()): void {
    let circuit = this.circuits.get(providerId);
    if (!circuit) {
      circuit = {
        state: 'closed',
        consecutiveFailures: 0,
        lastFailureTime: null,
        lastProbeTime: null,
      };
      this.circuits.set(providerId, circuit);
    }

    circuit.consecutiveFailures++;
    circuit.lastFailureTime = now;

    // If in half_open and probe failed, reopen
    if (circuit.state === 'half_open') {
      circuit.state = 'open';
      return;
    }

    // If threshold reached, open the circuit
    if (circuit.consecutiveFailures >= this.config.failureThreshold) {
      circuit.state = 'open';
    }
  }

  /**
   * Manually reset a provider's circuit to CLOSED.
   */
  reset(providerId: string): void {
    this.circuits.delete(providerId);
  }

  /**
   * Reset all circuits.
   */
  resetAll(): void {
    this.circuits.clear();
  }

  /**
   * Get a summary of all circuits for diagnostics.
   */
  getSummary(): Record<string, CircuitBreakerState> {
    const summary: Record<string, CircuitBreakerState> = {};
    for (const [id, state] of this.circuits) {
      summary[id] = { ...state };
    }
    return summary;
  }
}
