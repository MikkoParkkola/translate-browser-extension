const usageColor = require('../src/usageColor');

describe('usageColor thresholds', () => {
  test.each([
    [0, 'hsl(120,'],
    [0.5, 'hsl(120,'],
    [0.6, 'hsl(60,'],
    [0.8, 'hsl(60,'],
    [0.9, 'hsl(0,'],
    [1, 'hsl(0,']
  ])('maps %p to %s', (ratio, color) => {
    expect(usageColor(ratio)).toContain(color);
  });

  test('clamps ratios outside 0-1', () => {
    expect(usageColor(-0.2)).toContain('hsl(120,');
    expect(usageColor(1.2)).toContain('hsl(0,');
  });
});
