const { isOfflineError } = require('../src/lib/offline.js');

describe('isOfflineError', () => {
  test('detects network errors', () => {
    expect(isOfflineError(new Error('Failed to fetch'))).toBe(true);
  });

  test('handles missing navigator', () => {
    const original = global.navigator;
    try {
      delete global.navigator;
      expect(isOfflineError(new Error('Failed to fetch'))).toBe(true);
      expect(isOfflineError(new Error('Oops'))).toBe(false);
    } finally {
      global.navigator = original;
    }
  });
});
