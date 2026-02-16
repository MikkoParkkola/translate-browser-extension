/**
 * Offscreen document unit tests
 *
 * Tests language detection, model mapping, and message handling
 * for the ML inference offscreen document.
 *
 * Note: We test pure functions and logic extracted from the module
 * since the module has side effects that run on import.
 */

import { describe, it, expect, vi } from 'vitest';

// Test the pure functions and data structures from offscreen module
// without importing the module directly (which has side effects)

describe('Offscreen Model Mapping', () => {
  // Replicate the MODEL_MAP from offscreen.ts for testing
  const MODEL_MAP: Record<string, string> = {
    'en-fi': 'Xenova/opus-mt-en-fi',
    'fi-en': 'Xenova/opus-mt-fi-en',
    'en-de': 'Xenova/opus-mt-en-de',
    'de-en': 'Xenova/opus-mt-de-en',
    'en-fr': 'Xenova/opus-mt-en-fr',
    'fr-en': 'Xenova/opus-mt-fr-en',
    'en-es': 'Xenova/opus-mt-en-es',
    'es-en': 'Xenova/opus-mt-es-en',
    'en-sv': 'Xenova/opus-mt-en-sv',
    'sv-en': 'Xenova/opus-mt-sv-en',
    'en-ru': 'Xenova/opus-mt-en-ru',
    'ru-en': 'Xenova/opus-mt-ru-en',
    'en-zh': 'Xenova/opus-mt-en-zh',
    'zh-en': 'Xenova/opus-mt-zh-en',
    'en-ja': 'Xenova/opus-mt-en-jap',
    'ja-en': 'Xenova/opus-mt-jap-en',
  };

  describe('supported language pairs', () => {
    it('has 16 language pairs', () => {
      expect(Object.keys(MODEL_MAP).length).toBe(16);
    });

    it('maps English to Finnish', () => {
      expect(MODEL_MAP['en-fi']).toBe('Xenova/opus-mt-en-fi');
    });

    it('maps Finnish to English', () => {
      expect(MODEL_MAP['fi-en']).toBe('Xenova/opus-mt-fi-en');
    });

    it('maps all pairs bidirectionally', () => {
      const languages = ['fi', 'de', 'fr', 'es', 'sv', 'ru', 'zh', 'ja'];
      for (const lang of languages) {
        expect(MODEL_MAP[`en-${lang}`]).toBeDefined();
        expect(MODEL_MAP[`${lang}-en`]).toBeDefined();
      }
    });

    it('uses correct model naming for Japanese', () => {
      // Japanese uses 'jap' in model names
      expect(MODEL_MAP['en-ja']).toBe('Xenova/opus-mt-en-jap');
      expect(MODEL_MAP['ja-en']).toBe('Xenova/opus-mt-jap-en');
    });
  });

  describe('unsupported pairs', () => {
    it('returns undefined for unsupported pairs', () => {
      expect(MODEL_MAP['fi-de']).toBeUndefined();
      expect(MODEL_MAP['xx-yy']).toBeUndefined();
    });
  });
});

describe('FRANC_TO_ISO Mapping', () => {
  const FRANC_TO_ISO: Record<string, string> = {
    eng: 'en',
    fin: 'fi',
    deu: 'de',
    fra: 'fr',
    spa: 'es',
    swe: 'sv',
    rus: 'ru',
    cmn: 'zh',
    jpn: 'ja',
  };

  it('maps all supported ISO 639-3 codes', () => {
    expect(FRANC_TO_ISO['eng']).toBe('en');
    expect(FRANC_TO_ISO['fin']).toBe('fi');
    expect(FRANC_TO_ISO['deu']).toBe('de');
    expect(FRANC_TO_ISO['fra']).toBe('fr');
    expect(FRANC_TO_ISO['spa']).toBe('es');
    expect(FRANC_TO_ISO['swe']).toBe('sv');
    expect(FRANC_TO_ISO['rus']).toBe('ru');
    expect(FRANC_TO_ISO['cmn']).toBe('zh');
    expect(FRANC_TO_ISO['jpn']).toBe('ja');
  });

  it('returns undefined for unmapped codes', () => {
    expect(FRANC_TO_ISO['xyz']).toBeUndefined();
    expect(FRANC_TO_ISO['und']).toBeUndefined();
  });
});

