// Test that local model is properly configured
describe('Local model configuration', () => {
  test('should define local model provider but keep remote default', async () => {
    const { qwenLoadConfig } = require('../src/config.js');
    const config = await qwenLoadConfig();

    expect(config.providerOrder[0]).toBe('google-free');
    expect(config.providers['hunyuan-local']).toBeDefined();
    expect(config.providers['hunyuan-local'].enabled).toBe(false);
    expect(config.providers['hunyuan-local'].charLimit).toBe(0); // Unlimited
    expect(config.providers['hunyuan-local'].label).toBe('Local Model (Hunyuan-MT-7B)');
  });
});
