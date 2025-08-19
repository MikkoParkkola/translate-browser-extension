const { runWithRateLimit, runWithRetry, configure, getUsage, recordUsage, reset } = require('../src/throttle');

jest.useFakeTimers();

beforeEach(() => {
  reset();
  configure({ requestLimit: 2, tokenLimit: 1000, windowMs: 1000 });
});

afterAll(() => {
  jest.useRealTimers();
});

test('spreads requests over the window', async () => {
  const calls = [];
  const mk = id => () => { calls.push(id); return Promise.resolve(id); };
  runWithRateLimit(mk('a'), 1);
  runWithRateLimit(mk('b'), 1);
  runWithRateLimit(mk('c'), 1);
  await Promise.resolve();
  expect(calls).toEqual(['a']);
  jest.advanceTimersByTime(500);
  await Promise.resolve();
  expect(calls).toEqual(['a', 'b']);
  jest.advanceTimersByTime(500);
  await Promise.resolve();
  expect(calls).toEqual(['a', 'b', 'c']);
});

test('queues when limits exceeded', async () => {
  configure({ requestLimit: 1, tokenLimit: 1000, windowMs: 1000 });
  const fn1 = jest.fn(() => Promise.resolve('first'));
  const fn2 = jest.fn(() => Promise.resolve('second'));
  runWithRateLimit(fn1, '', { immediate: true });
  runWithRateLimit(fn2, '', { immediate: true });
  await Promise.resolve();
  expect(fn1).toHaveBeenCalledTimes(1);
  expect(fn2).not.toHaveBeenCalled();
  expect(getUsage().queue).toBe(1);
  jest.advanceTimersByTime(1000);
  await Promise.resolve();
  expect(fn2).toHaveBeenCalledTimes(1);
});

test('recordUsage and getUsage track totals', () => {
  configure({ requestLimit: 5, tokenLimit: 100, windowMs: 1000 });
  recordUsage(10, 2);
  let usage = getUsage();
  expect(usage.requests).toBe(2);
  expect(usage.tokens).toBe(10);
  expect(usage.totalRequests).toBe(2);
  expect(usage.totalTokens).toBe(10);
  jest.advanceTimersByTime(1001);
  usage = getUsage();
  expect(usage.requests).toBe(0);
  expect(usage.tokens).toBe(0);
  expect(usage.totalRequests).toBe(2);
  expect(usage.totalTokens).toBe(10);
});

test('runWithRetry backs off and stops after max attempts', async () => {
  jest.useRealTimers();
  reset();
  configure({ requestLimit: 5, tokenLimit: 1000, windowMs: 1000 });
  const err = new Error('fail');
  err.retryable = true;
  const fn = jest.fn(() => { throw err; });
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

  await expect(runWithRetry(fn, '', 3)).rejects.toThrow('fail');
  expect(fn).toHaveBeenCalledTimes(3);
  const delays = setTimeoutSpy.mock.calls.map(c => c[1]).filter(ms => ms >= 400);
  expect(delays).toEqual([450, 900]);

  Math.random.mockRestore();
  setTimeoutSpy.mockRestore();
  jest.useFakeTimers();
});