describe('getSupportedLanguages', () => {
  const MODEL_MAP: Record<string, string> = {
    'en-fi': 'Xenova/opus-mt-en-fi',
    'fi-en': 'Xenova/opus-mt-fi-en',
    'en-de': 'Xenova/opus-mt-en-de',
    'de-en': 'Xenova/opus-mt-de-en',
    'en-fr': 'Xenova/opus-mt-en-fr',
    'fr-en': 'Xenova/opus-mt-fr-en',
    'en-es': 'Xenova/opus-mt-en-es',
    'es-en': 'Xenova/opus-mt-es-en',
    'en-sv': 'Xenova/opus-mt-en-sv',
    'sv-en': 'Xenova/opus-mt-sv-en',
    'en-ru': 'Xenova/opus-mt-en-ru',
    'ru-en': 'Xenova/opus-mt-ru-en',
    'en-zh': 'Xenova/opus-mt-en-zh',
    'zh-en': 'Xenova/opus-mt-zh-en',
    'en-ja': 'Xenova/opus-mt-en-jap',
    'ja-en': 'Xenova/opus-mt-jap-en',
  };

  function getSupportedLanguages(): Array<{ src: string; tgt: string }> {
    return Object.keys(MODEL_MAP).map((key) => {
      const [src, tgt] = key.split('-');
      return { src, tgt };
    });
  }

  it('returns array of language pair objects', () => {
    const langs = getSupportedLanguages();
    expect(Array.isArray(langs)).toBe(true);
    expect(langs.length).toBe(16);
  });

  it('each pair has src and tgt properties', () => {
    const langs = getSupportedLanguages();
    for (const pair of langs) {
      expect(pair).toHaveProperty('src');
      expect(pair).toHaveProperty('tgt');
      expect(typeof pair.src).toBe('string');
      expect(typeof pair.tgt).toBe('string');
    }
  });

  it('includes en-fi pair', () => {
    const langs = getSupportedLanguages();
    expect(langs).toContainEqual({ src: 'en', tgt: 'fi' });
  });

  it('includes all reverse pairs', () => {
    const langs = getSupportedLanguages();
    expect(langs).toContainEqual({ src: 'fi', tgt: 'en' });
    expect(langs).toContainEqual({ src: 'de', tgt: 'en' });
    expect(langs).toContainEqual({ src: 'ja', tgt: 'en' });
  });
});

