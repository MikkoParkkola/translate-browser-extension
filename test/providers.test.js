const Providers = require('../src/lib/providers');
const { registerProvider, listProviders, initProviders } = require('../src/providers');

beforeEach(() => {
  Providers.reset();
  initProviders();
});

test('listProviders returns name and label', () => {
  const mock = { translate: jest.fn(), label: 'Mock Provider' };
  registerProvider('mock', mock);
  const list = listProviders();
  expect(list).toEqual(
    expect.arrayContaining([
      { name: 'qwen', label: 'Qwen' },
      { name: 'google', label: 'Google' },
      { name: 'deepl', label: 'DeepL' },
      { name: 'openrouter', label: 'OpenRouter' },
      { name: 'mistral', label: 'Mistral' },
      { name: 'mock', label: 'Mock Provider' },
    ])
  );
});
