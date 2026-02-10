/**
 * Language map utility unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  LANGUAGE_NAMES,
  DEEPL_LANGUAGE_CODES,
  getLanguageName,
  normalizeLanguageCode,
  toDeepLCode,
  getDeepLSupportedLanguages,
  getAllLanguageCodes,
} from './language-map';

describe('LANGUAGE_NAMES', () => {
  it('contains common languages', () => {
    expect(LANGUAGE_NAMES['en']).toBe('English');
    expect(LANGUAGE_NAMES['fi']).toBe('Finnish');
    expect(LANGUAGE_NAMES['de']).toBe('German');
    expect(LANGUAGE_NAMES['ja']).toBe('Japanese');
    expect(LANGUAGE_NAMES['zh']).toBe('Chinese');
  });

  it('maps ISO 639-1 codes to human-readable names', () => {
    const codes = Object.keys(LANGUAGE_NAMES);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z]{2}$/);
      expect(typeof LANGUAGE_NAMES[code]).toBe('string');
      expect(LANGUAGE_NAMES[code].length).toBeGreaterThan(0);
    }
  });

  it('contains at least 30 languages', () => {
    expect(Object.keys(LANGUAGE_NAMES).length).toBeGreaterThanOrEqual(30);
  });
});

describe('DEEPL_LANGUAGE_CODES', () => {
  it('contains uppercase DeepL codes', () => {
    expect(DEEPL_LANGUAGE_CODES['en']).toBe('EN');
    expect(DEEPL_LANGUAGE_CODES['de']).toBe('DE');
    expect(DEEPL_LANGUAGE_CODES['fi']).toBe('FI');
  });

  it('all values are uppercase', () => {
    for (const [, value] of Object.entries(DEEPL_LANGUAGE_CODES)) {
      expect(value).toBe(value.toUpperCase());
    }
  });

  it('all keys are lowercase ISO 639-1 codes', () => {
    for (const key of Object.keys(DEEPL_LANGUAGE_CODES)) {
      expect(key).toMatch(/^[a-z]{2}$/);
    }
  });
});

describe('getLanguageName', () => {
  it('returns human-readable name for known codes', () => {
    expect(getLanguageName('en')).toBe('English');
    expect(getLanguageName('fi')).toBe('Finnish');
    expect(getLanguageName('ja')).toBe('Japanese');
  });

  it('handles uppercase input', () => {
    expect(getLanguageName('EN')).toBe('English');
    expect(getLanguageName('FI')).toBe('Finnish');
  });

  it('handles mixed case input', () => {
    expect(getLanguageName('En')).toBe('English');
    expect(getLanguageName('dE')).toBe('German');
  });

  it('returns code itself for unknown codes', () => {
    expect(getLanguageName('xx')).toBe('xx');
    expect(getLanguageName('zzz')).toBe('zzz');
  });

  it('returns empty string for empty input', () => {
    expect(getLanguageName('')).toBe('');
  });
});

describe('normalizeLanguageCode', () => {
  it('lowercases input', () => {
    expect(normalizeLanguageCode('EN')).toBe('en');
    expect(normalizeLanguageCode('FI')).toBe('fi');
    expect(normalizeLanguageCode('De')).toBe('de');
  });

  it('trims whitespace', () => {
    expect(normalizeLanguageCode(' en ')).toBe('en');
    expect(normalizeLanguageCode('\tfi\n')).toBe('fi');
  });

  it('handles already-normalized codes', () => {
    expect(normalizeLanguageCode('en')).toBe('en');
  });

  it('handles empty string', () => {
    expect(normalizeLanguageCode('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(normalizeLanguageCode('   ')).toBe('');
  });
});

describe('toDeepLCode', () => {
  it('converts known codes to DeepL format', () => {
    expect(toDeepLCode('en')).toBe('EN');
    expect(toDeepLCode('de')).toBe('DE');
    expect(toDeepLCode('fi')).toBe('FI');
  });

  it('handles uppercase input for known codes', () => {
    expect(toDeepLCode('EN')).toBe('EN');
    expect(toDeepLCode('DE')).toBe('DE');
  });

  it('falls back to uppercase for unknown codes', () => {
    expect(toDeepLCode('xx')).toBe('XX');
    expect(toDeepLCode('yy')).toBe('YY');
  });

  it('handles mixed case input', () => {
    expect(toDeepLCode('En')).toBe('EN');
  });
});

describe('getDeepLSupportedLanguages', () => {
  it('returns an array of language codes', () => {
    const langs = getDeepLSupportedLanguages();
    expect(Array.isArray(langs)).toBe(true);
    expect(langs.length).toBeGreaterThan(0);
  });

  it('contains common languages', () => {
    const langs = getDeepLSupportedLanguages();
    expect(langs).toContain('en');
    expect(langs).toContain('de');
    expect(langs).toContain('fr');
    expect(langs).toContain('fi');
  });

  it('all codes are lowercase', () => {
    const langs = getDeepLSupportedLanguages();
    for (const code of langs) {
      expect(code).toBe(code.toLowerCase());
    }
  });

  it('matches keys of DEEPL_LANGUAGE_CODES', () => {
    const langs = getDeepLSupportedLanguages();
    expect(langs).toEqual(Object.keys(DEEPL_LANGUAGE_CODES));
  });
});

describe('getAllLanguageCodes', () => {
  it('returns an array of all language codes', () => {
    const codes = getAllLanguageCodes();
    expect(Array.isArray(codes)).toBe(true);
    expect(codes.length).toBeGreaterThan(0);
  });

  it('contains common languages', () => {
    const codes = getAllLanguageCodes();
    expect(codes).toContain('en');
    expect(codes).toContain('fi');
    expect(codes).toContain('ja');
    expect(codes).toContain('zh');
  });

  it('matches keys of LANGUAGE_NAMES', () => {
    const codes = getAllLanguageCodes();
    expect(codes).toEqual(Object.keys(LANGUAGE_NAMES));
  });

  it('contains more codes than DeepL supported list', () => {
    const allCodes = getAllLanguageCodes();
    const deeplCodes = getDeepLSupportedLanguages();
    expect(allCodes.length).toBeGreaterThanOrEqual(deeplCodes.length);
  });
});
