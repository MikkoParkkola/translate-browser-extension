// @jest-environment node
const { createThrottle } = require('../src/throttle');

jest.useFakeTimers();

afterAll(() => {
  jest.useRealTimers();
});

describe('shared throttle across providers', () => {
  test('queues requests when limit exceeded', async () => {
    const shared = createThrottle({ requestLimit: 1, windowMs: 1000 });
    const order = [];

    shared.runWithRateLimit(() => Promise.resolve(order.push('p1')), 'a', { immediate: true });
    shared.runWithRateLimit(() => Promise.resolve(order.push('p2')), 'b', { immediate: true });

    await Promise.resolve();
    expect(order).toEqual(['p1']);
    expect(shared.getUsage().queue).toBe(1);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(order).toEqual(['p1', 'p2']);
    expect(shared.getUsage().queue).toBe(0);
  });
});
