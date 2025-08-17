const { choose, setChooser } = require('../src/lib/fetchStrategy');

test('prefers proxy when chrome runtime exists', () => {
  global.chrome = { runtime: {} };
  expect(choose({})).toBe('proxy');
  delete global.chrome;
});

test('returns direct when noProxy', () => {
  expect(choose({ noProxy: true })).toBe('direct');
});

test('returns local when provider is local-wasm', () => {
  global.chrome = { runtime: {} };
  expect(choose({ provider: 'local-wasm' })).toBe('local');
  delete global.chrome;
});

test('returns local when offline', () => {
  const orig = global.navigator;
  Object.defineProperty(global, 'navigator', { value: { onLine: false }, configurable: true });
  expect(choose({})).toBe('local');
  if (orig) Object.defineProperty(global, 'navigator', { value: orig });
  else delete global.navigator;
});

test('setChooser overrides selection', () => {
  setChooser(() => 'direct');
  global.chrome = { runtime: {} };
  expect(choose({})).toBe('direct');
  setChooser();
  delete global.chrome;
});
