// @jest-environment node

const { createThrottle, approxTokens } = require('../src/throttle.js');

describe('throttle manager', () => {
  let throttle;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    if (!jest.isMockFunction(Math.random)) {
      jest.spyOn(global.Math, 'random').mockReturnValue(0.5);
    }
    mockLogger = {
      debug: jest.fn(),
    };
    global.qwenLogger = { create: () => mockLogger };
    throttle = createThrottle({ requestLimit: 1, tokenLimit: 20, windowMs: 1000 });
  });

  afterEach(() => {
    jest.useRealTimers();
    if (Math.random.mockRestore) Math.random.mockRestore();
    delete global.qwenLogger;
  });

  test('runWithRateLimit queues when limits reached and respects immediate option', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const first = throttle.runWithRateLimit(fn, 'hello', { immediate: true });
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    const second = throttle.runWithRateLimit(fn, 'world');
    const third = throttle.runWithRateLimit(fn, 'another');

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    await expect(first).resolves.toBe('ok');
    await expect(second).resolves.toBe('ok');
    await expect(third).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('runWithRetry retries retryable errors with backoff and jitter', async () => {
    jest.useRealTimers();
    const error = Object.assign(new Error('retry'), { retryable: true, retryAfter: 5 });
    const retryThrottle = createThrottle({ requestLimit: 10, tokenLimit: 100, windowMs: 5 });
    const fn = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success');

    const result = await retryThrottle.runWithRetry(fn, 'text needing tokens', 2, true);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockLogger.debug).toHaveBeenCalledWith('retrying after error', 'retry', 'in', 5, 'ms');
    jest.useFakeTimers();
  });

  test('runWithRetry throws non retryable errors', async () => {
    const error = Object.assign(new Error('fatal'), { retryable: false });
    const fatalThrottle = createThrottle({ requestLimit: 10, tokenLimit: 100, windowMs: 100 });
    const failingFn = jest.fn().mockRejectedValue(error);

    await expect(fatalThrottle.runWithRetry(failingFn, 'fatal case', 2)).rejects.toThrow('fatal');
    expect(failingFn).toHaveBeenCalledTimes(1);
  });

  test('predictiveBatch respects token limits', () => {
    const batches = throttle.predictiveBatch(['Hello world! This is a sentence. Another one.'], 10);
    expect(Array.isArray(batches)).toBe(true);
    const max = Math.max(...batches.map(batch => approxTokens(batch.join(' '))));
    expect(max).toBeLessThanOrEqual(10);
  });

  test('getUsage reports windowed stats', () => {
    throttle.recordUsage(5, 1);
    jest.advanceTimersByTime(400);
    throttle.recordUsage(3, 2);

    const usage = throttle.getUsage();
    expect(usage.requests).toBe(3);
    expect(usage.tokens).toBe(8);
    expect(usage.queue).toBe(0);
  });
});
