const { choose, setChooser } = require('../src/lib/fetchStrategy');

test('prefers proxy when chrome runtime exists', () => {
  global.chrome = { runtime: {} };
  expect(choose({})).toBe('proxy');
  delete global.chrome;
});

test('returns direct when noProxy', () => {
  expect(choose({ noProxy: true })).toBe('direct');
});

test('setChooser overrides selection', () => {
  setChooser(() => 'direct');
  global.chrome = { runtime: {} };
  expect(choose({})).toBe('direct');
  setChooser();
  delete global.chrome;
});
