const { runWithRateLimit, configure, getUsage } = require('../src/throttle');

jest.useFakeTimers();

beforeEach(() => {
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

