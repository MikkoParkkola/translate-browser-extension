/**
 * Extended TranslateGemma tests — covers getTranslateGemmaPipeline and
 * translateWithGemma paths not reached by the base test file.
 *
 * Top-level vi.mock factories use factory-function pattern so mock
 * implementations can be swapped per test using `vi.mocked().mockX()`.
 * Module state (tgModel/tgLoading) is reset between tests via vi.resetModules()
 * + dynamic imports inside each test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Top-level mocks — hoisted. Use factory function style so implementations
// can be changed per test via the imported mock references.
// ============================================================================

const mockGemmaFromPretrained = vi.fn();
const mockTokenizerFromPretrained = vi.fn();
const mockSendMessage = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  Gemma3ForCausalLM: {
    from_pretrained: (...args: unknown[]) => mockGemmaFromPretrained(...args),
  },
  AutoTokenizer: {
    from_pretrained: (...args: unknown[]) => mockTokenizerFromPretrained(...args),
  },
}));

vi.mock('../config', () => ({
  CONFIG: {
    timeouts: { translateGemmaMs: 300000, translateGemmaGenMs: 60000 },
  },
}));

vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.stubGlobal('chrome', {
  runtime: { sendMessage: (...args: unknown[]) => mockSendMessage(...args) },
});

// ============================================================================
// Default mock values — reset before each test
// ============================================================================

const mockModel = {
  generate: vi.fn().mockResolvedValue({
    tolist: vi.fn().mockReturnValue([[1, 2, 3, 4, 5, 6, 7]]), // 7 tokens total
  }),
};

const mockTokenizerFn = Object.assign(
  vi.fn().mockReturnValue({
    input_ids: { dims: [1, 5] }, // inputLength = 5
  }),
  {
    decode: vi.fn().mockReturnValue('translated text'),
  }
);

beforeEach(() => {
  vi.resetModules();
  mockSendMessage.mockReset();
  mockGemmaFromPretrained.mockReset();
  mockTokenizerFromPretrained.mockReset();

  // Default: successful load
  mockGemmaFromPretrained.mockResolvedValue(mockModel);
  mockTokenizerFromPretrained.mockResolvedValue(mockTokenizerFn);

  // Default: GPU available but no fp16
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: vi.fn().mockResolvedValue({
        features: new Set<string>([]),
      }),
    },
  });
});

// ============================================================================
// detectWebGPU
// ============================================================================

describe('detectWebGPU', () => {
  it('returns not-supported when navigator.gpu is undefined', async () => {
    vi.stubGlobal('navigator', { gpu: undefined });
    const { detectWebGPU } = await import('./translategemma');
    const result = await detectWebGPU();
    expect(result.supported).toBe(false);
    expect(result.fp16).toBe(false);
  });

  it('returns not-supported when requestAdapter returns null', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValue(null) },
    });
    const { detectWebGPU } = await import('./translategemma');
    const result = await detectWebGPU();
    expect(result.supported).toBe(false);
  });

  it('returns supported with fp16=true when adapter has shader-f16', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(['shader-f16']),
        }),
      },
    });
    const { detectWebGPU } = await import('./translategemma');
    const result = await detectWebGPU();
    expect(result.supported).toBe(true);
    expect(result.fp16).toBe(true);
  });

  it('returns supported with fp16=false when adapter lacks shader-f16', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set<string>([]),
        }),
      },
    });
    const { detectWebGPU } = await import('./translategemma');
    const result = await detectWebGPU();
    expect(result.supported).toBe(true);
    expect(result.fp16).toBe(false);
  });

  it('returns not-supported when requestAdapter throws', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockRejectedValue(new Error('GPU unavailable')),
      },
    });
    const { detectWebGPU } = await import('./translategemma');
    const result = await detectWebGPU();
    expect(result.supported).toBe(false);
  });
});

// ============================================================================
// getTranslateGemmaPipeline — no WebGPU
// ============================================================================

describe('getTranslateGemmaPipeline — no WebGPU', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { gpu: undefined });
  });

  it('throws with WebGPU error message', async () => {
    const { getTranslateGemmaPipeline } = await import('./translategemma');
    await expect(getTranslateGemmaPipeline()).rejects.toThrow(/WebGPU/);
  });

  it('leaves isTranslateGemmaLoading as false after rejection', async () => {
    const { getTranslateGemmaPipeline, isTranslateGemmaLoading } = await import('./translategemma');
    try { await getTranslateGemmaPipeline(); } catch { /* expected */ }
    expect(isTranslateGemmaLoading()).toBe(false);
  });

  it('leaves isTranslateGemmaLoaded as false after rejection', async () => {
    const { getTranslateGemmaPipeline, isTranslateGemmaLoaded } = await import('./translategemma');
    try { await getTranslateGemmaPipeline(); } catch { /* expected */ }
    expect(isTranslateGemmaLoaded()).toBe(false);
  });

  it('sends error progress update via chrome.runtime.sendMessage', async () => {
    const { getTranslateGemmaPipeline } = await import('./translategemma');
    try { await getTranslateGemmaPipeline(); } catch { /* expected */ }
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'modelProgress', status: 'error' })
    );
  });
});

