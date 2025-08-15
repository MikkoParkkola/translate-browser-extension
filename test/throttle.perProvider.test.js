const { createThrottle } = require('../src/throttle');

test('separate throttle instances track independently', async () => {
  const t1 = createThrottle({ requestLimit: 1, windowMs: 1000 });
  const t2 = createThrottle({ requestLimit: 1, windowMs: 1000 });
  await Promise.all([
    t1.runWithRateLimit(() => Promise.resolve(), '', { immediate: true }),
    t2.runWithRateLimit(() => Promise.resolve(), '', { immediate: true })
  ]);
  expect(t1.getUsage().requests).toBe(1);
  expect(t2.getUsage().requests).toBe(1);
});
