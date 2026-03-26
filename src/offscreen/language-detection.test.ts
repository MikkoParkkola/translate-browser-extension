/**
 * Language Detection unit tests
 *
 * Tests for franc-based language detection with ISO 639-3 to ISO 639-1 mapping.
 * Note: These tests use the actual franc-min library for realistic behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createBrowserApiModuleMock,
  createLoggerModuleMock,
} from '../test-helpers/module-mocks';
import { buildLanguageDetectionSample, FRANC_TO_ISO, detectLanguage } from './language-detection';

// Mock the logger to avoid console output in tests
vi.mock('../core/logger', () => createLoggerModuleMock());

// Mock browserAPI — language-detection uses it for Firefox i18n.detectLanguage
// which is never available in test environments
vi.mock('../core/browser-api', () =>
  createBrowserApiModuleMock({
    i18nGetUILanguage: () => 'en',
  })
);

describe('FRANC_TO_ISO', () => {
  describe('structure', () => {
    it('contains 60+ language mappings', async () => {
      expect(Object.keys(FRANC_TO_ISO).length).toBeGreaterThanOrEqual(60);
    });

    it('all keys are ISO 639-3 codes (3 letters)', async () => {
      for (const code of Object.keys(FRANC_TO_ISO)) {
        expect(code).toMatch(/^[a-z]{3}$/);
      }
    });

    it('all values are ISO 639-1 codes (2 letters)', async () => {
      for (const code of Object.values(FRANC_TO_ISO)) {
        expect(code).toMatch(/^[a-z]{2}$/);
      }
    });
  });

  describe('Major European Languages', () => {
    it.each([
      ['eng', 'en'],
      ['deu', 'de'],
      ['fra', 'fr'],
      ['spa', 'es'],
      ['ita', 'it'],
      ['nld', 'nl'],
      ['por', 'pt'],
    ])('maps %s to %s', (iso3, iso1) => {
      expect(FRANC_TO_ISO[iso3]).toBe(iso1);
    });
  });

  describe('Nordic Languages', () => {
    it.each([
      ['fin', 'fi'],
      ['swe', 'sv'],
      ['dan', 'da'],
      ['nor', 'no'],
      ['nob', 'no'],
      ['nno', 'no'],
    ])('maps %s to %s', (iso3, iso1) => {
      expect(FRANC_TO_ISO[iso3]).toBe(iso1);
    });

    it('maps all Norwegian variants to no', async () => {
      expect(FRANC_TO_ISO['nor']).toBe('no');
      expect(FRANC_TO_ISO['nob']).toBe('no');
      expect(FRANC_TO_ISO['nno']).toBe('no');
    });
  });

  describe('Eastern European Languages', () => {
    it.each([
      ['rus', 'ru'],
      ['ukr', 'uk'],
      ['pol', 'pl'],
      ['ces', 'cs'],
      ['hun', 'hu'],
      ['ron', 'ro'],
      ['bul', 'bg'],
    ])('maps %s to %s', (iso3, iso1) => {
      expect(FRANC_TO_ISO[iso3]).toBe(iso1);
    });
  });

  describe('Asian Languages', () => {
    it.each([
      ['cmn', 'zh'],
      ['zho', 'zh'],
      ['jpn', 'ja'],
      ['kor', 'ko'],
      ['vie', 'vi'],
      ['tha', 'th'],
      ['hin', 'hi'],
      ['ind', 'id'],
    ])('maps %s to %s', (iso3, iso1) => {
      expect(FRANC_TO_ISO[iso3]).toBe(iso1);
    });

    it('maps both Chinese codes to zh', async () => {
      expect(FRANC_TO_ISO['cmn']).toBe('zh');
      expect(FRANC_TO_ISO['zho']).toBe('zh');
    });
  });

  describe('Middle Eastern Languages', () => {
    it.each([
      ['ara', 'ar'],
      ['heb', 'he'],
      ['fas', 'fa'],
      ['tur', 'tr'],
    ])('maps %s to %s', (iso3, iso1) => {
      expect(FRANC_TO_ISO[iso3]).toBe(iso1);
    });
  });
});

describe('detectLanguage', () => {
  describe('character set fallback (core functionality)', () => {
    // These tests verify the character set fallback logic works
    // when franc returns 'und' (undetermined)

    it('detects Japanese from hiragana', async () => {
      expect(await detectLanguage('こんにちは')).toBe('ja');
      expect(await detectLanguage('ありがとう')).toBe('ja');
    });

    it('detects Japanese from katakana', async () => {
      expect(await detectLanguage('コンニチハ')).toBe('ja');
      expect(await detectLanguage('アリガトウ')).toBe('ja');
    });

    it('detects Chinese from Han characters', async () => {
      expect(await detectLanguage('你好世界')).toBe('zh');
      expect(await detectLanguage('中国人民')).toBe('zh');
    });

    it('detects Russian from Cyrillic', async () => {
      expect(await detectLanguage('Привет мир')).toBe('ru');
      expect(await detectLanguage('Доброе утро')).toBe('ru');
    });
  });

  describe('edge cases', () => {
    it('defaults to English for empty string', async () => {
      expect(await detectLanguage('')).toBe('en');
    });

    it('handles very short text', async () => {
      // Short text may default to en or be detected based on charset
      const result = await detectLanguage('Hi');
      expect(typeof result).toBe('string');
      expect(result.length).toBe(2);
    });

    it('handles undetermined text', async () => {
      // Pure numbers/punctuation should default to en
      expect(await detectLanguage('12345')).toBe('en');
      expect(await detectLanguage('!!!')).toBe('en');
    });

    it('handles whitespace-only text', async () => {
      expect(await detectLanguage('   ')).toBe('en');
      expect(await detectLanguage('\n\t')).toBe('en');
    });
  });

  describe('character set priority', () => {
    it('prioritizes Japanese detection for mixed kanji/hiragana', async () => {
      // Text with hiragana should detect as Japanese
      expect(await detectLanguage('日本語です')).toBe('ja');
    });

    it('detects Chinese when only Han characters present', async () => {
      expect(await detectLanguage('汉字')).toBe('zh');
    });
  });

  describe('returns valid language codes', () => {
    it('returns 2-letter ISO codes', async () => {
      // Test with various inputs to ensure consistent output format
      const inputs = ['Hello', 'Bonjour', 'Hallo', 'Ciao', 'Hola'];

      for (const input of inputs) {
        const result = await detectLanguage(input);
        expect(typeof result).toBe('string');
        expect(result.length).toBe(2);
        expect(result).toMatch(/^[a-z]{2}$/);
      }
    });
  });

  // ------------------------------------------------------------------
  // Additional coverage: Finnish character fallback (line 109)
  // ------------------------------------------------------------------
  describe('Finnish character set fallback', () => {
    it('detects Finnish from short text with ä', async () => {
      // < 20 chars so franc returns 'und', Finnish regex matches
      expect(await detectLanguage('pöytä')).toBe('fi');
    });

    it('detects Finnish from short text with ö', async () => {
      expect(await detectLanguage('öljy')).toBe('fi');
    });

    it('detects Finnish from short text with å', async () => {
      expect(await detectLanguage('Åbo')).toBe('fi');
    });
  });

  // ------------------------------------------------------------------
  // Additional coverage: franc successful detection (lines 114-115)
  // When text >= 20 chars franc returns a real ISO 639-3 code,
  // exercising the FRANC_TO_ISO lookup + fallback.
  // ------------------------------------------------------------------
  describe('franc successful detection path', () => {
    it('maps franc detection to ISO 639-1 for long English text', async () => {
      // 60+ chars → franc detects 'eng' → FRANC_TO_ISO['eng'] = 'en'
      const result = await detectLanguage(
        'The quick brown fox jumps over the lazy dog and runs around the big beautiful park'
      );
      expect(result).toBe('en');
    });

    it('maps franc detection for long German text', async () => {
      const result = await detectLanguage(
        'Dies ist ein ausreichend langer deutscher Satz für die automatische Spracherkennung'
      );
      expect(result).toBe('de');
    });

    it('maps franc detection for long French text', async () => {
      const result = await detectLanguage(
        'Ceci est une phrase suffisamment longue en français pour que la détection fonctionne'
      );
      expect(result).toBe('fr');
    });
  });
});

describe('buildLanguageDetectionSample', () => {
  it('keeps single-string input unchanged', () => {
    expect(buildLanguageDetectionSample('Hallo wereld')).toBe('Hallo wereld');
  });

  it('prefers longer body text over short navigation labels', async () => {
    const sample = buildLanguageDetectionSample([
      'Home',
      'Events',
      'Chat',
      'Login',
      'Contact',
      'High class',
      'Beschrijving',
      'Hoi ik ben Rosie en ik besteed graag lekker tijd aan het voorspel om heerlijk op te warmen en geniet net zoveel van de sex als jij.',
      'Dirty talk',
      'Privé €150 per uur',
    ]);

    expect(sample).toContain('Hoi ik ben Rosie');
    expect(sample).toContain('Beschrijving');
    expect(await detectLanguage(sample)).toBe('nl');
  });
});
