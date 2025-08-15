const Providers = require('../src/lib/providers');
const { initProviders, isInitialized, ensureProviders, resetProviders } = require('../src/providers');

afterEach(() => {
  resetProviders();
});

test('initProviders keeps existing entries', () => {
  const custom = { translate: () => 'x' };
  Providers.register('qwen', custom);
  initProviders();
  expect(Providers.get('qwen')).toBe(custom);
});

test('isInitialized reflects initialization state', () => {
  expect(isInitialized()).toBe(false);
  initProviders();
  expect(isInitialized()).toBe(true);
});

test('ensureProviders initializes once', () => {
  expect(ensureProviders()).toBe(true);
  expect(isInitialized()).toBe(true);
  expect(ensureProviders()).toBe(false);
});
