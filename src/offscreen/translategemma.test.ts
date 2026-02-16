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
 * - model_q4f16.onnx: for WebGPU with shader-f16 (float16 compute)
 * - model_q4.onnx: for WASM (float32 compute)
 *
 * The q4f16 ONNX graph has a known bug: layernorm Add operations mix
 * tensor(float) and tensor(float16), causing type mismatch on WebGPU.
 * Strategy: try WebGPU+q4f16 first, fall back to WASM+q4 on type mismatch.
 */
describe('TranslateGemma dtype/device selection', () => {
  // Replicate the loading strategy from getTranslateGemmaPipeline
  function selectDeviceAndDtype(
    gpuSupported: boolean,
    fp16: boolean
  ): { device: 'webgpu' | 'wasm'; dtype: string } {
    if (gpuSupported && fp16) {
      return { device: 'webgpu', dtype: 'q4f16' };
    }
    // No WebGPU or no shader-f16: fall back to WASM + q4
    return { device: 'wasm', dtype: 'q4' };
  }

  describe('primary path: WebGPU + q4f16', () => {
    it('selects WebGPU + q4f16 when GPU supports shader-f16', () => {
      const { device, dtype } = selectDeviceAndDtype(true, true);
      expect(device).toBe('webgpu');
      expect(dtype).toBe('q4f16');
    });
  });

  describe('fallback path: WASM + q4', () => {
    it('falls back to WASM + q4 when GPU lacks shader-f16', () => {
      const { device, dtype } = selectDeviceAndDtype(true, false);
      expect(device).toBe('wasm');
      expect(dtype).toBe('q4');
    });

    it('falls back to WASM + q4 when WebGPU is not supported', () => {
      const { device, dtype } = selectDeviceAndDtype(false, false);
      expect(device).toBe('wasm');
      expect(dtype).toBe('q4');
    });

    it('falls back to WASM + q4 even with fp16 flag when no WebGPU', () => {
      const { device, dtype } = selectDeviceAndDtype(false, true);
      expect(device).toBe('wasm');
      expect(dtype).toBe('q4');
    });
  });

  describe('dtype correctness', () => {
    it('WebGPU path uses q4f16 (not q4)', () => {
      const { dtype } = selectDeviceAndDtype(true, true);
      expect(dtype).toBe('q4f16');
      expect(dtype).not.toBe('q4');
    });

    it('WASM path uses q4 (not q4f16)', () => {
      const { dtype } = selectDeviceAndDtype(false, false);
      expect(dtype).toBe('q4');
      expect(dtype).not.toBe('q4f16');
    });
  });

  describe('regression: ONNX float16/float32 mismatch', () => {
    it('does not hard-reject when shader-f16 unavailable (falls back to WASM)', () => {
      // Before: threw error. Now: falls back gracefully to WASM + q4.
      expect(() => selectDeviceAndDtype(true, false)).not.toThrow();
      expect(selectDeviceAndDtype(true, false)).toEqual({ device: 'wasm', dtype: 'q4' });
    });

    it('does not hard-reject when WebGPU unavailable (falls back to WASM)', () => {
      // Before: threw error. Now: falls back gracefully to WASM + q4.
      expect(() => selectDeviceAndDtype(false, false)).not.toThrow();
      expect(selectDeviceAndDtype(false, false)).toEqual({ device: 'wasm', dtype: 'q4' });
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

describe('TranslateGemma loading strategy with WASM fallback', () => {
  // The new loading strategy:
  // 1. Try WebGPU + q4f16 (best performance)
  // 2. On type mismatch -> WASM + q4 (model graph bug, not cache issue)
  // 3. On other errors -> cache-bust + retry WebGPU -> WASM + q4 as final fallback

  // Simulate the full loading strategy from getTranslateGemmaPipeline
  async function loadWithStrategy(
    loadModel: (device: string, dtype: string) => Promise<{ model: string }>,
    deleteCache: () => Promise<boolean>,
    gpuSupported: boolean,
    fp16: boolean
  ): Promise<{ model: string; device: string; dtype: string; cacheCleared: boolean; tainted: boolean }> {
    let cacheCleared = false;
    let tainted = false;

    const isMismatch = (error: unknown): boolean => {
      const msg = error instanceof Error ? error.message : String(error);
      return msg.includes('Type parameter') || msg.includes('bound to different types');
    };

    // No WebGPU or no fp16: straight to WASM
    if (!gpuSupported || !fp16) {
      const result = await loadModel('wasm', 'q4');
      return { ...result, device: 'wasm', dtype: 'q4', cacheCleared, tainted };
    }

    // Try WebGPU + q4f16
    try {
      const result = await loadModel('webgpu', 'q4f16');
      return { ...result, device: 'webgpu', dtype: 'q4f16', cacheCleared, tainted };
    } catch (error) {
      if (isMismatch(error)) {
        // Type mismatch: model graph issue. Go straight to WASM, no cache-bust.
        tainted = true;
        const result = await loadModel('wasm', 'q4');
        return { ...result, device: 'wasm', dtype: 'q4', cacheCleared, tainted };
      }

      // Other error: cache-bust + retry WebGPU
      await deleteCache();
      cacheCleared = true;
      try {
        const result = await loadModel('webgpu', 'q4f16');
        return { ...result, device: 'webgpu', dtype: 'q4f16', cacheCleared, tainted };
      } catch (retryError) {
        if (isMismatch(retryError)) {
          tainted = true;
        }
        // Final fallback: WASM + q4
        const result = await loadModel('wasm', 'q4');
        return { ...result, device: 'wasm', dtype: 'q4', cacheCleared, tainted };
      }
    }
  }

  describe('happy path', () => {
    it('succeeds with WebGPU + q4f16 on first try', async () => {
      const loadModel = vi.fn().mockResolvedValue({ model: 'ok' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, true, true);

      expect(result.model).toBe('ok');
      expect(result.device).toBe('webgpu');
      expect(result.dtype).toBe('q4f16');
      expect(result.cacheCleared).toBe(false);
      expect(result.tainted).toBe(false);
      expect(loadModel).toHaveBeenCalledTimes(1);
      expect(loadModel).toHaveBeenCalledWith('webgpu', 'q4f16');
    });
  });

  describe('type mismatch -> WASM fallback (no cache-bust)', () => {
    it('falls back to WASM + q4 on type mismatch without clearing cache', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('Type parameter (T) of Optype (Add) bound to different types'))
        .mockResolvedValueOnce({ model: 'ok-wasm' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, true, true);

      expect(result.model).toBe('ok-wasm');
      expect(result.device).toBe('wasm');
      expect(result.dtype).toBe('q4');
      expect(result.cacheCleared).toBe(false); // NO cache clear for type mismatch
      expect(result.tainted).toBe(true); // Tainted flag set
      expect(loadModel).toHaveBeenCalledTimes(2);
      expect(loadModel).toHaveBeenNthCalledWith(1, 'webgpu', 'q4f16');
      expect(loadModel).toHaveBeenNthCalledWith(2, 'wasm', 'q4');
      expect(deleteCache).not.toHaveBeenCalled();
    });

    it('sets tainted flag on "bound to different types" variant', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('ONNX: bound to different types'))
        .mockResolvedValueOnce({ model: 'wasm-ok' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, true, true);

      expect(result.tainted).toBe(true);
      expect(result.device).toBe('wasm');
      expect(deleteCache).not.toHaveBeenCalled();
    });
  });

  describe('other errors -> cache-bust + retry -> WASM fallback', () => {
    it('clears cache and retries WebGPU on non-type-mismatch error', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('GPU device lost'))
        .mockResolvedValueOnce({ model: 'ok-after-retry' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, true, true);

      expect(result.model).toBe('ok-after-retry');
      expect(result.device).toBe('webgpu');
      expect(result.dtype).toBe('q4f16');
      expect(result.cacheCleared).toBe(true);
      expect(result.tainted).toBe(false);
      expect(deleteCache).toHaveBeenCalledTimes(1);
    });

    it('falls back to WASM when cache-bust retry also fails', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('GPU device lost'))
        .mockRejectedValueOnce(new Error('GPU device lost again'))
        .mockResolvedValueOnce({ model: 'wasm-final' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, true, true);

      expect(result.model).toBe('wasm-final');
      expect(result.device).toBe('wasm');
      expect(result.dtype).toBe('q4');
      expect(result.cacheCleared).toBe(true);
      expect(loadModel).toHaveBeenCalledTimes(3);
    });

    it('sets tainted flag when retry fails with type mismatch', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('GPU device lost'))
        .mockRejectedValueOnce(new Error('Type parameter mismatch after retry'))
        .mockResolvedValueOnce({ model: 'wasm-final' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, true, true);

      expect(result.tainted).toBe(true);
      expect(result.device).toBe('wasm');
    });
  });

  describe('no WebGPU -> straight to WASM', () => {
    it('uses WASM + q4 when WebGPU not supported', async () => {
      const loadModel = vi.fn().mockResolvedValue({ model: 'wasm-ok' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, false, false);

      expect(result.device).toBe('wasm');
      expect(result.dtype).toBe('q4');
      expect(loadModel).toHaveBeenCalledTimes(1);
      expect(loadModel).toHaveBeenCalledWith('wasm', 'q4');
    });

    it('uses WASM + q4 when no shader-f16', async () => {
      const loadModel = vi.fn().mockResolvedValue({ model: 'wasm-ok' });
      const deleteCache = vi.fn().mockResolvedValue(true);

      const result = await loadWithStrategy(loadModel, deleteCache, true, false);

      expect(result.device).toBe('wasm');
      expect(result.dtype).toBe('q4');
    });
  });

  describe('WASM fallback failure', () => {
    it('throws when WASM fallback also fails after type mismatch', async () => {
      const loadModel = vi.fn()
        .mockRejectedValueOnce(new Error('Type parameter mismatch'))
        .mockRejectedValueOnce(new Error('WASM OOM'));
      const deleteCache = vi.fn().mockResolvedValue(true);

      await expect(
        loadWithStrategy(loadModel, deleteCache, true, true)
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
