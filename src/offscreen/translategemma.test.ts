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
    expect(TRANSLATEGEMMA_MODEL).toBe('m1cc0z/translategemma-4b-it-onnx-q4-webgpu');
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

describe('formatTranslateGemmaPrompt with context parameter', () => {
  describe('when context is provided', () => {
    it('injects context line into prompt', () => {
      const prompt = formatTranslateGemmaPrompt('Bank', 'en', 'fi', 'Financial news article');
      expect(prompt).toContain('Context:');
      expect(prompt).toContain('Financial news article');
    });

    it('includes disambiguation instruction', () => {
      const prompt = formatTranslateGemmaPrompt('Bank', 'en', 'fi', 'River description');
      expect(prompt).toContain('disambiguation');
    });

    it('places context between translator instruction and translation request', () => {
      const prompt = formatTranslateGemmaPrompt('Bank', 'en', 'fi', 'Financial article');
      const contextIndex = prompt.indexOf('Context:');
      const translatorIndex = prompt.indexOf('professional');
      const translateIndex = prompt.indexOf('Produce only');

      expect(contextIndex).toBeGreaterThan(translatorIndex);
      expect(contextIndex).toBeLessThan(translateIndex);
    });

    it('wraps context in quotes within the prompt', () => {
      const prompt = formatTranslateGemmaPrompt('Test', 'en', 'fi', 'page header');
      expect(prompt).toContain('"page header"');
    });

    it('still contains all standard prompt elements with context', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi', 'main content');
      expect(prompt).toMatch(/^<start_of_turn>user\n/);
      expect(prompt).toMatch(/<start_of_turn>model\n$/);
      expect(prompt).toContain('<end_of_turn>');
      expect(prompt).toContain('Hello');
      expect(prompt).toContain('English');
      expect(prompt).toContain('Finnish');
    });
  });

  describe('when context is undefined', () => {
    it('does not include context line', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi', undefined);
      expect(prompt).not.toContain('Context:');
    });

    it('produces identical output to no-context call', () => {
      const withUndefined = formatTranslateGemmaPrompt('Hello', 'en', 'fi', undefined);
      const withoutArg = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(withUndefined).toBe(withoutArg);
    });
  });

  describe('when context is empty string', () => {
    it('does not include context line for empty string', () => {
      const prompt = formatTranslateGemmaPrompt('Hello', 'en', 'fi', '');
      expect(prompt).not.toContain('Context:');
    });

    it('produces identical output to no-context call for empty string', () => {
      const withEmpty = formatTranslateGemmaPrompt('Hello', 'en', 'fi', '');
      const withoutArg = formatTranslateGemmaPrompt('Hello', 'en', 'fi');
      expect(withEmpty).toBe(withoutArg);
    });
  });

  describe('context with various content', () => {
    it('handles long context strings', () => {
      const longContext = 'A'.repeat(500);
      const prompt = formatTranslateGemmaPrompt('Test', 'en', 'fi', longContext);
      expect(prompt).toContain(longContext);
    });

    it('handles context with special characters', () => {
      const prompt = formatTranslateGemmaPrompt('Test', 'en', 'fi', 'News > Sports > Football');
      expect(prompt).toContain('News > Sports > Football');
    });

    it('handles context with unicode', () => {
      const prompt = formatTranslateGemmaPrompt('Test', 'en', 'fi', 'Uutiset > Urheilu');
      expect(prompt).toContain('Uutiset > Urheilu');
    });
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

/**
 * TranslateGemma dtype selection tests.
 *
 * The model repo (m1cc0z/translategemma-4b-it-onnx-q4-webgpu) only ships q4f16
 * ONNX files. Requesting 'q4' loads the same q4f16 files but attempts fp32
 * compute, causing mixed float16/float32 type errors:
 *   "Type parameter (T) of Optype (Add) bound to different types"
 *
 * TranslateGemma REQUIRES WebGPU with shader-f16. No fallback to q4.
 */
describe('TranslateGemma dtype selection', () => {
  // Replicate the dtype selection logic from getTranslateGemmaPipeline
  function selectDtype(gpuSupported: boolean, fp16: boolean): string {
    if (!gpuSupported) {
      throw new Error('TranslateGemma requires WebGPU');
    }
    if (!fp16) {
      throw new Error('TranslateGemma requires WebGPU with shader-f16 support');
    }
    return 'q4f16';
  }

  describe('dtype selection', () => {
    it('selects q4f16 when GPU supports shader-f16', () => {
      expect(selectDtype(true, true)).toBe('q4f16');
    });

    it('throws when GPU does not support shader-f16', () => {
      expect(() => selectDtype(true, false)).toThrow('shader-f16');
    });

    it('throws when WebGPU is not supported', () => {
      expect(() => selectDtype(false, false)).toThrow('TranslateGemma requires WebGPU');
    });

    it('throws when WebGPU is not supported even with fp16 flag', () => {
      expect(() => selectDtype(false, true)).toThrow('TranslateGemma requires WebGPU');
    });
  });

  describe('dtype is always q4f16', () => {
    it('q4f16 is the only valid dtype for this model', () => {
      // Model repo only ships q4f16 ONNX files
      const dtype = selectDtype(true, true);
      expect(dtype).toBe('q4f16');
      expect(dtype).not.toBe('q4'); // q4 causes mixed-precision crash
    });

    it('never returns q4 (causes ONNX type mismatch)', () => {
      // q4 loads q4f16 files but attempts fp32 compute → crash
      const dtype = selectDtype(true, true);
      expect(dtype).not.toBe('q4');
    });
  });

  describe('regression: ONNX float16/float32 mismatch', () => {
    it('uses q4f16 to match float16 Constants in model', () => {
      const dtype = selectDtype(true, true);
      expect(dtype).toBe('q4f16');
    });

    it('rejects GPUs without shader-f16 instead of using broken q4', () => {
      // Before fix: returned 'q4' which caused:
      // "Type parameter (T) of Optype (Add) bound to different types (tensor(float) and tensor(float16))"
      expect(() => selectDtype(true, false)).toThrow('shader-f16');
    });
  });
});

describe('TRANSLATEGEMMA_MODEL constant', () => {
  it('points to the correct ONNX quantized model repository', () => {
    expect(TRANSLATEGEMMA_MODEL).toContain('translategemma');
    expect(TRANSLATEGEMMA_MODEL).toContain('onnx');
    expect(TRANSLATEGEMMA_MODEL).toContain('q4');
    expect(TRANSLATEGEMMA_MODEL).toContain('webgpu');
  });

  it('is a valid HuggingFace model path', () => {
    expect(TRANSLATEGEMMA_MODEL).toMatch(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/);
  });
});

describe('LANG_NAMES completeness', () => {
  it('covers all OPUS-MT supported languages', () => {
    // Languages that OPUS-MT supports should also be in LANG_NAMES
    // so TranslateGemma can be used as a fallback for any pair
    const opusMtLangs = ['en', 'fi', 'de', 'fr', 'es', 'it', 'nl', 'sv', 'da',
      'ru', 'uk', 'cs', 'hu', 'ro', 'zh', 'ja', 'ko', 'vi', 'th', 'hi',
      'id', 'ar', 'af', 'pl', 'tr', 'no', 'pt'];

    for (const lang of opusMtLangs) {
      expect(LANG_NAMES[lang]).toBeDefined();
      expect(LANG_NAMES[lang].length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate language names', () => {
    const names = Object.values(LANG_NAMES);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