describe('Language Detection Logic', () => {
  // Test the character set detection fallback logic

  describe('character set detection', () => {
    const detectByCharset = (text: string): string | null => {
      if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // Japanese
      if (/[\u4e00-\u9fff]/.test(text)) return 'zh'; // Chinese
      if (/[\u0400-\u04ff]/.test(text)) return 'ru'; // Cyrillic -> Russian
      if (/[äöåÄÖÅ]/.test(text)) return 'fi'; // Finnish characters
      return null;
    };

    it('detects Japanese from hiragana', () => {
      expect(detectByCharset('こんにちは')).toBe('ja');
    });

    it('detects Japanese from katakana', () => {
      expect(detectByCharset('コンニチハ')).toBe('ja');
    });

    it('detects Chinese from Han characters', () => {
      expect(detectByCharset('你好世界')).toBe('zh');
    });

    it('detects Russian from Cyrillic', () => {
      expect(detectByCharset('Привет мир')).toBe('ru');
    });

    it('detects Finnish from umlauts', () => {
      expect(detectByCharset('päivää')).toBe('fi');
      expect(detectByCharset('ÄÄNEKOSKI')).toBe('fi');
      expect(detectByCharset('mörkö')).toBe('fi');
    });

    it('returns null for ASCII text', () => {
      expect(detectByCharset('hello world')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(detectByCharset('')).toBeNull();
    });

    it('prioritizes Japanese over Chinese for mixed text', () => {
      // If text has hiragana/katakana, it's Japanese (even with kanji)
      expect(detectByCharset('日本語です')).toBe('ja');
    });
  });

  describe('detectLanguage function', () => {
    // Recreate the full detectLanguage function for testing
    const FRANC_TO_ISO: Record<string, string> = {
      eng: 'en',
      fin: 'fi',
      deu: 'de',
      fra: 'fr',
      spa: 'es',
      swe: 'sv',
      rus: 'ru',
      cmn: 'zh',
      jpn: 'ja',
    };

    // Mock franc behavior
    const mockFranc = (text: string): string => {
      if (!text || text.length < 3) return 'und';
      // Check language-specific words (order matters - more specific first)
      if (/hallo|welt|wie|deutsch/i.test(text)) return 'deu';
      if (/bonjour|monde|francais|comment/i.test(text)) return 'fra';
      if (/hola|mundo|espanol|como/i.test(text)) return 'spa';
      if (/hej|varld|svensk|hur/i.test(text)) return 'swe';
      if (/hei|maailma|suomi|finnish|mita/i.test(text)) return 'fin';
      if (/hello|world|the|are|have|how|today/i.test(text)) return 'eng';
      return 'und';
    };

    const detectLanguage = (text: string): string => {
      const detected = mockFranc(text);

      if (detected === 'und' || !detected) {
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
        if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
        if (/[\u0400-\u04ff]/.test(text)) return 'ru';
        if (/[äöåÄÖÅ]/.test(text)) return 'fi';
        return 'en';
      }

      return FRANC_TO_ISO[detected] || 'en';
    };

    it('detects English', () => {
      expect(detectLanguage('Hello world, how are you today?')).toBe('en');
    });

    it('detects Finnish', () => {
      expect(detectLanguage('Hei maailma, mita kuuluu')).toBe('fi');
    });

    it('detects German', () => {
      expect(detectLanguage('Hallo Welt, wie ist es')).toBe('de');
    });

    it('detects French', () => {
      expect(detectLanguage('Bonjour monde, comment est')).toBe('fr');
    });

    it('detects Spanish', () => {
      expect(detectLanguage('Hola mundo, como es')).toBe('es');
    });

    it('detects Swedish', () => {
      expect(detectLanguage('Hej varld, hur svensk')).toBe('sv');
    });

    it('falls back to charset for undetermined', () => {
      expect(detectLanguage('xyz')).toBe('en'); // Default fallback
    });

    it('detects Japanese via charset fallback', () => {
      expect(detectLanguage('こんにちは')).toBe('ja');
    });

    it('detects Chinese via charset fallback', () => {
      expect(detectLanguage('你好')).toBe('zh');
    });

    it('detects Russian via charset fallback', () => {
      expect(detectLanguage('Привет')).toBe('ru');
    });

    it('detects Finnish via umlaut fallback', () => {
      expect(detectLanguage('äöå')).toBe('fi');
    });

    it('handles empty string', () => {
      expect(detectLanguage('')).toBe('en');
    });

    it('handles very short text', () => {
      expect(detectLanguage('Hi')).toBe('en');
    });
  });
});

describe('Token Estimation', () => {
  // Token estimation from throttle/service-worker - ~4 chars per token
  function estimateTokens(text: string | string[]): number {
    const str = Array.isArray(text) ? text.join(' ') : text;
    return Math.max(1, Math.ceil(str.length / 4));
  }

  it('estimates single word', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 chars / 4 = 1.25 -> 2
  });

  it('estimates sentence', () => {
    expect(estimateTokens('Hello world')).toBe(3); // 11 chars / 4 = 2.75 -> 3
  });

  it('estimates array of texts', () => {
    expect(estimateTokens(['Hello', 'world'])).toBe(3); // 'Hello world' = 11 chars
  });

  it('returns minimum 1 for empty string', () => {
    expect(estimateTokens('')).toBe(1);
  });

  it('handles long text', () => {
    const longText = 'a'.repeat(100);
    expect(estimateTokens(longText)).toBe(25); // 100 / 4 = 25
  });

  it('handles empty array', () => {
    expect(estimateTokens([])).toBe(1); // '' -> 1 minimum
  });
});

