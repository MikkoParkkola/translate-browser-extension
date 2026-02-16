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
  isWebGpuOnnxTainted,
  isOnnxTypeMismatch,
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
 * TranslateGemma dtype and device selection tests.
 *
 * The model repo (m1cc0z/translategemma-4b-it-onnx-q4-webgpu) ships both:
 * - model_q4f16.onnx: for WebGPU with shader-f16 (float16 compute, fastest)
 * - model_q4.onnx: for WebGPU/WASM with float32 compute (avoids fp16 type issues)
 *
 * Strategy: webgpu+q4f16 -> webgpu+q4 -> wasm+q4 (progressive fallback)
 */
describe('TranslateGemma dtype/device selection', () => {
  // Replicate the initial selection from getTranslateGemmaPipeline
  function selectInitialDeviceAndDtype(
    gpuSupported: boolean,
    fp16: boolean
  ): { device: 'webgpu' | 'wasm'; dtype: string } {
    if (!gpuSupported) {
      return { device: 'wasm', dtype: 'q4' };
    }
    if (fp16) {
      return { device: 'webgpu', dtype: 'q4f16' };
    }
    // WebGPU available but no shader-f16: use q4 (fp32 compute) on WebGPU
    return { device: 'webgpu', dtype: 'q4' };
  }

  describe('primary path: WebGPU + q4f16', () => {
    it('selects WebGPU + q4f16 when GPU supports shader-f16', () => {
      const { device, dtype } = selectInitialDeviceAndDtype(true, true);
      expect(device).toBe('webgpu');
      expect(dtype).toBe('q4f16');
    });
  });

  describe('intermediate path: WebGPU + q4 (fp32)', () => {
    it('selects WebGPU + q4 when GPU lacks shader-f16', () => {
      const { device, dtype } = selectInitialDeviceAndDtype(true, false);
      expect(device).toBe('webgpu');
      expect(dtype).toBe('q4');
    });
  });

  describe('fallback path: WASM + q4', () => {
    it('falls back to WASM + q4 when WebGPU is not supported', () => {
      const { device, dtype } = selectInitialDeviceAndDtype(false, false);
      expect(device).toBe('wasm');
      expect(dtype).toBe('q4');
    });

    it('falls back to WASM + q4 even with fp16 flag when no WebGPU', () => {
      const { device, dtype } = selectInitialDeviceAndDtype(false, true);
      expect(device).toBe('wasm');
      expect(dtype).toBe('q4');
    });
  });

  describe('dtype correctness', () => {
    it('WebGPU+fp16 path uses q4f16', () => {
      const { dtype } = selectInitialDeviceAndDtype(true, true);
      expect(dtype).toBe('q4f16');
    });

    it('WebGPU-only path uses q4 (fp32)', () => {
      const { dtype } = selectInitialDeviceAndDtype(true, false);
      expect(dtype).toBe('q4');
    });

    it('WASM path uses q4', () => {
      const { dtype } = selectInitialDeviceAndDtype(false, false);
      expect(dtype).toBe('q4');
    });
  });

  describe('regression: ONNX float16/float32 mismatch', () => {
    it('when shader-f16 unavailable, still uses WebGPU with q4 (not WASM)', () => {
      const result = selectInitialDeviceAndDtype(true, false);
      expect(result).toEqual({ device: 'webgpu', dtype: 'q4' });
    });

    it('does not hard-reject when WebGPU unavailable (falls back to WASM)', () => {
      expect(() => selectInitialDeviceAndDtype(false, false)).not.toThrow();
      expect(selectInitialDeviceAndDtype(false, false)).toEqual({ device: 'wasm', dtype: 'q4' });
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

describe('isOnnxTypeMismatch (exported)', () => {
  it('detects "Type parameter" error as type mismatch', () => {
    const error = new Error(
      'Type parameter (T) of Optype (Add) bound to different types (tensor(float) and tensor(float16))'
    );
    expect(isOnnxTypeMismatch(error)).toBe(true);
  });

  it('detects "bound to different types" error as type mismatch', () => {
    const error = new Error('ONNX error: bound to different types in operator');
    expect(isOnnxTypeMismatch(error)).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isOnnxTypeMismatch(new Error('Network error'))).toBe(false);
    expect(isOnnxTypeMismatch(new Error('Out of memory'))).toBe(false);
    expect(isOnnxTypeMismatch(new Error('WebGPU not supported'))).toBe(false);
  });

  it('handles string errors', () => {
    expect(isOnnxTypeMismatch('Type parameter mismatch')).toBe(true);
    expect(isOnnxTypeMismatch('some other error')).toBe(false);
  });

  it('handles non-string/non-Error values', () => {
    expect(isOnnxTypeMismatch(42)).toBe(false);
    expect(isOnnxTypeMismatch(null)).toBe(false);
    expect(isOnnxTypeMismatch(undefined)).toBe(false);
  });
});

describe('isWebGpuOnnxTainted', () => {
  it('returns false initially (module fresh state)', () => {
    // Fresh module state - no WebGPU load has failed yet
    expect(isWebGpuOnnxTainted()).toBe(false);
  });
});

describe('TranslateGemma loading strategy with progressive fallback', () => {
  // The loading strategy: webgpu+q4f16 -> webgpu+q4 -> wasm+q4
  // Step 1: WebGPU + q4f16 (if fp16 shaders available)
  // Step 2: WebGPU + q4 (fp32 compute, avoids fp16 type mismatch)
  // Step 3: WASM + q4 (final fallback)

  async function loadWithStrategy(
    loadModel: (device: string, dtype: string) => Promise<{ model: string }>,
    gpuSupported: boolean,
    fp16: boolean
  ): Promise<{ model: string; device: string; dtype: string; tainted: boolean }> {
    let tainted = false;

    // No WebGPU: straight to WASM
    if (!gpuSupported) {
      const result = await loadModel('wasm', 'q4');
      return { ...result, device: 'wasm', dtype: 'q4', tainted };
    }

    // Step 1: Try WebGPU + q4f16 if fp16 shaders available
    if (fp16) {
      try {
        const result = await loadModel('webgpu', 'q4f16');
        return { ...result, device: 'webgpu', dtype: 'q4f16', tainted };
      } catch {
        // Fall through to step 2
      }
    }

    // Step 2: Try WebGPU + q4 (fp32 compute)
    try {
      const result = await loadModel('webgpu', 'q4');
      return { ...result, device: 'webgpu', dtype: 'q4', tainted };
    } catch {
      tainted = true;
    }

    // Step 3: WASM + q4
    const result = await loadModel('wasm', 'q4');
    return { ...result, device: 'wasm', dtype: 'q4', tainted };
  }

  describe('happy path: WebGPU + q4f16', () => {
    it('succeeds with WebGPU + q4f16 on first try', async () => {
      const loadModel = vi.fn().mockResolvedValue({ model: 'ok' });

      const result = await loadWithStrategy(loadModel, true, true);

      expect(result.device).toBe('webgpu');
      expect(result.dtype).toBe('q4f16');
      expect(result.tainted).toBe(false);
      expect(loadModel).toHaveBeenCalledTimes(1);
      expect(loadModel).toHaveBeenCalledWith('webgpu', 'q4f16');
    });
  });

  describe('q4f16 fails -> WebGPU + q4 succeeds', () => {
    it('falls back to WebGPU + q4 on q4f16 type mismatch', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('Type parameter (T) bound to different types'))
        .mockResolvedValueOnce({ model: 'ok-q4' });

      const result = await loadWithStrategy(loadModel, true, true);

      expect(result.device).toBe('webgpu');
      expect(result.dtype).toBe('q4');
      expect(result.tainted).toBe(false);
      expect(loadModel).toHaveBeenCalledTimes(2);
      expect(loadModel).toHaveBeenNthCalledWith(1, 'webgpu', 'q4f16');
      expect(loadModel).toHaveBeenNthCalledWith(2, 'webgpu', 'q4');
    });

    it('falls back to WebGPU + q4 on any q4f16 error', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('GPU device lost'))
        .mockResolvedValueOnce({ model: 'ok-q4' });

      const result = await loadWithStrategy(loadModel, true, true);

      expect(result.device).toBe('webgpu');
      expect(result.dtype).toBe('q4');
    });
  });

  describe('no fp16 -> WebGPU + q4 directly', () => {
    it('skips q4f16 and uses WebGPU + q4 when no shader-f16', async () => {
      const loadModel = vi.fn().mockResolvedValue({ model: 'ok-q4' });

      const result = await loadWithStrategy(loadModel, true, false);

      expect(result.device).toBe('webgpu');
      expect(result.dtype).toBe('q4');
      expect(loadModel).toHaveBeenCalledTimes(1);
      expect(loadModel).toHaveBeenCalledWith('webgpu', 'q4');
    });
  });

  describe('both WebGPU fail -> WASM fallback', () => {
    it('falls back to WASM when both WebGPU attempts fail', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('q4f16 type mismatch'))
        .mockRejectedValueOnce(new Error('q4 GPU crash'))
        .mockResolvedValueOnce({ model: 'wasm-ok' });

      const result = await loadWithStrategy(loadModel, true, true);

      expect(result.device).toBe('wasm');
      expect(result.dtype).toBe('q4');
      expect(result.tainted).toBe(true);
      expect(loadModel).toHaveBeenCalledTimes(3);
      expect(loadModel).toHaveBeenNthCalledWith(3, 'wasm', 'q4');
    });

    it('sets tainted flag when all WebGPU attempts fail', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('q4f16 fail'))
        .mockRejectedValueOnce(new Error('q4 fail'))
        .mockResolvedValueOnce({ model: 'wasm-ok' });

      const result = await loadWithStrategy(loadModel, true, true);

      expect(result.tainted).toBe(true);
    });
  });

  describe('no WebGPU -> straight to WASM', () => {
    it('uses WASM + q4 when WebGPU not supported', async () => {
      const loadModel = vi.fn().mockResolvedValue({ model: 'wasm-ok' });

      const result = await loadWithStrategy(loadModel, false, false);

      expect(result.device).toBe('wasm');
      expect(result.dtype).toBe('q4');
      expect(loadModel).toHaveBeenCalledTimes(1);
      expect(loadModel).toHaveBeenCalledWith('wasm', 'q4');
    });
  });

  describe('WebGPU q4 fails without fp16 -> WASM', () => {
    it('falls back to WASM when q4 on WebGPU fails (no fp16 available)', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('WebGPU q4 crash'))
        .mockResolvedValueOnce({ model: 'wasm-ok' });

      const result = await loadWithStrategy(loadModel, true, false);

      expect(result.device).toBe('wasm');
      expect(result.dtype).toBe('q4');
      expect(result.tainted).toBe(true);
      expect(loadModel).toHaveBeenCalledTimes(2);
      expect(loadModel).toHaveBeenNthCalledWith(1, 'webgpu', 'q4');
      expect(loadModel).toHaveBeenNthCalledWith(2, 'wasm', 'q4');
    });
  });

  describe('total failure', () => {
    it('throws when WASM fallback also fails', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('q4f16 fail'))
        .mockRejectedValueOnce(new Error('q4 fail'))
        .mockRejectedValueOnce(new Error('WASM OOM'));

      await expect(
        loadWithStrategy(loadModel, true, true)
      ).rejects.toThrow('WASM OOM');
    });
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
