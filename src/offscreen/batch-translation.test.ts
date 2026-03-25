import { describe, expect, it, vi } from 'vitest';

import {
  collectBatchTranslationInputs,
  mergeBatchTranslationResults,
  translateArrayItems,
} from './batch-translation';

describe('batch-translation helpers', () => {
  describe('collectBatchTranslationInputs', () => {
    it('preserves blank items and reuses cached entries', async () => {
      const getCached = vi.fn(async (text: string) => (
        text === 'World' ? 'Welt' : null
      ));
      const onCacheHit = vi.fn();

      const { results, uncachedItems } = await collectBatchTranslationInputs(
        ['', 'Hello', 'World', '   '],
        { getCached, onCacheHit },
      );

      expect(results[0]).toBe('');
      expect(results[1]).toBeUndefined();
      expect(results[2]).toBe('Welt');
      expect(results[3]).toBe('   ');
      expect(uncachedItems).toEqual([{ index: 1, text: 'Hello' }]);
      expect(getCached).toHaveBeenCalledTimes(2);
      expect(onCacheHit).toHaveBeenCalledWith({
        index: 2,
        text: 'World',
        cached: 'Welt',
      });
    });
  });

  describe('mergeBatchTranslationResults', () => {
    it('stores merged results and reports cache write failures', async () => {
      const storeCached = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('cache unavailable'));
      const onCacheStoreFailure = vi.fn();
      const onIdentityTranslation = vi.fn();

      const { results, cacheFailures } = await mergeBatchTranslationResults(
        ['cached'],
        [
          { index: 1, text: 'Hello' },
          { index: 2, text: 'Brand' },
        ],
        ['Hallo', 'Brand'],
        {
          storeCached,
          onCacheStoreFailure,
          onIdentityTranslation,
        },
      );

      expect(results).toEqual(['cached', 'Hallo', 'Brand']);
      expect(cacheFailures).toBe(1);
      expect(storeCached).toHaveBeenNthCalledWith(1, 'Hello', 'Hallo', 1);
      expect(storeCached).toHaveBeenNthCalledWith(2, 'Brand', 'Brand', 2);
      expect(onIdentityTranslation).toHaveBeenCalledWith({ index: 2, text: 'Brand' });
      expect(onCacheStoreFailure).toHaveBeenCalledWith({
        index: 2,
        text: 'Brand',
        translation: 'Brand',
        failureCount: 1,
        totalItems: 2,
        error: expect.any(Error),
      });
    });
  });

  describe('translateArrayItems', () => {
    it('keeps blank and failed items in place without failing the batch', async () => {
      const translateItem = vi.fn(async (text: string) => {
        if (text === 'boom') {
          throw new Error('translation failed');
        }
        return text.toUpperCase();
      });
      const onItemTranslated = vi.fn();
      const onItemError = vi.fn();

      const results = await translateArrayItems(
        ['', 'hello', 'boom', '   '],
        translateItem,
        { onItemTranslated, onItemError },
      );

      expect(results).toEqual(['', 'HELLO', 'boom', '   ']);
      expect(onItemTranslated).toHaveBeenCalledTimes(1);
      expect(onItemTranslated).toHaveBeenCalledWith({
        index: 1,
        text: 'hello',
        translation: 'HELLO',
      });
      expect(onItemError).toHaveBeenCalledTimes(1);
      expect(onItemError).toHaveBeenCalledWith({
        index: 2,
        text: 'boom',
        error: expect.any(Error),
      });
    });
  });
});
