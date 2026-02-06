const logger = require('../src/lib/logger');
const entries = [];
const remove = logger.addCollector(e => entries.push(e));

jest.mock('../src/lib/providers', () => ({
  isInitialized: () => false,
  candidates: () => ['stub'],
  get: () => ({ translate: async () => ({ text: 'hi' }) }),
  choose: () => 'stub',
  init: jest.fn(),
}));

const mockEnsure = jest.fn();
jest.mock('../src/providers', () => ({ ensureProviders: mockEnsure }));

const { qwenTranslate } = require('../src/translator');

afterAll(() => remove());

test.skip('autoInit suppresses warning and initializes providers', async () => {
  await qwenTranslate({
    endpoint: 'https://example.com',
    apiKey: 'k',
    model: 'm',
    text: 'hello',
    source: 'en',
    target: 'es',
    noProxy: true,
    autoInit: true,
  });
  const warn = entries.find(e => e.level === 'warn' && /not initialized/i.test(e.args[0]));
  expect(warn).toBeUndefined();
  expect(mockEnsure).toHaveBeenCalled();
});
