const { createRegistry } = require('../src/lib/providers');

test('createRegistry returns isolated registries', () => {
  const r1 = createRegistry();
  const r2 = createRegistry();
  r1.register('a', { translate: () => {} });
  expect(r2.get('a')).toBeUndefined();
});
