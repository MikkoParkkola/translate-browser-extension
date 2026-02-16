/**
 * Reliability infrastructure tests
 *
 * Tests for keep-alive, circuit breaker cooldown, content script injection
 * retry, and navigation abort controller patterns introduced for P0/P1
 * reliability fixes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Keep-Alive Pattern Tests (pure logic, no chrome dependency)
// ============================================================================

describe('keep-alive pattern', () => {
  let activeCount: number;
  let intervalId: ReturnType<typeof setInterval> | null;
  let pingCount: number;

  function acquireKeepAlive(): void {
    activeCount++;
    if (activeCount === 1 && !intervalId) {
      intervalId = setInterval(() => {
        if (activeCount > 0) pingCount++;
      }, 25);
    }
  }

  function releaseKeepAlive(): void {
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  beforeEach(() => {
    activeCount = 0;
    intervalId = null;
    pingCount = 0;
  });

  afterEach(() => {
    if (intervalId) clearInterval(intervalId);
  });

  it('starts interval on first acquire', () => {
    acquireKeepAlive();
    expect(activeCount).toBe(1);
    expect(intervalId).not.toBeNull();
  });

  it('does not create duplicate intervals on multiple acquires', () => {
    acquireKeepAlive();
    const firstId = intervalId;
    acquireKeepAlive();
    expect(intervalId).toBe(firstId);
    expect(activeCount).toBe(2);
  });

  it('clears interval when last translation completes', () => {
    acquireKeepAlive();
    acquireKeepAlive();
    releaseKeepAlive();
    expect(intervalId).not.toBeNull(); // Still one active
    releaseKeepAlive();
    expect(intervalId).toBeNull(); // All done
    expect(activeCount).toBe(0);
  });

  it('does not go below zero on extra releases', () => {
    acquireKeepAlive();
    releaseKeepAlive();
    releaseKeepAlive(); // Extra
    expect(activeCount).toBe(0);
    expect(intervalId).toBeNull();
  });

  it('pings during active translations', async () => {
    acquireKeepAlive();
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(pingCount).toBeGreaterThan(0);
    releaseKeepAlive();
  });
});

// ============================================================================
// Circuit Breaker Cooldown Tests
// ============================================================================

describe('circuit breaker cooldown', () => {
  let failureCount: number;
  let resetCount: number;
  let cooldownTimer: ReturnType<typeof setTimeout> | null;

  function scheduleCooldown(delayMs: number): void {
    if (cooldownTimer) clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(() => {
      failureCount = 0;
      resetCount = 0;
      cooldownTimer = null;
    }, delayMs);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    failureCount = 0;
    resetCount = 0;
    cooldownTimer = null;
  });

  afterEach(() => {
    if (cooldownTimer) clearTimeout(cooldownTimer);
    vi.useRealTimers();
  });

  it('resets counters after cooldown period', () => {
    failureCount = 3;
    resetCount = 2;
    scheduleCooldown(60_000);

    vi.advanceTimersByTime(60_000);
    expect(failureCount).toBe(0);
    expect(resetCount).toBe(0);
  });

  it('does not reset before cooldown expires', () => {
    failureCount = 3;
    scheduleCooldown(60_000);

    vi.advanceTimersByTime(30_000);
    expect(failureCount).toBe(3);
  });

  it('restarts cooldown on new failure', () => {
    failureCount = 1;
    scheduleCooldown(60_000);

    vi.advanceTimersByTime(30_000);
    failureCount = 2;
    scheduleCooldown(60_000); // Restart

    vi.advanceTimersByTime(30_000);
    expect(failureCount).toBe(2); // Not reset yet (only 30s since restart)

    vi.advanceTimersByTime(30_000);
    expect(failureCount).toBe(0); // Reset after full 60s
  });
});

// ============================================================================
// Content Script Injection Retry Pattern Tests
// ============================================================================

describe('sendMessageToTab retry pattern', () => {
  const mockSendMessage = vi.fn();
  const mockExecuteScript = vi.fn();

  async function sendMessageToTab(tabId: number, message: Record<string, unknown>): Promise<void> {
    try {
      await mockSendMessage(tabId, message);
    } catch (firstError) {
      const errMsg = firstError instanceof Error ? firstError.message : String(firstError);

      if (!errMsg.includes('establish connection') && !errMsg.includes('Receiving end does not exist')) {
        throw firstError;
      }

      await mockExecuteScript({ target: { tabId }, files: ['src/content/index.js'] });
      await new Promise(resolve => setTimeout(resolve, 10));
      await mockSendMessage(tabId, message);
    }
  }

  beforeEach(() => {
    mockSendMessage.mockReset();
    mockExecuteScript.mockReset();
  });

  it('sends message directly when content script is ready', async () => {
    mockSendMessage.mockResolvedValue(undefined);
    await sendMessageToTab(1, { type: 'test' });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it('injects content script on "establish connection" error and retries', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockResolvedValueOnce(undefined);
    mockExecuteScript.mockResolvedValue(undefined);

    await sendMessageToTab(1, { type: 'translatePage' });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['src/content/index.js'],
    });
  });

  it('injects on "Receiving end does not exist" error', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce(undefined);
    mockExecuteScript.mockResolvedValue(undefined);

    await sendMessageToTab(1, { type: 'translatePage' });
    expect(mockExecuteScript).toHaveBeenCalled();
  });

  it('does not inject on other errors', async () => {
    mockSendMessage.mockRejectedValue(new Error('Permission denied'));

    await expect(sendMessageToTab(1, { type: 'test' })).rejects.toThrow('Permission denied');
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it('propagates injection failure', async () => {
    mockSendMessage.mockRejectedValue(new Error('Could not establish connection'));
    mockExecuteScript.mockRejectedValue(new Error('Cannot access chrome:// URL'));

    await expect(sendMessageToTab(1, { type: 'test' })).rejects.toThrow('Cannot access chrome:// URL');
  });
});

// ============================================================================
// Navigation Abort Controller Tests
// ============================================================================

describe('navigation abort controller', () => {
  it('signals abort on simulated beforeunload', () => {
    const controller = new AbortController();
    const { signal } = controller;

    expect(signal.aborted).toBe(false);

    // Simulate what beforeunload handler does
    controller.abort();

    expect(signal.aborted).toBe(true);
  });

  it('batch loop checks abort signal', async () => {
    const controller = new AbortController();
    const { signal } = controller;
    const processed: number[] = [];

    // Simulate batch translation loop with abort check
    const batches = [1, 2, 3, 4, 5];
    for (const batch of batches) {
      if (signal.aborted) break;
      processed.push(batch);
      // Abort after second batch (simulating navigation)
      if (batch === 2) controller.abort();
    }

    expect(processed).toEqual([1, 2]);
    expect(signal.aborted).toBe(true);
  });

  it('undo aborts in-flight translation', () => {
    let controller: AbortController | null = new AbortController();
    const signal = controller.signal;

    // Simulate undo: abort and null out
    controller.abort();
    controller = null;

    expect(signal.aborted).toBe(true);
    expect(controller).toBeNull();
  });

  it('new page translation replaces old abort controller', () => {
    let controller: AbortController | null = new AbortController();
    const firstSignal = controller.signal;

    // Start new translation: abort old, create new
    controller.abort();
    controller = new AbortController();
    const secondSignal = controller.signal;

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
  });
});

// ============================================================================
// Glossary Load Race Condition Tests (promise guard pattern)
// ============================================================================

describe('glossary load race guard', () => {
  it('deduplicates concurrent loads into single call', async () => {
    let loadCount = 0;
    let cached: Record<string, string> | null = null;
    let loadingPromise: Promise<Record<string, string>> | null = null;

    async function loadGlossary(): Promise<Record<string, string>> {
      if (cached !== null) return cached;
      if (loadingPromise) return loadingPromise;

      loadingPromise = (async () => {
        loadCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        cached = { hello: 'world' };
        loadingPromise = null;
        return cached;
      })();

      return loadingPromise;
    }

    // Fire 3 concurrent loads
    const [r1, r2, r3] = await Promise.all([
      loadGlossary(),
      loadGlossary(),
      loadGlossary(),
    ]);

    expect(loadCount).toBe(1); // Only one actual load
    expect(r1).toEqual({ hello: 'world' });
    expect(r2).toBe(r1); // Same reference
    expect(r3).toBe(r1);
  });

  it('returns cached value on subsequent calls', async () => {
    let cached: Record<string, string> | null = { cached: 'yes' };
    let loadingPromise: Promise<Record<string, string>> | null = null;
    let loadCalled = false;

    async function loadGlossary(): Promise<Record<string, string>> {
      if (cached !== null) return cached;
      if (loadingPromise) return loadingPromise;
      loadCalled = true;
      return {};
    }

    const result = await loadGlossary();
    expect(result).toEqual({ cached: 'yes' });
    expect(loadCalled).toBe(false);
  });

  it('handles load error gracefully', async () => {
    let cached: Record<string, string> | null = null;
    let loadingPromise: Promise<Record<string, string>> | null = null;

    async function loadGlossary(): Promise<Record<string, string>> {
      if (cached !== null) return cached;
      if (loadingPromise) return loadingPromise;

      loadingPromise = (async () => {
        try {
          throw new Error('Network error');
        } catch {
          cached = {};
        }
        loadingPromise = null;
        return cached!;
      })();

      return loadingPromise;
    }

    const result = await loadGlossary();
    expect(result).toEqual({}); // Falls back to empty
  });
});

// ============================================================================
// Offscreen Document TOCTOU Guard Tests
// ============================================================================

describe('offscreen document creation lock', () => {
  it('lock set synchronously before async creation', async () => {
    let lock: Promise<void> | null = null;
    let creationStarted = false;
    let concurrentCallSawLock = false;

    async function ensureOffscreen(): Promise<void> {
      if (lock) {
        concurrentCallSawLock = true;
        await lock;
        return;
      }

      // Simulate async check (getContexts)
      await new Promise(resolve => setTimeout(resolve, 10));

      // Re-check after async gap
      if (lock) {
        concurrentCallSawLock = true;
        await lock;
        return;
      }

      // Set lock SYNCHRONOUSLY before async create
      const createPromise = (async () => {
        creationStarted = true;
        await new Promise(resolve => setTimeout(resolve, 50));
      })();
      lock = createPromise;

      await createPromise;
      lock = null;
    }

    // Fire two concurrent calls
    const p1 = ensureOffscreen();
    // Small delay so p1 passes first check but is in getContexts await
    await new Promise(resolve => setTimeout(resolve, 5));
    const p2 = ensureOffscreen();

    await Promise.all([p1, p2]);
    expect(creationStarted).toBe(true);
    // p2 should have seen the lock at either first or second check
    expect(concurrentCallSawLock).toBe(true);
  });
});
