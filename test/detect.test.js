const { detectLocal } = require('../src/lib/detect.js');

describe('detectLocal short strings', () => {
  test('detects single Japanese character', () => {
    const r = detectLocal('あ');
    expect(r.lang).toBe('ja');
  });

  test('returns undefined when text shorter than minLength', () => {
    const r = detectLocal('あ', { minLength: 2 });
    expect(r.lang).toBeUndefined();
    expect(r.confidence).toBe(0);
  });

  test('detects when text meets minLength', () => {
    const r = detectLocal('hi', { minLength: 2 });
    expect(r.lang).toBe('en');
  });

  test('returns undefined when confidence below sensitivity', () => {
    const r = detectLocal('h?', { sensitivity: 0.6 });
    expect(r.lang).toBeUndefined();
  });

  test('returns undefined when no signal characters present', () => {
    const r = detectLocal('!!!');
    expect(r.lang).toBeUndefined();
    expect(r.confidence).toBe(0);
  });
});
