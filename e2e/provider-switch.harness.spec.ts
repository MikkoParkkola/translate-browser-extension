import { expect, test } from '@playwright/test';

import { gotoMockHarness, installNoopCache, registerMockProviders, translate } from './mock-harness';

test('falls back to secondary provider on failure', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));

  await gotoMockHarness(page);
  await installNoopCache(page);
  await registerMockProviders(page, [
    {
      id: 'fail',
      type: 'error',
      message: 'fail',
      retryable: false,
      logMessage: 'primary provider used',
    },
    {
      id: 'ok',
      type: 'suffix',
      suffix: '-ok',
      logMessage: 'fallback provider used',
    },
  ]);

  const response = await translate(page, {
    text: 'hello',
    source: 'en',
    target: 'fr',
    provider: 'fail',
    providerOrder: ['fail', 'ok'],
  });

  expect(response.text).toBe('hello-ok');
  expect(logs.some((entry) => /fallback provider used/.test(entry))).toBe(true);
});
