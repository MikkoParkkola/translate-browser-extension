/**
 * TranslateGemma unit tests
 *
 * Tests for TranslateGemma prompt formatting and language name mapping.
 * Note: Actual model loading/inference is mocked as it requires WebGPU.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  TRANSLATEGEMMA_MODEL,
  LANG_NAMES,
  formatTranslateGemmaPrompt,
  isTranslateGemmaLoaded,
  isTranslateGemmaLoading,
} from './translategemma';

// Mock the logger
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock chrome.runtime.sendMessage
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(),
  },
});

// Mock navigator.gpu
vi.stubGlobal('navigator', {
  gpu: undefined,
});

describe('TRANSLATEGEMMA_MODEL', () => {
  it('points to WebGPU quantized model', () => {
    expect(TRANSLATEGEMMA_MODEL).toBe('m1cc0z/translategemma-4b-webgpu-q4');
  });
});

describe('LANG_NAMES', () => {
  describe('structure', () => {
    it('contains 40+ language mappings', () => {
      expect(Object.keys(LANG_NAMES).length).toBeGreaterThanOrEqual(40);
    });

    it('all keys are ISO 639-1 codes (2 letters)', () => {
      for (const code of Object.keys(LANG_NAMES)) {
        expect(code).toMatch(/^[a-z]{2}$/);
      }
    });

    it('all values are non-empty strings', () => {
      for (const name of Object.values(LANG_NAMES)) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });

  describe('common languages', () => {
    it.each([
      ['en', 'English'],
      ['fi', 'Finnish'],
      ['de', 'German'],
      ['fr', 'French'],
      ['es', 'Spanish'],
      ['it', 'Italian'],
      ['sv', 'Swedish'],
      ['ru', 'Russian'],
      ['zh', 'Chinese'],
      ['ja', 'Japanese'],
      ['ko', 'Korean'],
      ['ar', 'Arabic'],
    ])('maps %s to %s', (code, name) => {
      expect(LANG_NAMES[code]).toBe(name);
    });
  });

  describe('Nordic languages', () => {
    it.each([
      ['fi', 'Finnish'],
      ['sv', 'Swedish'],
      ['da', 'Danish'],
      ['no', 'Norwegian'],
    ])('maps %s to %s', (code, name) => {
      expect(LANG_NAMES[code]).toBe(name);
    });
  });

  describe('less common languages', () => {
    it.each([
      ['ka', 'Georgian'],
      ['hy', 'Armenian'],
      ['sq', 'Albanian'],
      ['eu', 'Basque'],
      ['cy', 'Welsh'],
      ['ga', 'Irish'],
    ])('maps %s to %s', (code, name) => {
      expect(LANG_NAMES[code]).toBe(name);
    });
  });
});

describe('formatTranslateGemmaPrompt', () => {
  describe('structure', () => {
    it('starts with user turn marker', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt).toMatch(/^<start_of_turn>user\n/);
    });

    it('ends with model turn marker', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt).toMatch(/<start_of_turn>model\n$/);
    });

    it('contains end_of_turn marker', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt).toContain('<end_of_turn>');
    });

    it('includes the input text', () => {
      const prompt = formatTranslateGemmaPrompt('Hello world', 'en', 'fi');
      expect(prompt).toContain('Hello world');
    });
  });

  describe('language names', () => {
    it('uses full language names in prompt', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt).toContain('English');
      expect(prompt).toContain('Finnish');
    });

    it('includes language codes in parentheses', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt).toContain('(en)');
      expect(prompt).toContain('(fi)');
    });

    it('falls back to code for unknown language', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'xx', 'yy');
      expect(prompt).toContain('xx');
      expect(prompt).toContain('yy');
    });
  });

  describe('prompt content', () => {
    it('describes translator role', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt).toContain('professional');
      expect(prompt).toContain('translator');
    });

    it('mentions source language', () => {
      const prompt = formatTranslateGemmaPrompt('Bonjour', 'fr', 'en');
      expect(prompt).toContain('French');
    });

    it('mentions target language', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'de');
      expect(prompt).toContain('German');
    });

    it('instructs to produce only translation', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt.toLowerCase()).toContain('only');
      expect(prompt.toLowerCase()).toContain('translation');
    });

    it('mentions grammar and vocabulary', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(prompt.toLowerCase()).toContain('grammar');
      expect(prompt.toLowerCase()).toContain('vocabulary');
    });
  });

  describe('various language pairs', () => {
    it.each([
      ['en', 'fi', 'English', 'Finnish'],
      ['fi', 'en', 'Finnish', 'English'],
      ['de', 'fr', 'German', 'French'],
      ['zh', 'ja', 'Chinese', 'Japanese'],
      ['ar', 'ru', 'Arabic', 'Russian'],
    ])('formats prompt for %s -> %s correctly', (src, tgt, srcName, tgtName) => {
      const prompt = formatTranslateGemmaPrompt('Test text', src, tgt);
      expect(prompt).toContain(srcName);
      expect(prompt).toContain(tgtName);
      expect(prompt).toContain(`(${src})`);
      expect(prompt).toContain(`(${tgt})`);
    });
  });

  describe('special characters in text', () => {
    it('handles newlines', () => {
      const prompt = formatTranslateGemmaPrompt('Line 1\nLine 2', 'en', 'fi');
      expect(prompt).toContain('Line 1\nLine 2');
    });

    it('handles special characters', () => {
      const prompt = formatTranslateGemmaPrompt('Hello <world> & "quotes"', 'en', 'fi');
      expect(prompt).toContain('Hello <world> & "quotes"');
    });

    it('handles unicode', () => {
      const prompt = formatTranslateGemmaPrompt('Hello paivaa', 'en', 'fi');
      expect(prompt).toContain('paivaa');
    });

    it('handles empty text', () => {
      const prompt = formatTranslateGemmaPrompt('', 'en', 'fi');
      expect(prompt).toContain('<start_of_turn>user');
      expect(prompt).toContain('<start_of_turn>model');
    });
  });
});

describe('isTranslateGemmaLoaded', () => {
  it('returns false when pipeline is not loaded', () => {
    // Fresh module state - pipeline should not be loaded
    expect(isTranslateGemmaLoaded()).toBe(false);
  });
});

describe('isTranslateGemmaLoading', () => {
  it('returns false when not loading', () => {
    expect(isTranslateGemmaLoading()).toBe(false);
  });
});

describe('prompt template validation', () => {
  it('matches official TranslateGemma chat template format', () => {
    const prompt = formatTranslateGemmaPrompt('Test', 'en', 'fi');

    // Verify structure matches the official template
    const lines = prompt.split('\n');

    // First line should be user turn start
    expect(lines[0]).toBe('<start_of_turn>user');

    // Should contain the translator instruction
    expect(prompt).toMatch(/You are a professional .* translator/);

    // Should contain the text placeholder area
    expect(prompt).toContain('Test<end_of_turn>');

    // Should end with model turn
    expect(lines[lines.length - 1]).toBe('');
    expect(lines[lines.length - 2]).toBe('<start_of_turn>model');
  });
});
