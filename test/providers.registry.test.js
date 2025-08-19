const { createRegistry } = require('../src/lib/providers');

test('createRegistry returns isolated registries', () => {
  const r1 = createRegistry();
  const r2 = createRegistry();
  r1.register('a', { translate: () => {} });
  expect(r2.get('a')).toBeUndefined();
});

test('candidates returns chosen provider first without duplicates', () => {
  const r = createRegistry();
  r.register('a', { translate: () => {} });
  r.register('b', { translate: () => {} });
  r.register('c', { translate: () => {} });
  const order = r.candidates({ provider: 'b' });
  expect(order).toEqual(['b', 'a', 'c']);
  expect(new Set(order).size).toBe(order.length);
});

test('reset clears providers and initialization state', () => {
  const r = createRegistry();
  r.register('a', { translate: () => {} });
  expect(r.isInitialized()).toBe(false);
  r.init();
  expect(r.isInitialized()).toBe(true);
  r.reset();
  expect(r.isInitialized()).toBe(false);
  expect(r.get('a')).toBeUndefined();
  expect(r.candidates()).toEqual([]);
});
