// Test if translator can be imported without hanging
describe('Translator import test', () => {
  test('should import translator without hanging', () => {
    expect(() => {
      const translator = require('../src/translator.js');
      expect(translator).toBeDefined();
    }).not.toThrow();
  });
});