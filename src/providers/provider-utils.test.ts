import { describe, expect, it } from 'vitest';

import { generateLanguagePairs } from './provider-utils';

describe('generateLanguagePairs', () => {
  it('returns all non-identity pairs for the provided languages', () => {
    expect(generateLanguagePairs(['en', 'fi', 'de'])).toEqual([
      { src: 'en', tgt: 'fi' },
      { src: 'en', tgt: 'de' },
      { src: 'fi', tgt: 'en' },
      { src: 'fi', tgt: 'de' },
      { src: 'de', tgt: 'en' },
      { src: 'de', tgt: 'fi' },
    ]);
  });

  it('deduplicates repeated language codes before building pairs', () => {
    expect(generateLanguagePairs(['en', 'fi', 'en'])).toEqual([
      { src: 'en', tgt: 'fi' },
      { src: 'fi', tgt: 'en' },
    ]);
  });

  it('memoizes equivalent language lists', () => {
    const first = generateLanguagePairs(['en', 'fi', 'de']);
    const second = generateLanguagePairs(['en', 'fi', 'de']);

    expect(second).toBe(first);
  });
});
