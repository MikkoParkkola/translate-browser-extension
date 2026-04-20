/**
 * Shared batch translation contract validation.
 *
 * Batch translation surfaces must return exactly one dense string result for
 * each requested input item. This helper centralizes the contract so
 * background, offscreen, and content flows stay aligned.
 */
export function normalizeBatchTranslations(
  translations: string | string[],
  expectedCount: number,
): string[] {
  if (Array.isArray(translations)) {
    if (translations.length !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} batch translations, received ${translations.length}`,
      );
    }

    for (let index = 0; index < translations.length; index++) {
      if (typeof translations[index] !== 'string') {
        throw new Error(
          `Expected ${expectedCount} batch translations, received invalid entry at index ${index}`,
        );
      }
    }

    return translations;
  }

  if (expectedCount === 1) {
    return [translations];
  }

  throw new Error(
    `Expected ${expectedCount} batch translations, received a single translation`,
  );
}
