export interface KeepAliveLogger {
  info: (message: string, ...args: unknown[]) => void;
}

export interface CreateKeepAliveControllerOptions {
  ping: () => void;
  log: KeepAliveLogger;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface KeepAliveController {
  acquireKeepAlive: () => void;
  releaseKeepAlive: () => void;
  getActiveTranslationCount: () => number;
}

export function createKeepAliveController({
  ping,
  log,
  intervalMs = 25000,
  setIntervalFn,
  clearIntervalFn,
}: CreateKeepAliveControllerOptions): KeepAliveController {
  let activeTranslationCount = 0;
  let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  function acquireKeepAlive(): void {
    activeTranslationCount++;

    if (activeTranslationCount === 1 && !keepAliveInterval) {
      /* v8 ignore start -- timer callback */
      keepAliveInterval = (setIntervalFn ?? setInterval)(() => {
        if (activeTranslationCount > 0) {
          ping();
        }
      }, intervalMs);
      /* v8 ignore stop */

      log.info(`Keep-alive started (${activeTranslationCount} active translations)`);
    }
  }

  function releaseKeepAlive(): void {
    activeTranslationCount = Math.max(0, activeTranslationCount - 1);

    if (activeTranslationCount === 0 && keepAliveInterval) {
      (clearIntervalFn ?? clearInterval)(keepAliveInterval);
      keepAliveInterval = null;
      log.info('Keep-alive stopped (no active translations)');
    }
  }

  return {
    acquireKeepAlive,
    releaseKeepAlive,
    getActiveTranslationCount: () => activeTranslationCount,
  };
}
