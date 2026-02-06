/**
 * Model Maps unit tests
 *
 * Tests for OPUS-MT model mapping and pivot route logic.
 */

import { describe, it, expect } from 'vitest';
import {
  MODEL_MAP,
  PIVOT_ROUTES,
  hasDirectModel,
  hasPivotRoute,
  getModelId,
  getPivotRoute,
} from './model-maps';

describe('MODEL_MAP', () => {
  describe('structure', () => {
    it('contains 76+ direct language pairs', () => {
      expect(Object.keys(MODEL_MAP).length).toBeGreaterThanOrEqual(76);
    });

    it('all values are Xenova model IDs', () => {
      for (const modelId of Object.values(MODEL_MAP)) {
        expect(modelId).toMatch(/^Xenova\/opus-mt-/);
      }
    });

    it('all keys are valid language pair format', () => {
      for (const pair of Object.keys(MODEL_MAP)) {
        // Most are 2-letter ISO codes, but some special codes exist:
        // - 'mul' (multilingual) is 3 letters
        // - 'ROMANCE' is a language group marker
        expect(pair).toMatch(/^[a-zA-Z]{2,7}-[a-zA-Z]{2,7}$/);
      }
    });
  });

  describe('English <-> Major European Languages', () => {
    it.each([
      ['en', 'de'],
      ['de', 'en'],
      ['en', 'fr'],
      ['fr', 'en'],
      ['en', 'es'],
      ['es', 'en'],
      ['en', 'it'],
      ['it', 'en'],
      ['en', 'nl'],
      ['nl', 'en'],
    ])('has direct model for %s-%s', (src, tgt) => {
      expect(MODEL_MAP[`${src}-${tgt}`]).toBeDefined();
    });
  });

  describe('English <-> Nordic Languages', () => {
    it.each([
      ['en', 'fi'],
      ['fi', 'en'],
      ['en', 'sv'],
      ['sv', 'en'],
      ['en', 'da'],
      ['da', 'en'],
    ])('has direct model for %s-%s', (src, tgt) => {
      expect(MODEL_MAP[`${src}-${tgt}`]).toBeDefined();
    });
  });

  describe('English <-> Asian Languages', () => {
    it.each([
      ['en', 'zh'],
      ['zh', 'en'],
      ['en', 'ja'],
      ['ja', 'en'],
      ['en', 'ko'],
      ['ko', 'en'],
      ['en', 'vi'],
      ['vi', 'en'],
    ])('has direct model for %s-%s', (src, tgt) => {
      expect(MODEL_MAP[`${src}-${tgt}`]).toBeDefined();
    });

    it('uses correct model naming for Japanese', () => {
      expect(MODEL_MAP['en-ja']).toBe('Xenova/opus-mt-en-jap');
      expect(MODEL_MAP['ja-en']).toBe('Xenova/opus-mt-jap-en');
    });
  });

  describe('Direct Non-English Pairs', () => {
    it.each([
      ['fr', 'de'],
      ['de', 'fr'],
      ['fr', 'es'],
      ['es', 'fr'],
      ['it', 'es'],
      ['es', 'it'],
      ['ru', 'uk'],
      ['uk', 'ru'],
    ])('has direct model for %s-%s', (src, tgt) => {
      expect(MODEL_MAP[`${src}-${tgt}`]).toBeDefined();
    });
  });
});

describe('PIVOT_ROUTES', () => {
  describe('structure', () => {
    it('contains pivot routes for unsupported direct pairs', () => {
      expect(Object.keys(PIVOT_ROUTES).length).toBeGreaterThan(50);
    });

    it('all values are tuples of two language pairs', () => {
      for (const route of Object.values(PIVOT_ROUTES)) {
        expect(route).toHaveLength(2);
        // Most are 2-letter ISO codes, but some special codes exist:
        // - 'mul' (multilingual) is 3 letters
        // - 'ROMANCE' is a language group marker
        expect(route[0]).toMatch(/^[a-zA-Z]{2,7}-[a-zA-Z]{2,7}$/);
        expect(route[1]).toMatch(/^[a-zA-Z]{2,7}-[a-zA-Z]{2,7}$/);
      }
    });

    it('all pivot routes have valid intermediate models', () => {
      for (const [_key, [first, second]] of Object.entries(PIVOT_ROUTES)) {
        // At least one of the intermediate steps should have a direct model
        const hasFirst = first in MODEL_MAP || first in PIVOT_ROUTES;
        const hasSecond = second in MODEL_MAP || second in PIVOT_ROUTES;
        expect(hasFirst || hasSecond).toBe(true);
      }
    });
  });

  describe('Finnish pivots', () => {
    it.each([
      ['nl', 'fi', ['nl-en', 'en-fi']],
      ['fi', 'nl', ['fi-en', 'en-nl']],
      ['it', 'fi', ['it-en', 'en-fi']],
      ['fi', 'it', ['fi-en', 'en-it']],
      ['zh', 'fi', ['zh-en', 'en-fi']],
      ['fi', 'zh', ['fi-en', 'en-zh']],
    ])('has pivot route for %s-%s via %s', (src, tgt, expected) => {
      expect(PIVOT_ROUTES[`${src}-${tgt}`]).toEqual(expected);
    });
  });

  describe('Romanian pivots (via French)', () => {
    it('routes ro-en via French', () => {
      expect(PIVOT_ROUTES['ro-en']).toEqual(['ro-fr', 'fr-en']);
    });

    it('routes ro-de via French', () => {
      expect(PIVOT_ROUTES['ro-de']).toEqual(['ro-fr', 'fr-de']);
    });
  });

  describe('Asian language pivots', () => {
    it.each([
      ['ja', 'de', ['ja-en', 'en-de']],
      ['de', 'ja', ['de-en', 'en-ja']],
      ['zh', 'fr', ['zh-en', 'en-fr']],
      ['fr', 'zh', ['fr-en', 'en-zh']],
    ])('has pivot route for %s-%s', (src, tgt, expected) => {
      expect(PIVOT_ROUTES[`${src}-${tgt}`]).toEqual(expected);
    });
  });
});

