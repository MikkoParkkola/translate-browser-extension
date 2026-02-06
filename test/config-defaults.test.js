// Test the default configuration values
describe('Config defaults', () => {
  test('should default to google-free provider with local fallback defined', () => {
    const { defaultCfg } = require('../src/config.js');

    expect(defaultCfg.providerOrder[0]).toBe('google-free');
    expect(defaultCfg.providers['google-free']).toBeDefined();
    expect(defaultCfg.providers['google-free'].enabled).toBe(true);

    expect(defaultCfg.providers['hunyuan-local']).toBeDefined();
    expect(defaultCfg.providers['hunyuan-local'].enabled).toBe(false);
  });
});
