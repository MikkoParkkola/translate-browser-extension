// @jest-environment node
const { chooseDefault } = require('../src/translator/providers');

describe('chooseDefault provider mapping', () => {
  const cases = [
    ['https://api.openai.com/v1', 'openai'],
    ['https://api.deepl.com', 'deepl'],
    ['https://translation.googleapis.com', 'google'],
    ['https://openrouter.ai/api/v1', 'openrouter'],
    ['https://api.anthropic.com', 'anthropic'],
    ['https://api.mistral.ai', 'mistral'],
    ['http://localhost:11434', 'ollama'],
  ];

  test.each(cases)('maps %s to %s', (endpoint, expected) => {
    expect(chooseDefault({ endpoint })).toBe(expected);
  });

  test('falls back to dashscope for unknown endpoints', () => {
    expect(chooseDefault({ endpoint: 'https://example.com' })).toBe('dashscope');
  });
});