describe('hasDirectModel', () => {
  it('returns true for direct pairs', () => {
    expect(hasDirectModel('en', 'fi')).toBe(true);
    expect(hasDirectModel('fi', 'en')).toBe(true);
    expect(hasDirectModel('en', 'de')).toBe(true);
    expect(hasDirectModel('fr', 'es')).toBe(true);
  });

  it('returns false for pivot-only pairs', () => {
    expect(hasDirectModel('nl', 'fi')).toBe(false);
    expect(hasDirectModel('ja', 'de')).toBe(false);
  });

  it('returns false for unsupported pairs', () => {
    expect(hasDirectModel('xx', 'yy')).toBe(false);
    expect(hasDirectModel('', '')).toBe(false);
  });
});

describe('hasPivotRoute', () => {
  it('returns true for pivot pairs', () => {
    expect(hasPivotRoute('nl', 'fi')).toBe(true);
    expect(hasPivotRoute('fi', 'nl')).toBe(true);
    expect(hasPivotRoute('ja', 'de')).toBe(true);
  });

  it('returns false for direct pairs', () => {
    expect(hasPivotRoute('en', 'fi')).toBe(false);
    expect(hasPivotRoute('fi', 'en')).toBe(false);
  });

  it('returns false for unsupported pairs', () => {
    expect(hasPivotRoute('xx', 'yy')).toBe(false);
  });
});

describe('getModelId', () => {
  it('returns model ID for direct pairs', () => {
    expect(getModelId('en', 'fi')).toBe('Xenova/opus-mt-en-fi');
    expect(getModelId('fi', 'en')).toBe('Xenova/opus-mt-fi-en');
    expect(getModelId('en', 'ja')).toBe('Xenova/opus-mt-en-jap');
  });

  it('returns null for pivot-only pairs', () => {
    expect(getModelId('nl', 'fi')).toBeNull();
    expect(getModelId('ja', 'de')).toBeNull();
  });

  it('returns null for unsupported pairs', () => {
    expect(getModelId('xx', 'yy')).toBeNull();
    expect(getModelId('', '')).toBeNull();
  });
});

describe('getPivotRoute', () => {
  it('returns pivot route for pivot pairs', () => {
    expect(getPivotRoute('nl', 'fi')).toEqual(['nl-en', 'en-fi']);
    expect(getPivotRoute('fi', 'nl')).toEqual(['fi-en', 'en-nl']);
    expect(getPivotRoute('ro', 'en')).toEqual(['ro-fr', 'fr-en']);
  });

  it('returns null for direct pairs', () => {
    expect(getPivotRoute('en', 'fi')).toBeNull();
    expect(getPivotRoute('fi', 'en')).toBeNull();
  });

  it('returns null for unsupported pairs', () => {
    expect(getPivotRoute('xx', 'yy')).toBeNull();
  });
});

describe('coverage validation', () => {
  it('every PIVOT_ROUTES entry has no direct model', () => {
    for (const pair of Object.keys(PIVOT_ROUTES)) {
      const [src, tgt] = pair.split('-');
      expect(hasDirectModel(src, tgt)).toBe(false);
    }
  });

  it('direct models and pivot routes do not overlap', () => {
    const directPairs = new Set(Object.keys(MODEL_MAP));
    const pivotPairs = new Set(Object.keys(PIVOT_ROUTES));

    for (const pair of pivotPairs) {
      expect(directPairs.has(pair)).toBe(false);
    }
  });
});
