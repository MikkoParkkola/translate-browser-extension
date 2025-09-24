const TranslationProcessor = require('../src/core/translation-processor.js');

describe('TranslationProcessor', () => {
  let processor;
  const logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const errorHandler = { handleError: jest.fn() };

  beforeEach(() => {
    window.qwenTranslateBatch = jest.fn(async () => ({ text: 'Hola mundo' }));
    processor = new TranslationProcessor(logger, null, errorHandler);
  });

  afterEach(() => {
    delete window.qwenTranslateBatch;
    jest.clearAllMocks();
  });

  test('passes configuration metadata to translation requests', async () => {
    await processor.initialize({
      provider: 'openai',
      providerOrder: ['qwen'],
      endpoints: { qwen: 'https://dashscope-intl.aliyuncs.com/api/v1' },
      apiEndpoint: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      detector: 'google',
      tokenBudget: 500,
      parallel: 'auto',
      failover: true,
      debug: true,
    });

    const result = await processor.translateTexts(['Hello world']);

    expect(window.qwenTranslateBatch).toHaveBeenCalledTimes(1);
    expect(window.qwenTranslateBatch).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      providerOrder: ['openai', 'qwen'],
      endpoints: expect.objectContaining({
        openai: 'https://api.openai.com/v1',
        qwen: 'https://dashscope-intl.aliyuncs.com/api/v1',
      }),
      model: 'gpt-5-mini',
      endpoint: 'https://api.openai.com/v1',
      detector: 'google',
      autoInit: true,
      failover: true,
      tokenBudget: 500,
      debug: true,
    }));
    expect(result).toEqual({ 'Hello world': 'Hola mundo' });
  });
});
