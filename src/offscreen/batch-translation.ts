type MaybePromise<T> = T | Promise<T>;

export interface BatchTranslationItem {
  index: number;
  text: string;
}

export interface CollectBatchTranslationInputsOptions {
  getCached?: (text: string, index: number) => MaybePromise<string | null | undefined>;
  onCacheHit?: (context: { index: number; text: string; cached: string }) => void;
}

export async function collectBatchTranslationInputs(
  text: string[],
  options: CollectBatchTranslationInputsOptions = {},
): Promise<{ results: string[]; uncachedItems: BatchTranslationItem[] }> {
  const results: string[] = [];
  const uncachedItems: BatchTranslationItem[] = [];

  for (let index = 0; index < text.length; index++) {
    const value = text[index];
    if (!value || value.trim().length === 0) {
      results[index] = value;
      continue;
    }

    const cached = options.getCached ? await options.getCached(value, index) : null;
    if (cached !== null && cached !== undefined) {
      options.onCacheHit?.({ index, text: value, cached });
      results[index] = cached;
      continue;
    }

    uncachedItems.push({ index, text: value });
  }

  return { results, uncachedItems };
}

export interface MergeBatchTranslationResultsOptions {
  storeCached?: (text: string, translation: string, index: number) => MaybePromise<void>;
  onCacheStoreFailure?: (context: {
    index: number;
    text: string;
    translation: string;
    failureCount: number;
    totalItems: number;
    error: unknown;
  }) => void;
  onIdentityTranslation?: (context: { index: number; text: string }) => void;
}

function normalizeBatchTranslations(
  translations: string | string[],
  expectedCount: number,
): string[] {
  if (Array.isArray(translations)) {
    if (translations.length !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} batch translations, received ${translations.length}`,
      );
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

export async function mergeBatchTranslationResults(
  initialResults: string[],
  uncachedItems: BatchTranslationItem[],
  translations: string | string[],
  options: MergeBatchTranslationResultsOptions = {},
): Promise<{ results: string[]; cacheFailures: number }> {
  if (uncachedItems.length === 0) {
    return { results: [...initialResults], cacheFailures: 0 };
  }

  const normalizedTranslations = normalizeBatchTranslations(translations, uncachedItems.length);
  const results = [...initialResults];
  let cacheFailures = 0;

  for (let index = 0; index < uncachedItems.length; index++) {
    const item = uncachedItems[index];
    const translation = normalizedTranslations[index];
    results[item.index] = translation;

    if (translation === item.text) {
      options.onIdentityTranslation?.({ index: item.index, text: item.text });
    }

    if (!options.storeCached) {
      continue;
    }

    try {
      await options.storeCached(item.text, translation, item.index);
    } catch (error) {
      cacheFailures++;
      options.onCacheStoreFailure?.({
        index: item.index,
        text: item.text,
        translation,
        failureCount: cacheFailures,
        totalItems: uncachedItems.length,
        error,
      });
    }
  }

  return { results, cacheFailures };
}

export interface TranslateArrayItemsOptions {
  onItemTranslated?: (context: { index: number; text: string; translation: string }) => void;
  onItemError?: (context: { index: number; text: string; error: unknown }) => void;
}

export async function translateArrayItems(
  text: string[],
  translateItem: (text: string, index: number) => Promise<string>,
  options: TranslateArrayItemsOptions = {},
): Promise<string[]> {
  return Promise.all(
    text.map(async (value, index) => {
      if (!value || value.trim().length === 0) {
        return value;
      }

      try {
        const translation = await translateItem(value, index);
        options.onItemTranslated?.({ index, text: value, translation });
        return translation;
      } catch (error) {
        options.onItemError?.({ index, text: value, error });
        return value;
      }
    }),
  );
}
