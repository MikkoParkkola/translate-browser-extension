/**
 * Input Validation & Fuzzing Security Tests
 *
 * Fuzz-tests validateInput() and sanitizeText() from src/core/errors.ts
 * with adversarial, edge-case, and boundary inputs.
 */

import { describe, it, expect } from 'vitest';
import {
  validateInput,
  MAX_TEXT_LENGTH,
  MAX_BATCH_SIZE,
} from '../core/errors';

// Valid language pair for most tests
const SRC = 'en';
const TGT = 'fi';

describe('Input Validation — Boundary & Edge Cases', () => {
  describe('empty and falsy inputs', () => {
    it('rejects empty string', () => {
      const result = validateInput('', SRC, TGT);
      expect(result.valid).toBe(false);
    });

    it('rejects null', () => {
      const result = validateInput(null as unknown as string, SRC, TGT);
      expect(result.valid).toBe(false);
    });

    it('rejects undefined', () => {
      const result = validateInput(undefined as unknown as string, SRC, TGT);
      expect(result.valid).toBe(false);
    });

    it('rejects empty array', () => {
      const result = validateInput([], SRC, TGT);
      expect(result.valid).toBe(false);
    });

    it('rejects whitespace-only string (sanitized to empty)', () => {
      const result = validateInput('   \t  \t   ', SRC, TGT);
      expect(result.valid).toBe(false);
    });
  });

  describe('text length boundaries', () => {
    it(`accepts string at exactly MAX_TEXT_LENGTH (${MAX_TEXT_LENGTH})`, () => {
      const text = 'a'.repeat(MAX_TEXT_LENGTH);
      const result = validateInput(text, SRC, TGT);
      expect(result.valid).toBe(true);
    });

    it(`rejects string at MAX_TEXT_LENGTH + 1 (${MAX_TEXT_LENGTH + 1})`, () => {
      const text = 'a'.repeat(MAX_TEXT_LENGTH + 1);
      const result = validateInput(text, SRC, TGT);
      expect(result.valid).toBe(false);
      expect(result.error?.category).toBe('input');
    });

    it('accepts single character', () => {
      const result = validateInput('a', SRC, TGT);
      expect(result.valid).toBe(true);
    });

    it(`handles very long single word (${MAX_TEXT_LENGTH} chars, no spaces)`, () => {
      const word = 'x'.repeat(MAX_TEXT_LENGTH);
      const result = validateInput(word, SRC, TGT);
      expect(result.valid).toBe(true);
    });
  });

  describe('batch size boundaries', () => {
    it(`accepts batch at exactly MAX_BATCH_SIZE (${MAX_BATCH_SIZE})`, () => {
      const batch = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => `text ${i}`);
      const result = validateInput(batch, SRC, TGT);
      expect(result.valid).toBe(true);
    });

    it(`rejects batch at MAX_BATCH_SIZE + 1 (${MAX_BATCH_SIZE + 1})`, () => {
      const batch = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => `text ${i}`);
      const result = validateInput(batch, SRC, TGT);
      expect(result.valid).toBe(false);
      expect(result.error?.category).toBe('input');
    });

    it('accepts batch of one', () => {
      const result = validateInput(['hello'], SRC, TGT);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Input Validation — Unicode Handling', () => {
  it('accepts RTL Arabic text', () => {
    const result = validateInput('مرحبا بالعالم', SRC, TGT);
    expect(result.valid).toBe(true);
  });

  it('accepts RTL Hebrew text', () => {
    const result = validateInput('שלום עולם', SRC, TGT);
    expect(result.valid).toBe(true);
  });

  it('accepts combining characters (e.g., diacritics)', () => {
    // e + combining acute = é
    const result = validateInput('e\u0301', SRC, TGT);
    expect(result.valid).toBe(true);
    // After NFC normalization, should become single codepoint
    const sanitized = result.sanitizedText as string;
    expect(sanitized).toBe('\u00E9');
  });

  it('accepts ZWJ sequences (emoji family)', () => {
    const family = '👨‍👩‍👧‍👦'; // ZWJ sequence
    const result = validateInput(family, SRC, TGT);
    expect(result.valid).toBe(true);
  });

  it('accepts emoji text', () => {
    const result = validateInput('Hello 🌍🔥💯 World', SRC, TGT);
    expect(result.valid).toBe(true);
  });

  it('accepts CJK characters', () => {
    const result = validateInput('日本語のテスト文です', SRC, TGT);
    expect(result.valid).toBe(true);
  });

  it('accepts mixed scripts', () => {
    const result = validateInput('Hello مرحبا 你好 Привет', SRC, TGT);
    expect(result.valid).toBe(true);
  });
});

describe('Input Validation — Control Characters & Null Bytes', () => {
  it('strips null bytes from input', () => {
    const result = validateInput('hello\x00world', SRC, TGT);
    expect(result.valid).toBe(true);
    const sanitized = result.sanitizedText as string;
    expect(sanitized).not.toContain('\x00');
    expect(sanitized).toContain('helloworld');
  });

  it('strips bell character', () => {
    const result = validateInput('hello\x07world', SRC, TGT);
    expect(result.valid).toBe(true);
    expect((result.sanitizedText as string)).not.toContain('\x07');
  });

  it('strips backspace character', () => {
    const result = validateInput('hello\x08world', SRC, TGT);
    expect(result.valid).toBe(true);
    expect((result.sanitizedText as string)).not.toContain('\x08');
  });

  it('preserves newlines (not stripped)', () => {
    const result = validateInput('line1\nline2\nline3', SRC, TGT);
    expect(result.valid).toBe(true);
    expect((result.sanitizedText as string)).toContain('\n');
  });

  it('normalizes multiple spaces and tabs to single space', () => {
    const result = validateInput('hello    \t\t   world', SRC, TGT);
    expect(result.valid).toBe(true);
    expect((result.sanitizedText as string)).toBe('hello world');
  });

  it('strips DEL character (0x7F)', () => {
    const result = validateInput('hello\x7Fworld', SRC, TGT);
    expect(result.valid).toBe(true);
    expect((result.sanitizedText as string)).not.toContain('\x7F');
  });
});

describe('Input Validation — HTML & Injection Attempts', () => {
  it('passes through HTML entities as text (not decoded)', () => {
    const result = validateInput('&amp; &lt; &gt; &quot;', SRC, TGT);
    expect(result.valid).toBe(true);
    // These are just text — sanitizeText does not decode HTML entities
    expect((result.sanitizedText as string)).toContain('&amp;');
  });

  it('passes through HTML tags as text (sanitizeText does not strip HTML)', () => {
    // Note: sanitizeText handles control chars/whitespace, not HTML.
    // HTML escaping is done at the DOM insertion layer (escapeHtml).
    const result = validateInput('<b>bold</b>', SRC, TGT);
    expect(result.valid).toBe(true);
    expect((result.sanitizedText as string)).toContain('<b>bold</b>');
  });

  it('passes through nested HTML', () => {
    const result = validateInput('<div><script>alert(1)</script></div>', SRC, TGT);
    expect(result.valid).toBe(true);
    // sanitizeText doesn't strip HTML — that's intentional.
    // The display layer (escapeHtml) handles HTML escaping.
  });

  it('handles SQL injection attempts gracefully', () => {
    const sqli = "'; DROP TABLE translations; --";
    const result = validateInput(sqli, SRC, TGT);
    expect(result.valid).toBe(true);
    // SQL-like strings are just text — no SQL is executed
    expect((result.sanitizedText as string)).toContain("DROP TABLE");
  });

  it('handles path traversal attempts gracefully', () => {
    const traversal = '../../etc/passwd';
    const result = validateInput(traversal, SRC, TGT);
    expect(result.valid).toBe(true);
    // Path traversal strings are just text for translation
    expect((result.sanitizedText as string)).toContain('../../etc/passwd');
  });
});

describe('Input Validation — Language Code Validation', () => {
  it('accepts auto-detect source language', () => {
    const result = validateInput('hello', 'auto', TGT);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid source language code with special chars', () => {
    const result = validateInput('hello', '<script>', TGT);
    expect(result.valid).toBe(false);
    expect(result.error?.category).toBe('language');
  });

  it('rejects invalid target language code with special chars', () => {
    const result = validateInput('hello', SRC, '<script>');
    expect(result.valid).toBe(false);
    expect(result.error?.category).toBe('language');
  });

  it('rejects language code with SQL injection', () => {
    const result = validateInput('hello', "en' OR 1=1--", TGT);
    expect(result.valid).toBe(false);
    expect(result.error?.category).toBe('language');
  });

  it('rejects language code with path traversal', () => {
    const result = validateInput('hello', SRC, '../../en');
    expect(result.valid).toBe(false);
    expect(result.error?.category).toBe('language');
  });

  it('accepts valid 2-letter ISO code', () => {
    const result = validateInput('hello', 'en', 'fi');
    expect(result.valid).toBe(true);
  });

  it('accepts valid 3-letter ISO code', () => {
    const result = validateInput('hello', 'eng', 'fin');
    expect(result.valid).toBe(true);
  });

  it('rejects 4+ letter language code', () => {
    const result = validateInput('hello', 'engl', TGT);
    expect(result.valid).toBe(false);
  });
});