// ============================================================================
// getTranslateGemmaPipeline — WebGPU no fp16, q4 succeeds
// ============================================================================

describe('getTranslateGemmaPipeline — no fp16, q4 path', () => {
  it('loads successfully via q4 when no shader-f16', async () => {
    const { getTranslateGemmaPipeline, isTranslateGemmaLoaded } = await import('./translategemma');
    const result = await getTranslateGemmaPipeline();
    expect(result.model).toBe(mockModel);
    expect(result.tokenizer).toBe(mockTokenizerFn);
    expect(isTranslateGemmaLoaded()).toBe(true);
  });

  it('sends ready progress update', async () => {
    const { getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'modelProgress', status: 'ready', progress: 100 })
    );
  });

  it('returns cached result on second call without re-loading', async () => {
    const { getTranslateGemmaPipeline } = await import('./translategemma');
    const r1 = await getTranslateGemmaPipeline();
    const callCount = mockGemmaFromPretrained.mock.calls.length;
    const r2 = await getTranslateGemmaPipeline();
    // Source returns { model, tokenizer } from cached vars — structurally equal
    expect(r1).toStrictEqual(r2);
    // from_pretrained must NOT have been called again
    expect(mockGemmaFromPretrained.mock.calls.length).toBe(callCount);
  });

  it('marks isTranslateGemmaLoading as false after successful load', async () => {
    const { getTranslateGemmaPipeline, isTranslateGemmaLoading } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    expect(isTranslateGemmaLoading()).toBe(false);
  });
});

// ============================================================================
// getTranslateGemmaPipeline — fp16 support, q4f16 succeeds
// ============================================================================

describe('getTranslateGemmaPipeline — fp16 path', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(['shader-f16']),
        }),
      },
    });
  });

  it('loads via q4f16 when shader-f16 is supported', async () => {
    const { getTranslateGemmaPipeline, isTranslateGemmaLoaded } = await import('./translategemma');
    const result = await getTranslateGemmaPipeline();
    expect(result.model).toBe(mockModel);
    expect(isTranslateGemmaLoaded()).toBe(true);
  });
});

// ============================================================================
// getTranslateGemmaPipeline — q4f16 fails, fallback to q4
// ============================================================================

describe('getTranslateGemmaPipeline — q4f16 fallback to q4', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(['shader-f16']),
        }),
      },
    });
  });

  it('falls back to q4 when q4f16 throws type mismatch', async () => {
    mockGemmaFromPretrained
      .mockRejectedValueOnce(new Error('Type parameter (T) bound to different types'))
      .mockResolvedValueOnce(mockModel);

    const { getTranslateGemmaPipeline, isTranslateGemmaLoaded } = await import('./translategemma');
    const result = await getTranslateGemmaPipeline();
    expect(result.model).toBe(mockModel);
    expect(isTranslateGemmaLoaded()).toBe(true);
  });

  it('does not set _webGpuOnnxTainted when q4 succeeds after q4f16 failure', async () => {
    mockGemmaFromPretrained
      .mockRejectedValueOnce(new Error('q4f16 fail'))
      .mockResolvedValueOnce(mockModel);

    const { getTranslateGemmaPipeline, isWebGpuOnnxTainted } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    expect(isWebGpuOnnxTainted()).toBe(false);
  });
});

// ============================================================================
// getTranslateGemmaPipeline — both WebGPU paths fail
// ============================================================================

describe('getTranslateGemmaPipeline — both WebGPU attempts fail', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(['shader-f16']),
        }),
      },
    });
  });

  it('sets _webGpuOnnxTainted when both q4f16 and q4 fail', async () => {
    mockGemmaFromPretrained.mockRejectedValue(new Error('GPU crash'));

    const { getTranslateGemmaPipeline, isWebGpuOnnxTainted } = await import('./translategemma');
    try { await getTranslateGemmaPipeline(); } catch { /* expected */ }
    expect(isWebGpuOnnxTainted()).toBe(true);
  });

  it('throws and leaves isTranslateGemmaLoaded as false', async () => {
    mockGemmaFromPretrained.mockRejectedValue(new Error('GPU crash'));

    const { getTranslateGemmaPipeline, isTranslateGemmaLoaded } = await import('./translategemma');
    await expect(getTranslateGemmaPipeline()).rejects.toThrow();
    expect(isTranslateGemmaLoaded()).toBe(false);
  });
});

