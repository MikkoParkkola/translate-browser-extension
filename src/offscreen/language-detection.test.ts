/**
 * Language Detection unit tests
 *
 * Tests for franc-based language detection with ISO 639-3 to ISO 639-1 mapping.
 * Note: These tests use the actual franc-min library for realistic behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { FRANC_TO_ISO, detectLanguage } from './language-detection';

// Mock the logger to avoid console output in tests
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('FRANC_TO_ISO', () => {
  describe('structure', () => {
    it('contains 60+ language mappings', () => {
      expect(Object.keys(FRANC_TO_ISO).length).toBeGreaterThanOrEqual(60);
    });

    it('all keys are ISO 639-3 codes (3 letters)', () => {
      for (const code of Object.keys(FRANC_TO_ISO)) {
        expect(code).toMatch(/^[a-z]{3}$/);
      }
    });

    it('all values are ISO 639-1 codes (2 letters)', () => {
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

    it('maps all Norwegian variants to no', () => {
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

    it('maps both Chinese codes to zh', () => {
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

    it('detects Japanese from hiragana', () => {
      expect(detectLanguage('こんにちは')).toBe('ja');
      expect(detectLanguage('ありがとう')).toBe('ja');
    });

    it('detects Japanese from katakana', () => {
      expect(detectLanguage('コンニチハ')).toBe('ja');
      expect(detectLanguage('アリガトウ')).toBe('ja');
    });

    it('detects Chinese from Han characters', () => {
      expect(detectLanguage('你好世界')).toBe('zh');
      expect(detectLanguage('中国人民')).toBe('zh');
    });

    it('detects Russian from Cyrillic', () => {
      expect(detectLanguage('Привет мир')).toBe('ru');
      expect(detectLanguage('Доброе утро')).toBe('ru');
    });
  });

  describe('edge cases', () => {
    it('defaults to English for empty string', () => {
      expect(detectLanguage('')).toBe('en');
    });

    it('handles very short text', () => {
      // Short text may default to en or be detected based on charset
      const result = detectLanguage('Hi');
      expect(typeof result).toBe('string');
      expect(result.length).toBe(2);
    });

    it('handles undetermined text', () => {
      // Pure numbers/punctuation should default to en
      expect(detectLanguage('12345')).toBe('en');
      expect(detectLanguage('!!!')).toBe('en');
    });

    it('handles whitespace-only text', () => {
      expect(detectLanguage('   ')).toBe('en');
      expect(detectLanguage('\n\t')).toBe('en');
    });
  });

  describe('character set priority', () => {
    it('prioritizes Japanese detection for mixed kanji/hiragana', () => {
      // Text with hiragana should detect as Japanese
      expect(detectLanguage('日本語です')).toBe('ja');
    });

    it('detects Chinese when only Han characters present', () => {
      expect(detectLanguage('汉字')).toBe('zh');
    });
  });

  describe('returns valid language codes', () => {
    it('returns 2-letter ISO codes', () => {
      // Test with various inputs to ensure consistent output format
      const inputs = ['Hello', 'Bonjour', 'Hallo', 'Ciao', 'Hola'];

      for (const input of inputs) {
        const result = detectLanguage(input);
        expect(typeof result).toBe('string');
        expect(result.length).toBe(2);
        expect(result).toMatch(/^[a-z]{2}$/);
      }
    });
  });
});