describe('Rate Limit Logic', () => {
  interface RateLimitState {
    requests: number;
    tokens: number;
    windowStart: number;
  }

  const RATE_LIMIT = {
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
    windowMs: 60000,
  };

  function checkRateLimit(
    state: RateLimitState,
    tokenEstimate: number,
    now: number
  ): { allowed: boolean; state: RateLimitState } {
    let newState = { ...state };

    // Reset window if expired
    if (now - state.windowStart > RATE_LIMIT.windowMs) {
      newState = {
        requests: 0,
        tokens: 0,
        windowStart: now,
      };
    }

    // Check limits
    if (newState.requests >= RATE_LIMIT.requestsPerMinute) {
      return { allowed: false, state: newState };
    }
    if (newState.tokens + tokenEstimate > RATE_LIMIT.tokensPerMinute) {
      return { allowed: false, state: newState };
    }

    return { allowed: true, state: newState };
  }

  it('allows request under limits', () => {
    const now = Date.now();
    const state: RateLimitState = {
      requests: 0,
      tokens: 0,
      windowStart: now,
    };

    const { allowed } = checkRateLimit(state, 100, now);
    expect(allowed).toBe(true);
  });

  it('allows at edge of request limit', () => {
    const now = Date.now();
    const state: RateLimitState = {
      requests: 59,
      tokens: 0,
      windowStart: now,
    };

    const { allowed } = checkRateLimit(state, 100, now);
    expect(allowed).toBe(true);
  });

  it('denies when request limit reached', () => {
    const now = Date.now();
    const state: RateLimitState = {
      requests: 60,
      tokens: 0,
      windowStart: now,
    };

    const { allowed } = checkRateLimit(state, 100, now);
    expect(allowed).toBe(false);
  });

  it('allows at edge of token limit', () => {
    const now = Date.now();
    const state: RateLimitState = {
      requests: 0,
      tokens: 99900,
      windowStart: now,
    };

    const { allowed } = checkRateLimit(state, 100, now);
    expect(allowed).toBe(true);
  });

  it('denies when token limit would be exceeded', () => {
    const now = Date.now();
    const state: RateLimitState = {
      requests: 0,
      tokens: 99950,
      windowStart: now,
    };

    const { allowed } = checkRateLimit(state, 100, now);
    expect(allowed).toBe(false);
  });

  it('resets after window expires', () => {
    const now = Date.now();
    const state: RateLimitState = {
      requests: 60,
      tokens: 100000,
      windowStart: now - 70000, // 70 seconds ago
    };

    const { allowed, state: newState } = checkRateLimit(state, 100, now);
    expect(allowed).toBe(true);
    expect(newState.requests).toBe(0);
    expect(newState.tokens).toBe(0);
    expect(newState.windowStart).toBe(now);
  });
});

describe('Error Handling', () => {
  describe('error message extraction', () => {
    function extractErrorMessage(error: unknown): string {
      if (error instanceof Error) {
        return error.message;
      }
      if (typeof error === 'object' && error !== null) {
        return JSON.stringify(error);
      }
      return String(error);
    }

    it('extracts message from Error', () => {
      const error = new Error('Test error');
      expect(extractErrorMessage(error)).toBe('Test error');
    });

    it('stringifies object errors', () => {
      const error = { code: 'ERR_001', message: 'Failed' };
      expect(extractErrorMessage(error)).toBe('{"code":"ERR_001","message":"Failed"}');
    });

    it('converts primitives to string', () => {
      expect(extractErrorMessage('string error')).toBe('string error');
      expect(extractErrorMessage(123)).toBe('123');
      expect(extractErrorMessage(null)).toBe('null');
      expect(extractErrorMessage(undefined)).toBe('undefined');
    });

    it('handles empty object', () => {
      expect(extractErrorMessage({})).toBe('{}');
    });

    it('handles nested error object', () => {
      const error = { outer: { inner: 'value' } };
      expect(extractErrorMessage(error)).toBe('{"outer":{"inner":"value"}}');
    });
  });
});

describe('Translation Result Handling', () => {
  // Test the result extraction from pipeline output
  type PipelineResult = Array<{ translation_text: string }>;

  function extractTranslation(result: PipelineResult): string {
    return result[0].translation_text;
  }

  it('extracts translation from result array', () => {
    const result: PipelineResult = [{ translation_text: 'Moi maailma' }];
    expect(extractTranslation(result)).toBe('Moi maailma');
  });

  it('handles empty translation text', () => {
    const result: PipelineResult = [{ translation_text: '' }];
    expect(extractTranslation(result)).toBe('');
  });

  it('handles long translation', () => {
    const longText = 'a'.repeat(10000);
    const result: PipelineResult = [{ translation_text: longText }];
    expect(extractTranslation(result)).toBe(longText);
  });
});

