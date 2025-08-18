const { isOfflineError } = require('../src/lib/offline.js');

test('detects network errors', () => {
  expect(isOfflineError(new Error('Failed to fetch'))).toBe(true);
});
