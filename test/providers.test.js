const { registerProvider, listProviders } = require('../src/providers');
require('../src/providers/qwen');
require('../src/providers/google');
require('../src/providers/deepl');
require('../src/providers/openrouter');

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
      { name: 'mock', label: 'Mock Provider' },
    ])
  );
});
