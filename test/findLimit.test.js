const findLimit = require('../src/findLimit');

describe('findLimit', () => {
  test('returns highest passing value before failure', async () => {
    const limit = 1000;
    let calls = 0;
    const check = async n => {
      calls++;
      return n <= limit;
    };
    const res = await findLimit(check, { start: 10, max: 4096 });
    expect(res).toBe(limit);
    expect(calls).toBeGreaterThan(0);
  });

  test('returns 0 when even smallest value fails', async () => {
    const check = async () => false;
    const res = await findLimit(check, { start: 1, max: 100 });
    expect(res).toBe(0);
  });

  test('caps at max when all values pass', async () => {
    const check = async () => true;
    const res = await findLimit(check, { start: 1, max: 123 });
    expect(res).toBe(123);
  });

  test('treats exceptions as failure', async () => {
    const limit = 50;
    const check = async n => {
      if (n > limit) throw new Error('boom');
      return true;
    };
    const res = await findLimit(check, { start: 1, max: 100 });
    expect(res).toBe(limit);
  });
});