describe('WebGPU Detection Logic', () => {
  // Mirrors the upgraded detectWebGPU in offscreen.ts that returns {supported, fp16}
  async function detectWebGPU(navigatorGpu: unknown): Promise<{ supported: boolean; fp16: boolean }> {
    if (!navigatorGpu) return { supported: false, fp16: false };
    try {
      const gpu = navigatorGpu as { requestAdapter: () => Promise<{ features: { has: (f: string) => boolean } } | null> };
      const adapter = await gpu.requestAdapter();
      if (!adapter) return { supported: false, fp16: false };
      const fp16 = adapter.features.has('shader-f16');
      return { supported: true, fp16 };
    } catch {
      return { supported: false, fp16: false };
    }
  }

  it('returns {supported: false, fp16: false} when navigator.gpu is undefined', async () => {
    expect(await detectWebGPU(undefined)).toEqual({ supported: false, fp16: false });
  });

  it('returns {supported: false, fp16: false} when navigator.gpu is null', async () => {
    expect(await detectWebGPU(null)).toEqual({ supported: false, fp16: false });
  });

  it('returns {supported: false, fp16: false} when adapter is null', async () => {
    const mockGpu = {
      requestAdapter: vi.fn().mockResolvedValue(null),
    };
    expect(await detectWebGPU(mockGpu)).toEqual({ supported: false, fp16: false });
  });

  it('returns {supported: true, fp16: true} when adapter supports shader-f16', async () => {
    const mockGpu = {
      requestAdapter: vi.fn().mockResolvedValue({
        features: { has: (f: string) => f === 'shader-f16' },
      }),
    };
    expect(await detectWebGPU(mockGpu)).toEqual({ supported: true, fp16: true });
  });

  it('returns {supported: true, fp16: false} when adapter lacks shader-f16', async () => {
    const mockGpu = {
      requestAdapter: vi.fn().mockResolvedValue({
        features: { has: () => false },
      }),
    };
    expect(await detectWebGPU(mockGpu)).toEqual({ supported: true, fp16: false });
  });

  it('returns {supported: false, fp16: false} when requestAdapter throws', async () => {
    const mockGpu = {
      requestAdapter: vi.fn().mockRejectedValue(new Error('WebGPU error')),
    };
    expect(await detectWebGPU(mockGpu)).toEqual({ supported: false, fp16: false });
  });
});

describe('OPUS-MT dtype selection', () => {
  // Xenova/Helsinki-NLP OPUS-MT models only ship _quantized (q8) ONNX variants.
  // fp16 causes mixed-precision ONNX Runtime crash. Always use q8.

  // Replicate the selectOpusMtDtype logic from offscreen.ts
  function selectOpusMtDtype(_webgpu: { supported: boolean; fp16: boolean }): string {
    // Always q8 for OPUS-MT — fp16 causes mixed-precision crash
    return 'q8';
  }

  it('always uses q8 even when WebGPU + shader-f16 is available', () => {
    expect(selectOpusMtDtype({ supported: true, fp16: true })).toBe('q8');
  });

  it('uses q8 when WebGPU is available but shader-f16 is not', () => {
    expect(selectOpusMtDtype({ supported: true, fp16: false })).toBe('q8');
  });

  it('uses q8 when WASM fallback (no WebGPU)', () => {
    expect(selectOpusMtDtype({ supported: false, fp16: false })).toBe('q8');
  });

  it('does NOT use fp32 in any scenario (wasteful ~170MB)', () => {
    const scenarios: Array<{ supported: boolean; fp16: boolean }> = [
      { supported: true, fp16: true },
      { supported: true, fp16: false },
      { supported: false, fp16: false },
    ];
    for (const scenario of scenarios) {
      expect(selectOpusMtDtype(scenario)).not.toBe('fp32');
    }
  });

  it('does NOT use fp16/q4/q4f16 for OPUS-MT', () => {
    const dtype = selectOpusMtDtype({ supported: true, fp16: true });
    expect(dtype).not.toBe('fp16');
    expect(dtype).not.toBe('q4');
    expect(dtype).not.toBe('q4f16');
  });
});

