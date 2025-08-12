const usageColor = require('../src/usageColor.js');

describe('usageColor', () => {
  test('green up to 50%', () => {
    expect(usageColor(0.0)).toMatch(/hsl\(120,/);
    expect(usageColor(0.5)).toMatch(/hsl\(120,/);
  });

  test('yellow between 50% and 80%', () => {
    expect(usageColor(0.6)).toMatch(/hsl\(60,/);
    expect(usageColor(0.8)).toMatch(/hsl\(60,/);
  });

  test('red over 80%', () => {
    expect(usageColor(0.9)).toMatch(/hsl\(0,/);
  });
});
