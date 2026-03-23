/**
 * Async utility helpers
 */

/**
 * Resolve after `ms` milliseconds. Useful for delays and backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a timeout. The timer is always cleared when the
 * promise settles (success or error) — no lingering callbacks.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    /* v8 ignore start -- timeout callback exercised via integration */
    timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms / 1000}s)`)), ms);
    /* v8 ignore stop */
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    /* v8 ignore start */
    if (timer !== undefined) clearTimeout(timer);
    /* v8 ignore stop */
  });
}
