const { registerProvider, listProviders } = require('../src/providers');
require('../src/providers/qwen');

test('listProviders returns name and label', () => {
  const mock = { translate: jest.fn(), label: 'Mock Provider' };
  registerProvider('mock', mock);
  const list = listProviders();
  expect(list).toEqual(expect.arrayContaining([
    { name: 'qwen', label: 'Qwen' },
    { name: 'mock', label: 'Mock Provider' },
  ]));
});
