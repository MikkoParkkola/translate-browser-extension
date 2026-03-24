import { expect, test } from '@playwright/test';

import { gotoMockHarness, installDirectTranslate, installNoopCache, registerMockProviders, translate } from './mock-harness';

test('surfaces provider quota errors', async ({ page }) => {
  await gotoMockHarness(page);
  await installNoopCache(page);
  await installDirectTranslate(page);
  await registerMockProviders(page, [
    {
      id: 'limited',
      type: 'quota',
      suffix: '-fr',
      failAfter: 2,
      message: 'quota exceeded',
      retryable: false,
    },
  ]);

  await expect(
    translate(page, { provider: 'limited', text: 'a', source: 'en', target: 'fr' }),
  ).resolves.toEqual({ text: 'a-fr' });
  await expect(
    translate(page, { provider: 'limited', text: 'b', source: 'en', target: 'fr' }),
  ).resolves.toEqual({ text: 'b-fr' });
  await expect(
    translate(page, { provider: 'limited', text: 'c', source: 'en', target: 'fr' }),
  ).rejects.toThrow(/quota exceeded/i);
});
