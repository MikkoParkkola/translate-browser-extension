// @jest-environment node
const { chooseDefault, candidatesChain } = require('../src/translator/providers');
const cases = [
  ['https://api.openai.com/v1', 'openai'],
  ['https://api.deepl.com', 'deepl'],
  ['https://translation.googleapis.com', 'google'],
  ['https://openrouter.ai/api/v1', 'openrouter'],
  ['https://api.anthropic.com', 'anthropic'],
  ['https://api.mistral.ai', 'mistral'],
  ['http://localhost:11434', 'ollama'],
];

describe('chooseDefault provider mapping', () => {
  test.each(cases)('maps %s to %s', (endpoint, expected) => {
    expect(chooseDefault({ endpoint })).toBe(expected);
  });

  test('falls back to dashscope for unknown endpoints', () => {
    expect(chooseDefault({ endpoint: 'https://example.com' })).toBe('dashscope');
  });
});

describe('candidatesChain failover order', () => {
  test.each(cases)('candidates for %s start with %s', (endpoint, expected) => {
    expect(candidatesChain({ endpoint })).toEqual([expected]);
  });

  test('defaults to dashscope when endpoint unknown', () => {
    expect(candidatesChain({ endpoint: 'https://example.com' })).toEqual(['dashscope']);
  });

  test('uses providerOrder for failover', () => {
    expect(candidatesChain({ providerOrder: ['openai', 'dashscope'] })).toEqual(['openai', 'dashscope']);
  });
});
