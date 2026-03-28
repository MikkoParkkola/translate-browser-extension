import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKeepAliveController } from './keep-alive-controller';

function createLogger() {
  return {
    info: vi.fn(),
  };
}

describe('keep-alive-controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts the interval on the first acquire and pings while active', async () => {
    const ping = vi.fn();
    const log = createLogger();
    const controller = createKeepAliveController({
      ping,
      log,
      intervalMs: 25,
    });

    controller.acquireKeepAlive();

    expect(controller.getActiveTranslationCount()).toBe(1);
    expect(log.info).toHaveBeenCalledWith('Keep-alive started (1 active translations)');

    await vi.advanceTimersByTimeAsync(26);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate intervals for overlapping acquires', async () => {
    const ping = vi.fn();
    const log = createLogger();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const controller = createKeepAliveController({
      ping,
      log,
      intervalMs: 25,
    });

    controller.acquireKeepAlive();
    controller.acquireKeepAlive();

    expect(controller.getActiveTranslationCount()).toBe(2);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(26);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('keeps the interval alive until the final release', async () => {
    const ping = vi.fn();
    const log = createLogger();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const controller = createKeepAliveController({
      ping,
      log,
      intervalMs: 25,
    });

    controller.acquireKeepAlive();
    controller.acquireKeepAlive();
    controller.releaseKeepAlive();

    expect(controller.getActiveTranslationCount()).toBe(1);
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(26);
    expect(ping).toHaveBeenCalledTimes(1);

    controller.releaseKeepAlive();

    expect(controller.getActiveTranslationCount()).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenLastCalledWith('Keep-alive stopped (no active translations)');

    await vi.advanceTimersByTimeAsync(50);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('clamps extra releases at zero without restarting or re-clearing', () => {
    const ping = vi.fn();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const controller = createKeepAliveController({
      ping,
      log: createLogger(),
      intervalMs: 25,
    });

    controller.acquireKeepAlive();
    controller.releaseKeepAlive();
    controller.releaseKeepAlive();

    expect(controller.getActiveTranslationCount()).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
