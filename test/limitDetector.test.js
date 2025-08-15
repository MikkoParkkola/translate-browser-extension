const { detectTokenLimit, detectRequestLimit } = require('../src/limitDetector');

describe('limitDetector', () => {
  test('detectTokenLimit finds threshold', async () => {
    const limit = 2000;
    const translate = async text => {
      if (text.length > limit) throw new Error('limit');
      return 'ok';
    };
    const res = await detectTokenLimit(translate, { start: 100, max: 4096 });
    expect(res).toBe(limit);
  });

  test('detectRequestLimit finds request ceiling', async () => {
    const limit = 5;
    const translate = async i => {
      if (i >= limit) throw new Error('429');
      return 'ok';
    };
    const res = await detectRequestLimit(translate, { start: 1, max: 10 });
    expect(res).toBe(limit);
  });
});
