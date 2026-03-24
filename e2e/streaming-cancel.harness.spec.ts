import { expect, test } from '@playwright/test';

import { gotoMockHarness, registerMockProviders, runStreamingTranslationWithAbort } from './mock-harness';

test('aborts streaming translation mid-stream', async ({ page }) => {
  await gotoMockHarness(page);
  await registerMockProviders(page, [
    {
      id: 'stream',
      type: 'stream',
      chunks: ['Bon', 'jour'],
      resultText: 'Bonjour',
      delayMs: 100,
    },
  ]);

  const result = await runStreamingTranslationWithAbort(
    page,
    {
      provider: 'stream',
      text: 'hello',
      source: 'en',
      target: 'fr',
      stream: true,
    },
    150,
  );

  expect(result.error).toBe('AbortError');
  expect(result.chunks).toEqual(['Bon']);
});