describe('OPUS-MT WebGPU fallback logic', () => {
  // If WebGPU fails (GPU incompatibility), fall back to WASM + q8
  // This tests the fallback strategy used in offscreen.ts getPipeline()

  interface PipelineConfig {
    device: 'webgpu' | 'wasm';
    dtype: string;
  }

  function selectOpusMtDtype(_webgpu: { supported: boolean; fp16: boolean }): string {
    return 'q8'; // Always q8 for OPUS-MT
  }

  function getPipelineConfig(webgpu: { supported: boolean; fp16: boolean }): PipelineConfig {
    return {
      device: webgpu.supported ? 'webgpu' : 'wasm',
      dtype: selectOpusMtDtype(webgpu),
    };
  }

  function getFallbackConfig(): PipelineConfig {
    return { device: 'wasm', dtype: 'q8' };
  }

  it('uses WebGPU+q8 even when shader-f16 supported', () => {
    const config = getPipelineConfig({ supported: true, fp16: true });
    expect(config.device).toBe('webgpu');
    expect(config.dtype).toBe('q8');
  });

  it('uses WebGPU+q8 when no shader-f16', () => {
    const config = getPipelineConfig({ supported: true, fp16: false });
    expect(config.device).toBe('webgpu');
    expect(config.dtype).toBe('q8');
  });

  it('uses WASM+q8 when WebGPU not supported', () => {
    const config = getPipelineConfig({ supported: false, fp16: false });
    expect(config.device).toBe('wasm');
    expect(config.dtype).toBe('q8');
  });

  it('fallback always uses WASM + q8', () => {
    const fallback = getFallbackConfig();
    expect(fallback.device).toBe('wasm');
    expect(fallback.dtype).toBe('q8');
  });

  it('fallback matches primary WASM path', () => {
    const primary = getPipelineConfig({ supported: false, fp16: false });
    const fallback = getFallbackConfig();
    expect(primary.dtype).toBe(fallback.dtype);
    expect(primary.dtype).toBe('q8');
  });
});

describe('Provider routing in offscreen document', () => {
  // Test that the offscreen message handler routes to the correct provider

  type ProviderId = 'opus-mt' | 'translategemma' | 'chrome-builtin' | 'deepl' | 'openai' | 'anthropic' | 'google-cloud';

  function classifyProvider(provider: ProviderId): 'local-opusmt' | 'local-gemma' | 'local-chrome' | 'cloud' {
    if (provider === 'opus-mt') return 'local-opusmt';
    if (provider === 'translategemma') return 'local-gemma';
    if (provider === 'chrome-builtin') return 'local-chrome';
    return 'cloud';
  }

  describe('local provider classification', () => {
    it('classifies opus-mt as local-opusmt', () => {
      expect(classifyProvider('opus-mt')).toBe('local-opusmt');
    });

    it('classifies translategemma as local-gemma', () => {
      expect(classifyProvider('translategemma')).toBe('local-gemma');
    });

    it('classifies chrome-builtin as local-chrome', () => {
      expect(classifyProvider('chrome-builtin')).toBe('local-chrome');
    });
  });

  describe('cloud provider classification', () => {
    it.each([
      'deepl', 'openai', 'anthropic', 'google-cloud',
    ] as ProviderId[])('classifies %s as cloud', (provider) => {
      expect(classifyProvider(provider)).toBe('cloud');
    });
  });

  describe('default provider', () => {
    it('opus-mt is the default provider when none specified', () => {
      // This mirrors the offscreen.ts translate() default parameter
      const defaultProvider: ProviderId = 'opus-mt';
      expect(classifyProvider(defaultProvider)).toBe('local-opusmt');
    });
  });
});

describe('withTimeout utility', () => {
  // Replicate the withTimeout function from offscreen.ts
  function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${message} (${ms / 1000}s)`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  it('resolves when promise resolves before timeout', async () => {
    const result = await withTimeout(
      Promise.resolve('ok'),
      1000,
      'test'
    );
    expect(result).toBe('ok');
  });

  it('rejects with timeout error when promise takes too long', async () => {
    const neverResolves = new Promise<string>(() => { /* intentionally never resolves */ });
    await expect(
      withTimeout(neverResolves, 50, 'slow operation')
    ).rejects.toThrow('Timeout: slow operation (0.05s)');
  });

  it('includes duration in timeout error message', async () => {
    const neverResolves = new Promise<string>(() => {});
    try {
      await withTimeout(neverResolves, 100, 'test op');
    } catch (error) {
      expect((error as Error).message).toContain('0.1s');
      expect((error as Error).message).toContain('test op');
    }
  });

  it('rejects with original error when promise rejects before timeout', async () => {
    const failingPromise = Promise.reject(new Error('original error'));
    await expect(
      withTimeout(failingPromise, 1000, 'test')
    ).rejects.toThrow('original error');
  });
});
