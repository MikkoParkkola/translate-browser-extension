const { runWithRateLimit, configure } = require('../src/throttle');

jest.useFakeTimers();

test('adaptive throttle delays after half usage', async () => {
  configure({ requestLimit: 4, tokenLimit: 1000, windowMs: 1000 });
  const calls = [];
  const mk = id => () => { calls.push(id); return Promise.resolve(id); };
  runWithRateLimit(mk('a'), 1);
  runWithRateLimit(mk('b'), 1);
  runWithRateLimit(mk('c'), 1);
  runWithRateLimit(mk('d'), 1);
  await Promise.resolve();
  expect(calls).toEqual(['a', 'b', 'c']);
  jest.advanceTimersByTime(250);
  await Promise.resolve();
  expect(calls).toEqual(['a', 'b', 'c', 'd']);
  jest.useRealTimers();
});