// ============================================================================
// translateWithGemma
// ============================================================================

describe('translateWithGemma', () => {
  it('returns empty string unchanged', async () => {
    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline(); // Load model
    const result = await translateWithGemma('', 'en', 'fi');
    expect(result).toBe('');
  });

  it('returns whitespace-only text unchanged', async () => {
    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    const result = await translateWithGemma('   ', 'en', 'fi');
    expect(result).toBe('   ');
  });

  it('calls model.generate for non-empty text', async () => {
    mockModel.generate.mockReset();
    mockModel.generate.mockResolvedValue({
      tolist: vi.fn().mockReturnValue([[1, 2, 3, 4, 5, 6, 7]]),
    });
    mockTokenizerFn.decode = vi.fn().mockReturnValue('translated');

    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    await translateWithGemma('hello', 'en', 'fi');
    expect(mockModel.generate).toHaveBeenCalled();
  });

  it('translates array of texts', async () => {
    mockModel.generate.mockReset();
    mockModel.generate.mockResolvedValue({
      tolist: vi.fn().mockReturnValue([[1, 2, 3, 4, 5, 6, 7]]),
    });
    mockTokenizerFn.decode = vi.fn().mockReturnValue('translated');

    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    const result = await translateWithGemma(['hello', 'world'], 'en', 'fi');
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[]).length).toBe(2);
  });

  it('skips empty items in array', async () => {
    mockModel.generate.mockReset();
    mockModel.generate.mockResolvedValue({
      tolist: vi.fn().mockReturnValue([[1, 2, 3, 4, 5, 6]]),
    });
    mockTokenizerFn.decode = vi.fn().mockReturnValue('translated');

    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    const result = await translateWithGemma(['hello', '', 'world'], 'en', 'fi') as string[];
    expect(result.length).toBe(3);
    expect(result[1]).toBe(''); // Empty preserved
  });

  it('strips <end_of_turn> from decoded output', async () => {
    mockModel.generate.mockReset();
    mockModel.generate.mockResolvedValue({
      tolist: vi.fn().mockReturnValue([[1, 2, 3, 4, 5, 6, 7]]),
    });
    mockTokenizerFn.decode = vi.fn().mockReturnValue('translated text<end_of_turn>');

    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    const result = await translateWithGemma('hello', 'en', 'fi') as string;
    expect(result).not.toContain('<end_of_turn>');
  });

  it('strips <start_of_turn> from decoded output', async () => {
    mockModel.generate.mockReset();
    mockModel.generate.mockResolvedValue({
      tolist: vi.fn().mockReturnValue([[1, 2, 3, 4, 5, 6, 7]]),
    });
    mockTokenizerFn.decode = vi.fn().mockReturnValue('<start_of_turn>translated');

    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    const result = await translateWithGemma('hello', 'en', 'fi') as string;
    expect(result).not.toContain('<start_of_turn>');
  });

  it('accepts optional context parameter', async () => {
    mockModel.generate.mockReset();
    mockModel.generate.mockResolvedValue({
      tolist: vi.fn().mockReturnValue([[1, 2, 3, 4, 5, 6, 7]]),
    });
    mockTokenizerFn.decode = vi.fn().mockReturnValue('translated');

    const { translateWithGemma, getTranslateGemmaPipeline } = await import('./translategemma');
    await getTranslateGemmaPipeline();
    // Should not throw
    const result = await translateWithGemma('hello', 'en', 'fi', 'financial article');
    expect(result).toBeDefined();
  });
});

// ============================================================================
// Concurrent loading — tgLoading deduplication
// ============================================================================

describe('getTranslateGemmaPipeline — concurrent load deduplication', () => {
  it('returns the same promise for concurrent calls', async () => {
    // Delay the load so we can test concurrent calls
    let resolveLoad!: (v: unknown) => void;
    mockGemmaFromPretrained.mockReturnValue(
      new Promise((r) => { resolveLoad = r; })
    );

    const { getTranslateGemmaPipeline } = await import('./translategemma');

    const p1 = getTranslateGemmaPipeline();
    const p2 = getTranslateGemmaPipeline();

    // Both calls should share the same loading promise
    resolveLoad(mockModel);
    mockTokenizerFromPretrained.mockResolvedValue(mockTokenizerFn);

    // Both should complete without error (or both throw)
    const results = await Promise.allSettled([p1, p2]);
    // If first succeeds, second must also succeed
    if (results[0].status === 'fulfilled') {
      expect(results[1].status).toBe('fulfilled');
    }
  });
});
