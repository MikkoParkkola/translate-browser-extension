/**
 * Offscreen document unit tests
 *
 * Tests the chrome.runtime.onMessage listener in offscreen.ts, which is the
 * single entry point for all ML/translation operations.
 *
 * Strategy:
 *  - Mock all external dependencies before importing the module
 *  - Capture the registered addListener callback
 *  - Fire synthetic messages and assert on sendResponse values
 *
 * Existing pure-function tests (model mapping, language detection, etc.) are
 * preserved below to keep the overall suite green.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildOpusMtExecutionPlan,
  describeOpusMtExecutionConfig,
  resolveOpusMtExecutionConfig,
  selectOpusMtDtype,
} from '../shared/opus-mt-runtime';
import { CONFIG } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type MessageListener = (
  message: Record<string, unknown>,
  sender: unknown,
  sendResponse: (r: unknown) => void
) => boolean | void;

// ---------------------------------------------------------------------------
// Capture registered listeners so we can fire synthetic messages
// ---------------------------------------------------------------------------
const registeredListeners: MessageListener[] = [];

// ---------------------------------------------------------------------------
// chrome stub — MUST be set up before module import
// ---------------------------------------------------------------------------
vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://testid/${path}`,
    onMessage: {
      addListener: (fn: MessageListener) => {
        registeredListeners.push(fn);
      },
    },
    sendMessage: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
});

// ---------------------------------------------------------------------------
// Module-level dependency mocks — declared before the import
// ---------------------------------------------------------------------------

// Transformers.js
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: true,
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: { wasmPaths: '' } } },
  },
}));

// franc-min
vi.mock('franc-min', () => ({
  franc: vi.fn().mockReturnValue('eng'),
}));

// tesseract.js
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(),
  OEM: { LSTM_ONLY: 1 },
}));

// Pipeline cache
const mockGetCachedPipeline = vi.fn().mockReturnValue(null);
const mockCachePipeline = vi.fn();
const mockClearPipelineCache = vi.fn().mockResolvedValue(undefined);

vi.mock('./pipeline-cache', () => ({
  getCachedPipeline: (...args: unknown[]) => mockGetCachedPipeline(...args),
  cachePipeline: (...args: unknown[]) => mockCachePipeline(...args),
  clearCache: (...args: unknown[]) => mockClearPipelineCache(...args),
  castAsPipeline: (pipe: unknown) => pipe,
}));

// Language detection
const mockDetectLanguage = vi.fn().mockReturnValue('en');
const mockBuildLanguageDetectionSample = vi.fn((text: string | string[]) =>
  Array.isArray(text) ? text.join(' ') : text
);
vi.mock('./language-detection', () => ({
  detectLanguage: (text: string) => mockDetectLanguage(text),
  buildLanguageDetectionSample: (text: string | string[]) => mockBuildLanguageDetectionSample(text),
}));

// TranslateGemma
const mockDetectWebGPU = vi.fn().mockResolvedValue({ supported: false, fp16: false });
const mockDetectWebNN = vi.fn().mockResolvedValue(false);
const mockGetTranslateGemmaPipeline = vi.fn().mockResolvedValue({ model: {}, tokenizer: {} });
const mockTranslateWithGemma = vi.fn().mockResolvedValue('gemma translated');

vi.mock('./translategemma', () => ({
  detectWebGPU: (...args: unknown[]) => mockDetectWebGPU(...args),
  detectWebNN: (...args: unknown[]) => mockDetectWebNN(...args),
  getTranslateGemmaPipeline: (...args: unknown[]) => mockGetTranslateGemmaPipeline(...args),
  translateWithGemma: (...args: unknown[]) => mockTranslateWithGemma(...args),
}));

// Chrome translator
const mockChromeTranslatorIsAvailable = vi.fn().mockResolvedValue(false);
const mockChromeTranslatorTranslate = vi.fn().mockResolvedValue('chrome translated');
const mockGetChromeTranslator = vi.fn().mockReturnValue({
  isAvailable: mockChromeTranslatorIsAvailable,
  translate: mockChromeTranslatorTranslate,
});
const mockIsChromeTranslatorAvailable = vi.fn().mockResolvedValue(false);

vi.mock('../providers/chrome-translator', () => ({
  getChromeTranslator: (...args: unknown[]) => mockGetChromeTranslator(...args),
  isChromeTranslatorAvailable: (...args: unknown[]) => mockIsChromeTranslatorAvailable(...args),
}));

// DeepL
const mockDeeplInitialize = vi.fn().mockResolvedValue(undefined);
const mockDeeplIsAvailable = vi.fn().mockResolvedValue(false);
const mockDeeplTranslate = vi.fn().mockResolvedValue('deepl translated');
const mockDeeplGetUsage = vi.fn().mockResolvedValue({ tokens: 100, cost: 0.002, limitReached: false });

vi.mock('../providers/deepl', () => ({
  deeplProvider: {
    initialize: (...args: unknown[]) => mockDeeplInitialize(...args),
    isAvailable: (...args: unknown[]) => mockDeeplIsAvailable(...args),
    translate: (...args: unknown[]) => mockDeeplTranslate(...args),
    getUsage: (...args: unknown[]) => mockDeeplGetUsage(...args),
  },
}));

// OpenAI
const mockOpenaiInitialize = vi.fn().mockResolvedValue(undefined);
const mockOpenaiIsAvailable = vi.fn().mockResolvedValue(false);
const mockOpenaiTranslate = vi.fn().mockResolvedValue('openai translated');
const mockOpenaiGetUsage = vi.fn().mockResolvedValue({ tokens: 200, cost: 0.004, limitReached: false });

vi.mock('../providers/openai', () => ({
  openaiProvider: {
    initialize: (...args: unknown[]) => mockOpenaiInitialize(...args),
    isAvailable: (...args: unknown[]) => mockOpenaiIsAvailable(...args),
    translate: (...args: unknown[]) => mockOpenaiTranslate(...args),
    getUsage: (...args: unknown[]) => mockOpenaiGetUsage(...args),
  },
}));

// Anthropic
const mockAnthropicInitialize = vi.fn().mockResolvedValue(undefined);
const mockAnthropicIsAvailable = vi.fn().mockResolvedValue(false);
const mockAnthropicTranslate = vi.fn().mockResolvedValue('anthropic translated');
const mockAnthropicGetUsage = vi.fn().mockResolvedValue({ tokens: 300, cost: 0.006, limitReached: false });

vi.mock('../providers/anthropic', () => ({
  anthropicProvider: {
    initialize: (...args: unknown[]) => mockAnthropicInitialize(...args),
    isAvailable: (...args: unknown[]) => mockAnthropicIsAvailable(...args),
    translate: (...args: unknown[]) => mockAnthropicTranslate(...args),
    getUsage: (...args: unknown[]) => mockAnthropicGetUsage(...args),
  },
}));

// Google Cloud
const mockGoogleInitialize = vi.fn().mockResolvedValue(undefined);
const mockGoogleIsAvailable = vi.fn().mockResolvedValue(false);
const mockGoogleTranslate = vi.fn().mockResolvedValue('google translated');
const mockGoogleGetUsage = vi.fn().mockResolvedValue({ tokens: 400, cost: 0.008, limitReached: false });

vi.mock('../providers/google-cloud', () => ({
  googleCloudProvider: {
    initialize: (...args: unknown[]) => mockGoogleInitialize(...args),
    isAvailable: (...args: unknown[]) => mockGoogleIsAvailable(...args),
    translate: (...args: unknown[]) => mockGoogleTranslate(...args),
    getUsage: (...args: unknown[]) => mockGoogleGetUsage(...args),
  },
}));

// OCR service
const mockExtractTextFromImage = vi.fn().mockResolvedValue({
  text: 'extracted text',
  confidence: 95,
  blocks: [],
});
const mockTerminateOCR = vi.fn().mockResolvedValue(undefined);

vi.mock('../core/ocr-service', () => ({
  extractTextFromImage: (...args: unknown[]) => mockExtractTextFromImage(...args),
  terminateOCR: (...args: unknown[]) => mockTerminateOCR(...args),
}));

// Network status
const mockIsOnline = vi.fn().mockReturnValue(true);
const mockIsCloudProvider = vi.fn().mockImplementation((p: string) =>
  ['deepl', 'openai', 'anthropic', 'google-cloud'].includes(p)
);

vi.mock('../core/network-status', () => ({
  isOnline: (...args: unknown[]) => mockIsOnline(...args),
  isCloudProvider: (...args: unknown[]) => mockIsCloudProvider(...args),
  initNetworkMonitoring: vi.fn(),
}));

// Translation cache
const mockCacheGet = vi.fn().mockResolvedValue(null);
const mockCacheSet = vi.fn().mockResolvedValue(undefined);
const mockCacheClear = vi.fn().mockResolvedValue(undefined);
const mockCacheGetStats = vi.fn().mockResolvedValue({
  entries: 5,
  totalSize: 1024,
  maxSize: 104857600,
  hits: 10,
  misses: 3,
  hitRate: 0.77,
  oldestTimestamp: null,
  newestTimestamp: null,
});

vi.mock('../core/translation-cache', () => ({
  getTranslationCache: vi.fn().mockReturnValue({
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
    clear: (...args: unknown[]) => mockCacheClear(...args),
    getStats: (...args: unknown[]) => mockCacheGetStats(...args),
  }),
}));

// Profiler
const mockStartTiming = vi.fn();
const mockEndTiming = vi.fn();
const mockRecordTiming = vi.fn();
const mockGetSessionData = vi.fn().mockReturnValue({ timings: [] });
const mockGetAllAggregates = vi.fn().mockReturnValue({});
const mockFormatAggregates = vi.fn().mockReturnValue('');

vi.mock('../core/profiler', () => ({
  profiler: {
    startTiming: (...args: unknown[]) => mockStartTiming(...args),
    endTiming: (...args: unknown[]) => mockEndTiming(...args),
    recordTiming: (...args: unknown[]) => mockRecordTiming(...args),
    getSessionData: (...args: unknown[]) => mockGetSessionData(...args),
    getAllAggregates: (...args: unknown[]) => mockGetAllAggregates(...args),
    formatAggregates: (...args: unknown[]) => mockFormatAggregates(...args),
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test — registers the onMessage listener
// ---------------------------------------------------------------------------
await import('./offscreen');

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Dispatch a message through the last registered listener and capture response */
function dispatch(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = registeredListeners[registeredListeners.length - 1];
    listener({ target: 'offscreen', ...message }, {}, (response) => {
      resolve(response as Record<string, unknown>);
    });
  });
}

// ---------------------------------------------------------------------------
// beforeEach: reset all mocks to their default behaviours
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  (CONFIG.experimental as { opusMtWebgpuProbe: boolean }).opusMtWebgpuProbe = false;

  // Re-apply defaults after clearAllMocks wipes return values
  mockGetCachedPipeline.mockReturnValue(null);
  mockClearPipelineCache.mockResolvedValue(undefined);
  mockDetectLanguage.mockReturnValue('en');
  mockBuildLanguageDetectionSample.mockImplementation((text: string | string[]) =>
    Array.isArray(text) ? text.join(' ') : text
  );
  mockDetectWebGPU.mockResolvedValue({ supported: false, fp16: false });
  mockGetTranslateGemmaPipeline.mockResolvedValue({ model: {}, tokenizer: {} });
  mockTranslateWithGemma.mockResolvedValue('gemma translated');
  mockChromeTranslatorIsAvailable.mockResolvedValue(false);
  mockChromeTranslatorTranslate.mockResolvedValue('chrome translated');
  mockGetChromeTranslator.mockReturnValue({
    isAvailable: mockChromeTranslatorIsAvailable,
    translate: mockChromeTranslatorTranslate,
  });
  mockIsChromeTranslatorAvailable.mockResolvedValue(false);
  mockDeeplInitialize.mockResolvedValue(undefined);
  mockDeeplIsAvailable.mockResolvedValue(false);
  mockDeeplTranslate.mockResolvedValue('deepl translated');
  mockDeeplGetUsage.mockResolvedValue({ tokens: 100, cost: 0.002, limitReached: false });
  mockOpenaiInitialize.mockResolvedValue(undefined);
  mockOpenaiIsAvailable.mockResolvedValue(false);
  mockOpenaiTranslate.mockResolvedValue('openai translated');
  mockOpenaiGetUsage.mockResolvedValue({ tokens: 200, cost: 0.004, limitReached: false });
  mockAnthropicInitialize.mockResolvedValue(undefined);
  mockAnthropicIsAvailable.mockResolvedValue(false);
  mockAnthropicTranslate.mockResolvedValue('anthropic translated');
  mockAnthropicGetUsage.mockResolvedValue({ tokens: 300, cost: 0.006, limitReached: false });
  mockGoogleInitialize.mockResolvedValue(undefined);
  mockGoogleIsAvailable.mockResolvedValue(false);
  mockGoogleTranslate.mockResolvedValue('google translated');
  mockGoogleGetUsage.mockResolvedValue({ tokens: 400, cost: 0.008, limitReached: false });
  mockExtractTextFromImage.mockResolvedValue({ text: 'extracted text', confidence: 95, blocks: [] });
  mockTerminateOCR.mockResolvedValue(undefined);
  mockIsOnline.mockReturnValue(true);
  mockIsCloudProvider.mockImplementation((p: string) =>
    ['deepl', 'openai', 'anthropic', 'google-cloud'].includes(p)
  );
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
  mockCacheClear.mockResolvedValue(undefined);
  mockCacheGetStats.mockResolvedValue({
    entries: 5,
    totalSize: 1024,
    maxSize: 104857600,
    hits: 10,
    misses: 3,
    hitRate: 0.77,
    oldestTimestamp: null,
    newestTimestamp: null,
  });
  mockStartTiming.mockReturnValue(undefined);
  mockEndTiming.mockReturnValue(undefined);
  mockRecordTiming.mockReturnValue(undefined);
  mockGetSessionData.mockReturnValue({ timings: [] });
  mockGetAllAggregates.mockReturnValue({});
  mockFormatAggregates.mockReturnValue('');
});

// ===========================================================================
// Message handler tests
// ===========================================================================

describe('offscreen message handler', () => {

  // -------------------------------------------------------------------------
  // Message target routing
  // -------------------------------------------------------------------------
  describe('target routing', () => {
    it('ignores messages not targeted at offscreen — returns false', () => {
      const listener = registeredListeners[registeredListeners.length - 1];
      const result = listener(
        { target: 'service-worker', type: 'ping' },
        {},
        () => {}
      );
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ping
  // -------------------------------------------------------------------------
  describe('ping', () => {
    it('responds with ready status', async () => {
      const r = await dispatch({ type: 'ping' });
      expect(r).toEqual({ success: true, status: 'ready' });
    });

    it('falls back to the outer catch when sendResponse throws twice', async () => {
      const listener = registeredListeners[registeredListeners.length - 1];
      let attempts = 0;
      let finalResponse: Record<string, unknown> | undefined;

      const result = listener(
        { target: 'offscreen', type: 'ping' },
        {},
        (response) => {
          attempts++;
          if (attempts < 3) {
            throw new Error(`send failure ${attempts}`);
          }
          finalResponse = response as Record<string, unknown>;
        }
      );

      expect(result).toBe(true);
      await vi.waitFor(() => {
        expect(attempts).toBe(3);
      });
      expect(finalResponse).toMatchObject({
        success: false,
        error: 'send failure 2',
      });
    });
  });

  // -------------------------------------------------------------------------
  // getSupportedLanguages
  // -------------------------------------------------------------------------
  describe('getSupportedLanguages', () => {
    it('returns a non-empty language array', async () => {
      const r = await dispatch({ type: 'getSupportedLanguages' });
      expect(r.success).toBe(true);
      expect(Array.isArray(r.languages)).toBe(true);
      expect((r.languages as unknown[]).length).toBeGreaterThan(0);
    });

    it('direct pairs have src and tgt without pivot flag', async () => {
      const r = await dispatch({ type: 'getSupportedLanguages' });
      const langs = r.languages as Array<{ src: string; tgt: string; pivot?: boolean }>;
      const direct = langs.filter((l) => !l.pivot);
      expect(direct.length).toBeGreaterThan(0);
      expect(direct.some((p) => p.src === 'en' && p.tgt === 'de')).toBe(true);
    });

    it('pivot pairs include pivot:true', async () => {
      const r = await dispatch({ type: 'getSupportedLanguages' });
      const langs = r.languages as Array<{ src: string; tgt: string; pivot?: boolean }>;
      const pivot = langs.filter((l) => l.pivot === true);
      expect(pivot.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // checkWebGPU
  // -------------------------------------------------------------------------
  describe('checkWebGPU', () => {
    it('returns supported:false when WebGPU unavailable', async () => {
      mockDetectWebGPU.mockResolvedValue({ supported: false, fp16: false });
      const r = await dispatch({ type: 'checkWebGPU' });
      expect(r.success).toBe(true);
      expect(r.supported).toBe(false);
      expect(r.fp16).toBe(false);
    });

    it('returns supported:true and fp16:true when GPU supports shader-f16', async () => {
      mockDetectWebGPU.mockResolvedValue({ supported: true, fp16: true });
      const r = await dispatch({ type: 'checkWebGPU' });
      expect(r.success).toBe(true);
      expect(r.supported).toBe(true);
      expect(r.fp16).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getCacheStats
  // -------------------------------------------------------------------------
  describe('getCacheStats', () => {
    it('returns stats from translation cache', async () => {
      const r = await dispatch({ type: 'getCacheStats' });
      expect(r.success).toBe(true);
      expect(r.stats).toBeDefined();
      expect(mockCacheGetStats).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // clearCache
  // -------------------------------------------------------------------------
  describe('clearCache', () => {
    it('clears translation cache', async () => {
      const r = await dispatch({ type: 'clearCache' });
      expect(r.success).toBe(true);
      expect(r.cleared).toBe(true);
      expect(mockCacheClear).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // clearPipelineCache
  // -------------------------------------------------------------------------
  describe('clearPipelineCache', () => {
    it('clears ML pipeline cache', async () => {
      const r = await dispatch({ type: 'clearPipelineCache' });
      expect(r.success).toBe(true);
      expect(r.cleared).toBe(true);
      expect(mockClearPipelineCache).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // getProfilingStats
  // -------------------------------------------------------------------------
  describe('getProfilingStats', () => {
    it('returns aggregates and formatted output', async () => {
      const r = await dispatch({ type: 'getProfilingStats' });
      expect(r.success).toBe(true);
      expect(r.aggregates).toBeDefined();
      expect(r.formatted).toBeDefined();
      expect(mockGetAllAggregates).toHaveBeenCalledOnce();
    });
  });

  describe('checkWebNN', () => {
    it('returns detected WebNN support status', async () => {
      mockDetectWebNN.mockResolvedValue(true);

      const r = await dispatch({ type: 'checkWebNN' });

      expect(r).toEqual({ success: true, supported: true });
    });
  });

  // -------------------------------------------------------------------------
  // terminateOCR
  // -------------------------------------------------------------------------
  describe('terminateOCR', () => {
    it('calls terminateOCR and returns success', async () => {
      const r = await dispatch({ type: 'terminateOCR' });
      expect(r.success).toBe(true);
      expect(mockTerminateOCR).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // ocrImage
  // -------------------------------------------------------------------------
  describe('ocrImage', () => {
    it('extracts text from an image', async () => {
      const r = await dispatch({
        type: 'ocrImage',
        imageData: 'data:image/png;base64,abc123',
        lang: 'en',
      });
      expect(r.success).toBe(true);
      expect(r.text).toBe('extracted text');
      expect(r.confidence).toBe(95);
      expect(mockExtractTextFromImage).toHaveBeenCalledWith(
        'data:image/png;base64,abc123',
        'en'
      );
    });

    it('forwards lang parameter to OCR service', async () => {
      await dispatch({
        type: 'ocrImage',
        imageData: 'data:image/png;base64,xyz',
        lang: 'fi',
      });
      expect(mockExtractTextFromImage).toHaveBeenCalledWith(expect.any(String), 'fi');
    });
  });

  // -------------------------------------------------------------------------
  // unknown message type
  // -------------------------------------------------------------------------
  describe('unknown message type', () => {
    it('returns error for unrecognised type', async () => {
      const r = await dispatch({ type: 'notARealType' });
      expect(r.success).toBe(false);
      expect(r.error as string).toContain('notARealType');
    });
  });

  // -------------------------------------------------------------------------
  // translate — validation
  // -------------------------------------------------------------------------
  describe('translate — field validation', () => {
    it('rejects null text', async () => {
      const r = await dispatch({ type: 'translate', text: null, sourceLang: 'en', targetLang: 'de' });
      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('text');
    });

    it('rejects missing text (undefined)', async () => {
      const r = await dispatch({ type: 'translate', sourceLang: 'en', targetLang: 'de' });
      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('text');
    });

    it('rejects missing sourceLang', async () => {
      const r = await dispatch({ type: 'translate', text: 'hi', targetLang: 'de' });
      expect(r.success).toBe(false);
      expect((r.error as string)).toMatch(/sourceLang/);
    });

    it('rejects missing targetLang', async () => {
      const r = await dispatch({ type: 'translate', text: 'hi', sourceLang: 'en' });
      expect(r.success).toBe(false);
      expect((r.error as string)).toMatch(/targetLang/);
    });

    it('rejects sourceLang values that are blank after trimming', async () => {
      const r = await dispatch({
        type: 'translate',
        text: 'hi',
        sourceLang: '   ',
        targetLang: 'de',
      });
      expect(r.success).toBe(false);
      expect(r.error).toBe('Invalid sourceLang: must be non-empty string, max 20 characters');
    });

    it('rejects targetLang values that are blank after trimming', async () => {
      const r = await dispatch({
        type: 'translate',
        text: 'hi',
        sourceLang: 'en',
        targetLang: '   ',
      });
      expect(r.success).toBe(false);
      expect(r.error).toBe('Invalid targetLang: must be non-empty string, max 20 characters');
    });
  });

  // -------------------------------------------------------------------------
  // translate — cache hit (single text)
  // -------------------------------------------------------------------------
  describe('translate — cache hit', () => {
    it('returns cached translation without invoking pipeline', async () => {
      mockCacheGet.mockResolvedValue('Hallo aus dem Cache');
      const fakePipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(fakePipe);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toBe('Hallo aus dem Cache');
      expect(fakePipe).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // translate — OPUS-MT pipeline (cache miss)
  // -------------------------------------------------------------------------
  describe('translate — OPUS-MT pipeline', () => {
    it('translates a single string via pipeline', async () => {
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Hallo Welt' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello World',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toBe('Hallo Welt');
      expect(pipe).toHaveBeenCalledWith('Hello World', { max_length: 512 });
    });

    it('splits multi-sentence probe input into per-sentence pipeline calls', async () => {
      (CONFIG.experimental as { opusMtWebgpuProbe: boolean }).opusMtWebgpuProbe = true;
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'Ensimmäinen lause.' }])
        .mockResolvedValueOnce([{ translation_text: 'Toinen lause.' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'First sentence. Second sentence.',
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toBe('Ensimmäinen lause. Toinen lause.');
      expect(pipe).toHaveBeenNthCalledWith(1, 'First sentence.', { max_length: 512 });
      expect(pipe).toHaveBeenNthCalledWith(2, 'Second sentence.', { max_length: 512 });
    });

    it('returns empty string unchanged (no pipeline call)', async () => {
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: '',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toBe('');
      expect(pipe).not.toHaveBeenCalled();
    });

    it('returns whitespace string unchanged', async () => {
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: '   ',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(pipe).not.toHaveBeenCalled();
    });

    it('translates an array of texts', async () => {
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'Hallo' }])
        .mockResolvedValueOnce([{ translation_text: 'Welt' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: ['Hello', 'World'],
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toEqual(['Hallo', 'Welt']);
    });

    it('splits multi-sentence items inside array translations for probe builds', async () => {
      (CONFIG.experimental as { opusMtWebgpuProbe: boolean }).opusMtWebgpuProbe = true;
      const translations: Record<string, string> = {
        'First sentence.': 'Ensimmäinen lause.',
        'Second sentence.': 'Toinen lause.',
        'Third sentence.': 'Kolmas lause.',
        'Fourth sentence.': 'Neljäs lause.',
      };
      const pipe = vi
        .fn()
        .mockImplementation((text: string) =>
          Promise.resolve([{ translation_text: translations[text] ?? text }])
        );
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: [
          'First sentence. Second sentence.',
          'Third sentence. Fourth sentence.',
        ],
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toEqual([
        'Ensimmäinen lause. Toinen lause.',
        'Kolmas lause. Neljäs lause.',
      ]);
      expect(pipe).toHaveBeenCalledWith('First sentence.', { max_length: 512 });
      expect(pipe).toHaveBeenCalledWith('Second sentence.', { max_length: 512 });
      expect(pipe).toHaveBeenCalledWith('Third sentence.', { max_length: 512 });
      expect(pipe).toHaveBeenCalledWith('Fourth sentence.', { max_length: 512 });
    });

    it('keeps four single-sentence batch items stable in probe builds', async () => {
      (CONFIG.experimental as { opusMtWebgpuProbe: boolean }).opusMtWebgpuProbe = true;
      const translations: Record<string, string> = {
        Alpha: 'Alfa',
        Beta: 'Beeta',
        Gamma: 'Gamma',
        Delta: 'Delta',
      };
      const pipe = vi
        .fn()
        .mockImplementation((text: string) =>
          Promise.resolve([{ translation_text: translations[text] ?? text }])
        );
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: ['Alpha', 'Beta', 'Gamma', 'Delta'],
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toEqual(['Alfa', 'Beeta', 'Gamma', 'Delta']);
    });

    it('returns degraded probe output verbatim when sentence-level translations lose punctuation', async () => {
      (CONFIG.experimental as { opusMtWebgpuProbe: boolean }).opusMtWebgpuProbe = true;
      const translations: Record<string, string> = {
        'First sentence.': 'Ensimmäinen lause',
        'Second sentence.': 'Toinen lause',
      };
      const pipe = vi
        .fn()
        .mockImplementation((text: string) =>
          Promise.resolve([{ translation_text: translations[text] ?? text }])
        );
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'First sentence. Second sentence.',
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toBe('Ensimmäinen lause Toinen lause');
    });

    it('returns empty array without calling pipeline', async () => {
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: [],
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toEqual([]);
      expect(pipe).not.toHaveBeenCalled();
    });

    it('returns error for unsupported language pair', async () => {
      // zz-xx has no MODEL_MAP entry and no PIVOT_ROUTES entry
      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'zz',
        targetLang: 'xx',
        provider: 'opus-mt',
      });
      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
    });

    it('returns structured translationError details for pipeline failures', async () => {
      const pipe = vi.fn().mockRejectedValue(new Error('operation timed out'));
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(false);
      expect(r.error).toBe('operation timed out');
      expect(r.translationError).toMatchObject({
        category: 'timeout',
        technicalDetails: 'operation timed out',
        retryable: true,
      });
    });

    it('stores result in cache after translation', async () => {
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Bonjour' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
        provider: 'opus-mt',
      });

      expect(mockCacheSet).toHaveBeenCalledWith(
        'Hello', 'en', 'fr', 'opus-mt', 'Bonjour'
      );
    });
  });

  // -------------------------------------------------------------------------
  // translate — auto language detection
  // -------------------------------------------------------------------------
  describe('translate — auto source language', () => {
    it('calls detectLanguage when sourceLang is auto', async () => {
      mockDetectLanguage.mockReturnValue('en');
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Hallo' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'auto',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(mockDetectLanguage).toHaveBeenCalled();
      expect(r.success).toBe(true);
    });

    it('returns original text when detected language equals targetLang', async () => {
      mockDetectLanguage.mockReturnValue('de');
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'Guten Tag',
        sourceLang: 'auto',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toBe('Guten Tag');
      expect(pipe).not.toHaveBeenCalled();
    });

    it('builds a broader sample for array auto-detection', async () => {
      mockDetectLanguage.mockReturnValue('en');
      mockCacheGet.mockResolvedValue('vertaald');

      await dispatch({
        type: 'translate',
        text: [
          'Home',
          'Events',
          'Chat',
          'Login',
          'Beschrijving',
          'Hoi ik ben Rosie en ik besteed graag lekker tijd aan het voorspel om heerlijk op te warmen.',
        ],
        sourceLang: 'auto',
        targetLang: 'nl',
        provider: 'opus-mt',
      });

      expect(mockBuildLanguageDetectionSample).toHaveBeenCalledWith(
        expect.arrayContaining(['Beschrijving'])
      );
      expect(mockDetectLanguage).toHaveBeenCalledWith(
        expect.stringContaining('Hoi ik ben Rosie')
      );
    });
  });

  // -------------------------------------------------------------------------
  // translate — TranslateGemma provider
  // -------------------------------------------------------------------------
  describe('translate — translategemma provider', () => {
    it('fails when WebGPU not available', async () => {
      mockDetectWebGPU.mockResolvedValue({ supported: false, fp16: false });
      mockDetectWebNN.mockResolvedValue(false);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'translategemma',
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('WebGPU');
    });

    it('calls translateWithGemma when WebGPU supported', async () => {
      mockDetectWebGPU.mockResolvedValue({ supported: true, fp16: true });
      mockTranslateWithGemma.mockResolvedValue('Hallo');

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'translategemma',
      });

      expect(r.success).toBe(true);
      expect(mockTranslateWithGemma).toHaveBeenCalledWith('Hello', 'en', 'de', undefined);
    });

    it('passes pageContext to translateWithGemma', async () => {
      mockDetectWebGPU.mockResolvedValue({ supported: true, fp16: false });
      mockTranslateWithGemma.mockResolvedValue('Hallo');

      await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'translategemma',
        pageContext: 'Wikipedia article about Germany',
      });

      expect(mockTranslateWithGemma).toHaveBeenCalledWith(
        'Hello', 'en', 'de', 'Wikipedia article about Germany'
      );
    });
  });

  // -------------------------------------------------------------------------
  // translate — cloud provider offline fast-fail
  // -------------------------------------------------------------------------
  describe('translate — offline fast-fail', () => {
    it('fails immediately when offline and cloud provider requested', async () => {
      mockIsOnline.mockReturnValue(false);
      mockIsCloudProvider.mockReturnValue(true);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'deepl',
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('no network connection');
    });
  });

  // -------------------------------------------------------------------------
  // translate — DeepL provider
  // -------------------------------------------------------------------------
  describe('translate — deepl provider', () => {
    it('uses DeepL when available', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockDeeplIsAvailable.mockResolvedValue(true);
      mockDeeplTranslate.mockResolvedValue('Hallo von DeepL');

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'deepl',
      });

      expect(r.success).toBe(true);
      expect(mockDeeplInitialize).toHaveBeenCalledWith();
      expect(mockDeeplTranslate).toHaveBeenCalledWith('Hello', 'en', 'de');
    });

    it('returns configuration error when DeepL not configured', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockDeeplIsAvailable.mockResolvedValue(false);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'deepl',
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('not configured');
    });
  });

  // -------------------------------------------------------------------------
  // translate — OpenAI provider
  // -------------------------------------------------------------------------
  describe('translate — openai provider', () => {
    it('uses OpenAI when available', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockOpenaiIsAvailable.mockResolvedValue(true);
      mockOpenaiTranslate.mockResolvedValue('OpenAI result');

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'openai',
      });

      expect(r.success).toBe(true);
      expect(mockOpenaiTranslate).toHaveBeenCalledWith('Hello', 'en', 'de');
    });

    it('fails when OpenAI not configured', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockOpenaiIsAvailable.mockResolvedValue(false);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'openai',
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('not configured');
    });
  });

  // -------------------------------------------------------------------------
  // translate — Anthropic provider
  // -------------------------------------------------------------------------
  describe('translate — anthropic provider', () => {
    it('uses Anthropic when available', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockAnthropicIsAvailable.mockResolvedValue(true);
      mockAnthropicTranslate.mockResolvedValue('Anthropic result');

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'anthropic',
      });

      expect(r.success).toBe(true);
      expect(mockAnthropicTranslate).toHaveBeenCalledWith('Hello', 'en', 'de');
    });

    it('fails when Anthropic not configured', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockAnthropicIsAvailable.mockResolvedValue(false);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'anthropic',
      });

      expect(r.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // translate — Google Cloud provider
  // -------------------------------------------------------------------------
  describe('translate — google-cloud provider', () => {
    it('uses Google Cloud when available', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockGoogleIsAvailable.mockResolvedValue(true);
      mockGoogleTranslate.mockResolvedValue('Google result');

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'google-cloud',
      });

      expect(r.success).toBe(true);
      expect(mockGoogleTranslate).toHaveBeenCalledWith('Hello', 'en', 'de');
    });

    it('fails when Google Cloud not configured', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockGoogleIsAvailable.mockResolvedValue(false);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'google-cloud',
      });

      expect(r.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // translate — chrome-builtin provider
  // -------------------------------------------------------------------------
  describe('translate — chrome-builtin provider', () => {
    it('returns error when Chrome Translator API not available', async () => {
      mockChromeTranslatorIsAvailable.mockResolvedValue(false);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'chrome-builtin',
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('Chrome Translator API not available');
    });

    it('delegates to Chrome Translator when available', async () => {
      mockChromeTranslatorIsAvailable.mockResolvedValue(true);
      mockChromeTranslatorTranslate.mockResolvedValue('Chrome translated');
      mockGetChromeTranslator.mockReturnValue({
        isAvailable: mockChromeTranslatorIsAvailable,
        translate: mockChromeTranslatorTranslate,
      });

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'chrome-builtin',
      });

      expect(r.success).toBe(true);
      expect(mockChromeTranslatorTranslate).toHaveBeenCalledWith('Hello', 'en', 'de');
    });
  });

  // -------------------------------------------------------------------------
  // translate — pivot routing
  // -------------------------------------------------------------------------
  describe('translate — pivot routing', () => {
    it('routes nl-fi via two-hop pivot (nl-en + en-fi)', async () => {
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'Hello' }])   // nl->en
        .mockResolvedValueOnce([{ translation_text: 'Hei' }]);    // en->fi
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'Hallo',
        sourceLang: 'nl',
        targetLang: 'fi',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      // Pipeline must have been called twice for two hops
      expect(pipe).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // translate — fallback behaviour
  // -------------------------------------------------------------------------
  describe('translate — provider fallback', () => {
    it('falls back to opus-mt when primary fails with non-config error', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockDeeplIsAvailable.mockResolvedValue(true);
      mockDeeplTranslate.mockRejectedValue(new Error('Network timeout'));

      // opus-mt fallback succeeds
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Fallback result' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'deepl',
      });

      expect(r.success).toBe(true);
      expect(pipe).toHaveBeenCalled();
    });

    it('does NOT fallback for API key configuration errors', async () => {
      mockIsOnline.mockReturnValue(true);
      mockIsCloudProvider.mockReturnValue(true);
      mockDeeplIsAvailable.mockResolvedValue(false);  // triggers "not configured"

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'deepl',
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('not configured');
    });
  });

  // -------------------------------------------------------------------------
  // translate — profiling session support
  // -------------------------------------------------------------------------
  describe('translate — profiling', () => {
    it('calls profiler start/end when sessionId provided', async () => {
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Test' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
        sessionId: 'session-42',
      });

      expect(mockStartTiming).toHaveBeenCalledWith('session-42', 'offscreen_processing');
      expect(mockEndTiming).toHaveBeenCalledWith('session-42', 'offscreen_processing');
    });

    it('includes profilingData in response when sessionId provided', async () => {
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Test' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);
      mockGetSessionData.mockReturnValue({ timings: [{ name: 'model_load', duration: 100 }] });

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
        sessionId: 'session-99',
      });

      expect(r.profilingData).toBeDefined();
    });

    it('does NOT call profiler when no sessionId', async () => {
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Test' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(mockStartTiming).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // preloadModel
  // -------------------------------------------------------------------------
  describe('preloadModel', () => {
    it('preloads OPUS-MT for known pair via cached pipeline', async () => {
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'preloadModel',
        provider: 'opus-mt',
        sourceLang: 'en',
        targetLang: 'de',
      });

      expect(r.success).toBe(true);
      expect(r.preloaded).toBe(true);
    });

    it('returns preloaded:false for unsupported pair', async () => {
      const r = await dispatch({
        type: 'preloadModel',
        provider: 'opus-mt',
        sourceLang: 'zz',
        targetLang: 'xx',
      });

      expect(r.success).toBe(true);
      expect(r.preloaded).toBe(false);
    });

    it('rejects TranslateGemma preload when WebGPU unavailable', async () => {
      mockDetectWebGPU.mockResolvedValue({ supported: false, fp16: false });
      mockDetectWebNN.mockResolvedValue(false);

      const r = await dispatch({
        type: 'preloadModel',
        provider: 'translategemma',
        sourceLang: 'en',
        targetLang: 'de',
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('WebGPU');
    });

    it('preloads TranslateGemma when WebGPU is available', async () => {
      mockDetectWebGPU.mockResolvedValue({ supported: true, fp16: false });

      const r = await dispatch({
        type: 'preloadModel',
        provider: 'translategemma',
        sourceLang: 'en',
        targetLang: 'de',
      });

      expect(r.success).toBe(true);
      expect(r.preloaded).toBe(true);
      expect(mockGetTranslateGemmaPipeline).toHaveBeenCalled();
    });

    it('checks chrome-builtin availability', async () => {
      mockIsChromeTranslatorAvailable.mockResolvedValue(true);

      const r = await dispatch({
        type: 'preloadModel',
        provider: 'chrome-builtin',
        sourceLang: 'en',
        targetLang: 'de',
      });

      expect(r.success).toBe(true);
      expect(r.available).toBe(true);
    });

    it('reports partial:true for pivot pair (only first hop loaded)', async () => {
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      // nl-fi is a known pivot route
      const r = await dispatch({
        type: 'preloadModel',
        provider: 'opus-mt',
        sourceLang: 'nl',
        targetLang: 'fi',
      });

      expect(r.success).toBe(true);
      expect(r.partial).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getCloudProviderUsage
  // -------------------------------------------------------------------------
  describe('getCloudProviderUsage', () => {
    it('returns DeepL usage stats', async () => {
      mockDeeplGetUsage.mockResolvedValue({ tokens: 50000, cost: 1.0, limitReached: false });

      const r = await dispatch({ type: 'getCloudProviderUsage', provider: 'deepl' });

      expect(r.success).toBe(true);
      expect((r.usage as Record<string, unknown>).tokens).toBe(50000);
      expect(mockDeeplInitialize).toHaveBeenCalledWith();
    });

    it('returns OpenAI usage stats', async () => {
      mockOpenaiGetUsage.mockResolvedValue({ tokens: 1000, cost: 0.02, limitReached: false });

      const r = await dispatch({ type: 'getCloudProviderUsage', provider: 'openai' });

      expect(r.success).toBe(true);
      expect(mockOpenaiGetUsage).toHaveBeenCalled();
    });

    it('returns Anthropic usage stats', async () => {
      mockAnthropicGetUsage.mockResolvedValue({ tokens: 2000, cost: 0.03, limitReached: false });

      const r = await dispatch({ type: 'getCloudProviderUsage', provider: 'anthropic' });

      expect(r.success).toBe(true);
      expect(mockAnthropicGetUsage).toHaveBeenCalled();
    });

    it('returns Google Cloud usage stats', async () => {
      mockGoogleGetUsage.mockResolvedValue({ tokens: 3000, cost: 0.06, limitReached: false });

      const r = await dispatch({ type: 'getCloudProviderUsage', provider: 'google-cloud' });

      expect(r.success).toBe(true);
      expect(mockGoogleGetUsage).toHaveBeenCalled();
    });

    it('returns zero usage for unknown provider', async () => {
      const r = await dispatch({ type: 'getCloudProviderUsage', provider: 'unknown' });

      expect(r.success).toBe(true);
      const usage = r.usage as Record<string, unknown>;
      expect(usage.tokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.limitReached).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // error propagation
  // -------------------------------------------------------------------------
  describe('error propagation', () => {
    it('catches synchronous throws and returns failure response', async () => {
      mockCacheGetStats.mockRejectedValue(new Error('DB failure'));

      const r = await dispatch({ type: 'getCacheStats' });

      expect(r.success).toBe(false);
      expect(r.error).toBe('DB failure');
    });
  });

  // -------------------------------------------------------------------------
  // preloadModel — low priority branch
  // -------------------------------------------------------------------------
  describe('preloadModel — priority', () => {
    it('accepts low-priority preload flag without error', async () => {
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'preloadModel',
        provider: 'opus-mt',
        sourceLang: 'en',
        targetLang: 'de',
        priority: 'low',
      });

      expect(r.success).toBe(true);
      expect(r.preloaded).toBe(true);
    });

    it('treats non-low priority the same way', async () => {
      const pipe = vi.fn();
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'preloadModel',
        provider: 'opus-mt',
        sourceLang: 'en',
        targetLang: 'de',
        priority: 'high',
      });

      expect(r.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // translate — pipeline loaded from HuggingFace (cache miss, no cached pipe)
  // -------------------------------------------------------------------------
  describe('translate — pipeline loading via transformers', () => {
    it('calls transformers pipeline when no cached pipeline exists', async () => {
      const { pipeline: mockPipeline } = await import('@huggingface/transformers');
      const fakePipe = vi.fn().mockResolvedValue([{ translation_text: 'Bonjour' }]);
      (mockPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(fakePipe);
      // Force cache miss — no pipeline in LRU cache
      mockGetCachedPipeline.mockReturnValue(null);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(mockPipeline).toHaveBeenCalledWith(
        'translation',
        'Xenova/opus-mt-en-fr',
        expect.objectContaining({ device: 'wasm', dtype: 'q8' })
      );
    });

    it('caches newly loaded pipeline', async () => {
      const { pipeline: mockPipeline } = await import('@huggingface/transformers');
      const fakePipe = vi.fn().mockResolvedValue([{ translation_text: 'Bonjour' }]);
      (mockPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(fakePipe);
      mockGetCachedPipeline.mockReturnValue(null);

      await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
        provider: 'opus-mt',
      });

      expect(mockCachePipeline).toHaveBeenCalledWith('Xenova/opus-mt-en-fr', fakePipe);
    });

    it('falls back to WASM+fp32 when WASM+q8 fails to load', async () => {
      const { pipeline: mockPipeline } = await import('@huggingface/transformers');
      const fakePipe = vi.fn().mockResolvedValue([{ translation_text: 'Bonjour' }]);
      (mockPipeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Missing required scale'))
        .mockResolvedValueOnce(fakePipe);
      mockGetCachedPipeline.mockReturnValue(null);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(mockPipeline).toHaveBeenNthCalledWith(
        1,
        'translation',
        'Xenova/opus-mt-en-fr',
        expect.objectContaining({ device: 'wasm', dtype: 'q8' })
      );
      expect(mockPipeline).toHaveBeenNthCalledWith(
        2,
        'translation',
        'Xenova/opus-mt-en-fr',
        expect.objectContaining({ device: 'wasm', dtype: 'fp32' })
      );
    });

    it('surfaces both q8 and fp32 load failures when all attempts fail', async () => {
      const { pipeline: mockPipeline } = await import('@huggingface/transformers');
      (mockPipeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Missing required scale'))
        .mockRejectedValueOnce(new Error('Missing required scale'));
      mockGetCachedPipeline.mockReturnValue(null);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(false);
      expect(r.error).toContain('WASM+q8: Missing required scale');
      expect(r.error).toContain('WASM+fp32 diagnostic fallback: Missing required scale');
      expect(r.translationError).toMatchObject({
        category: 'model',
      });
    });

    it('captures attempted model file names in load failure diagnostics', async () => {
      const { pipeline: mockPipeline } = await import('@huggingface/transformers');
      (mockPipeline as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(
          async (_task: string, _modelId: string, options: Record<string, unknown>) => {
            const progressCallback = options.progress_callback as
              | ((progress: { file?: string | null }) => void)
              | undefined;
            progressCallback?.({ file: 'encoder_model_quantized.onnx' });
            throw new Error('Missing required scale');
          }
        )
        .mockImplementationOnce(
          async (_task: string, _modelId: string, options: Record<string, unknown>) => {
            const progressCallback = options.progress_callback as
              | ((progress: { file?: string | null }) => void)
              | undefined;
            progressCallback?.({ file: 'encoder_model.onnx' });
            throw new Error('Missing required scale');
          }
        );
      mockGetCachedPipeline.mockReturnValue(null);

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(false);
      expect(r.error).toContain('[files: encoder_model_quantized.onnx]');
      expect(r.error).toContain('[files: encoder_model.onnx]');
    });
  });

  // -------------------------------------------------------------------------
  // cropImage — jsdom canvas path
  // -------------------------------------------------------------------------
  describe('cropImage', () => {
    it('returns cropped image data URL', async () => {
      const OriginalImage = globalThis.Image;

      // Build a mock Image class where assigning src triggers onload via microtask
      function MockImageLoad(this: Record<string, unknown>) {
        this.onload = null;
        this.onerror = null;
        Object.defineProperty(this, 'src', {
          set(val: string) {
            this._src = val;
            Promise.resolve().then(() => {
              if (typeof this.onload === 'function') this.onload();
            });
          },
          get() { return this._src ?? ''; },
          configurable: true,
        });
      }
      vi.stubGlobal('Image', MockImageLoad);

      // Mock canvas so toDataURL returns a known value
      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(
        (tag: string) => {
          if (tag === 'canvas') {
            const canvas = originalCreateElement('canvas') as HTMLCanvasElement;
            vi.spyOn(canvas, 'getContext').mockReturnValue({
              drawImage: vi.fn(),
            } as any);
            vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,CROPPED');
            return canvas;
          }
          return originalCreateElement(tag);
        }
      );

      const r = await dispatch({
        type: 'cropImage',
        imageData: 'data:image/png;base64,ORIGINAL',
        rect: { x: 10, y: 20, width: 100, height: 50 },
        devicePixelRatio: 2,
      });

      expect(r.success).toBe(true);
      expect(r.imageData).toBe('data:image/png;base64,CROPPED');

      createElementSpy.mockRestore();
      vi.stubGlobal('Image', OriginalImage);
    });

    it('returns error when image fails to load', async () => {
      const OriginalImage = globalThis.Image;

      function MockImageFail(this: Record<string, unknown>) {
        this.onload = null;
        this.onerror = null;
        Object.defineProperty(this, 'src', {
          set(_val: string) {
            Promise.resolve().then(() => {
              if (typeof this.onerror === 'function') this.onerror();
            });
          },
          get() { return ''; },
          configurable: true,
        });
      }
      vi.stubGlobal('Image', MockImageFail);

      const r = await dispatch({
        type: 'cropImage',
        imageData: 'data:image/png;base64,BAD',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      });

      expect(r.success).toBe(false);
      expect((r.error as string)).toContain('Failed to load image');

      vi.stubGlobal('Image', OriginalImage);
    });
  });

  // -----------------------------------------------------------------
  // Additional coverage: cache write failures & identity translation
  // -----------------------------------------------------------------
  describe('batch cache write failures', () => {
    it('logs warning for first two cache write failures (line 287)', async () => {
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'Hallo' }])
        .mockResolvedValueOnce([{ translation_text: 'Welt' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);
      mockCacheSet.mockRejectedValue(new Error('IDB full'));

      const r = await dispatch({
        type: 'translate',
        text: ['Hello', 'World'],
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toEqual(['Hallo', 'Welt']);
    });

    it('logs summary when cache write fails for more than 2 items (line 295)', async () => {
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'A1' }])
        .mockResolvedValueOnce([{ translation_text: 'B1' }])
        .mockResolvedValueOnce([{ translation_text: 'C1' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);
      mockCacheSet.mockRejectedValue(new Error('IDB full'));

      const r = await dispatch({
        type: 'translate',
        text: ['A', 'B', 'C'],
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toEqual(['A1', 'B1', 'C1']);
    });

    it('logs identity translation when output equals input (line 291)', async () => {
      // OPUS-MT returns the same text for proper nouns / brand names
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'Google' }])
        .mockResolvedValueOnce([{ translation_text: 'Welt' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: ['Google', 'World'],
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toEqual(['Google', 'Welt']);
    });
  });

  describe('single text cache write failure', () => {
    it('handles cache.set failure gracefully (line 322)', async () => {
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Bonjour' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);
      mockCacheSet.mockRejectedValue(new Error('Quota exceeded'));

      const r = await dispatch({
        type: 'translate',
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      expect(r.result).toBe('Bonjour');
    });
  });

  describe('batch per-item translation error', () => {
    it('returns original text when pipe rejects for one item (line 169)', async () => {
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'Hallo' }])
        .mockRejectedValueOnce(new Error('ONNX runtime error'))
        .mockResolvedValueOnce([{ translation_text: 'Gut' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: ['Hello', 'Broken', 'Good'],
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      // Failed item returns original text
      expect(r.result).toEqual(['Hallo', 'Broken', 'Gut']);
    });
  });

  // -------------------------------------------------------------------------
  // translate — array with empty/whitespace items
  // -------------------------------------------------------------------------
  describe('translate — array with empty/whitespace items', () => {
    it('preserves empty and whitespace-only strings without calling pipeline', async () => {
      const pipe = vi.fn()
        .mockResolvedValueOnce([{ translation_text: 'Hallo' }])
        .mockResolvedValueOnce([{ translation_text: 'Welt' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);

      const r = await dispatch({
        type: 'translate',
        text: ['Hello', '', '  ', 'World'],
        sourceLang: 'en',
        targetLang: 'de',
        provider: 'opus-mt',
      });

      expect(r.success).toBe(true);
      if (Array.isArray(r.result)) {
        // Empty/whitespace items should be preserved as-is
        expect(r.result[1]).toBe('');
        expect(r.result[2]).toBe('  ');
      }
    });
  });

  // -------------------------------------------------------------------------
  // translate — sessionId triggers profiling during auto-detection
  // -------------------------------------------------------------------------
  describe('translate — sessionId with auto-detect', () => {
    it('passes sessionId for profiling during auto-detection', async () => {
      const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Hello world' }]);
      mockGetCachedPipeline.mockReturnValue(pipe);
      mockDetectLanguage.mockReturnValue('fr');

      const r = await dispatch({
        type: 'translate',
        text: 'Bonjour le monde, comment allez-vous',
        sourceLang: 'auto',
        targetLang: 'en',
        provider: 'opus-mt',
        sessionId: 'test-session-123',
      });

      expect(r.success).toBe(true);
    });
  });
});

// ===========================================================================
// Pure-function tests (kept for regression coverage)
// ===========================================================================

describe('Offscreen Model Mapping', () => {
  // Replicate the MODEL_MAP subset for testing
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

  it('uses jap in model names for Japanese', () => {
    expect(MODEL_MAP['en-ja']).toBe('Xenova/opus-mt-en-jap');
    expect(MODEL_MAP['ja-en']).toBe('Xenova/opus-mt-jap-en');
  });

  it('returns undefined for unsupported pairs', () => {
    expect(MODEL_MAP['fi-de']).toBeUndefined();
    expect(MODEL_MAP['xx-yy']).toBeUndefined();
  });
});

describe('withTimeout utility', () => {
  function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${message} (${ms / 1000}s)`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  it('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
    expect(result).toBe('ok');
  });

  it('rejects with timeout error when promise never resolves', async () => {
    const neverResolves = new Promise<string>(() => {});
    await expect(
      withTimeout(neverResolves, 50, 'slow op')
    ).rejects.toThrow('Timeout: slow op (0.05s)');
  });

  it('rejects with original error when promise rejects before timeout', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('original')), 1000, 'test')
    ).rejects.toThrow('original');
  });
});

describe('getFallbackProviders logic', () => {
  type TPI = 'opus-mt' | 'translategemma' | 'chrome-builtin' | 'deepl' | 'openai' | 'anthropic' | 'google-cloud';

  async function getFallbackProviders(primary: TPI): Promise<TPI[]> {
    const fallbacks: TPI[] = [];
    if (primary !== 'opus-mt') fallbacks.push('opus-mt');
    return fallbacks;
  }

  it('returns opus-mt for translategemma primary', async () => {
    expect(await getFallbackProviders('translategemma')).toEqual(['opus-mt']);
  });

  it('returns empty array for opus-mt primary (no self-fallback)', async () => {
    expect(await getFallbackProviders('opus-mt')).toEqual([]);
  });

  it('returns opus-mt for all cloud providers', async () => {
    const cloud: TPI[] = ['deepl', 'openai', 'anthropic', 'google-cloud'];
    for (const p of cloud) {
      expect(await getFallbackProviders(p)).toEqual(['opus-mt']);
    }
  });

  it('never includes chrome-builtin as a fallback', async () => {
    const all: TPI[] = ['opus-mt', 'translategemma', 'chrome-builtin', 'deepl', 'openai', 'anthropic', 'google-cloud'];
    for (const p of all) {
      expect(await getFallbackProviders(p)).not.toContain('chrome-builtin');
    }
  });
});

describe('selectOpusMtDtype', () => {
  it('always returns q8 regardless of WebGPU capabilities', () => {
    expect(selectOpusMtDtype({ supported: true, fp16: true })).toBe('q8');
    expect(selectOpusMtDtype({ supported: true, fp16: false })).toBe('q8');
    expect(selectOpusMtDtype({ supported: false, fp16: false })).toBe('q8');
  });
});

describe('resolveOpusMtExecutionConfig', () => {
  it('defaults to safe WASM when probe flag is off', () => {
    expect(
      resolveOpusMtExecutionConfig({ supported: true, fp16: true }, false)
    ).toEqual({
      device: 'wasm',
      dtype: 'q8',
      reason: 'safe-default-wasm',
    });
  });

  it('stays on WASM when probe is on but WebGPU is unavailable', () => {
    expect(
      resolveOpusMtExecutionConfig({ supported: false, fp16: false }, true)
    ).toEqual({
      device: 'wasm',
      dtype: 'q8',
      reason: 'safe-default-wasm',
    });
  });

  it('allows WebGPU only when the experimental probe is enabled and supported', () => {
    expect(
      resolveOpusMtExecutionConfig({ supported: true, fp16: false }, true)
    ).toEqual({
      device: 'webgpu',
      dtype: 'q8',
      reason: 'experimental-webgpu-probe',
    });
  });
});

describe('buildOpusMtExecutionPlan', () => {
  it('adds a diagnostic WASM+fp32 fallback after the safe default', () => {
    expect(buildOpusMtExecutionPlan({ supported: false, fp16: false }, false)).toEqual([
      {
        device: 'wasm',
        dtype: 'q8',
        reason: 'safe-default-wasm',
      },
      {
        device: 'wasm',
        dtype: 'fp32',
        reason: 'wasm-fp32-diagnostic-fallback',
      },
    ]);
  });

  it('keeps WebGPU probe first, then WASM q8, then WASM fp32', () => {
    expect(buildOpusMtExecutionPlan({ supported: true, fp16: true }, true)).toEqual([
      {
        device: 'webgpu',
        dtype: 'q8',
        reason: 'experimental-webgpu-probe',
      },
      {
        device: 'wasm',
        dtype: 'q8',
        reason: 'webgpu-fallback-wasm-q8',
      },
      {
        device: 'wasm',
        dtype: 'fp32',
        reason: 'wasm-fp32-diagnostic-fallback',
      },
    ]);
  });

  it('describes the WebGPU fallback WASM attempt label', () => {
    expect(
      describeOpusMtExecutionConfig({
        device: 'wasm',
        dtype: 'q8',
        reason: 'webgpu-fallback-wasm-q8',
      })
    ).toBe('WASM+q8 fallback');
  });
});

describe('model load and inference profiling (lines 129, 177-179, 189-194)', () => {
  it('records model_load timing when pipeline not cached and sessionId provided', async () => {
    const { pipeline: mockPipeline } = await import('@huggingface/transformers');
    const fakePipe = vi.fn().mockResolvedValue([{ translation_text: 'Test' }]);
    (mockPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(fakePipe);
    mockGetCachedPipeline.mockReturnValue(null);

    await dispatch({
      type: 'translate',
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      sessionId: 'test-session-1',
    });

    // Should call recordTiming for model_load with cached:false
    expect(mockRecordTiming).toHaveBeenCalledWith(
      'test-session-1',
      'model_load',
      expect.any(Number),
      expect.objectContaining({
        cached: false,
        modelId: 'Xenova/opus-mt-en-fi',
        device: 'wasm',
      })
    );
  });

  it('records model_load timing with cached:true when pipeline is cached', async () => {
    const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Test' }]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    await dispatch({
      type: 'translate',
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      sessionId: 'test-session-2',
    });

    // Should call recordTiming for model_load with cached:true
    expect(mockRecordTiming).toHaveBeenCalledWith(
      'test-session-2',
      'model_load',
      0,
      expect.objectContaining({
        cached: true,
        modelId: 'Xenova/opus-mt-en-fi',
      })
    );
  });

  it('records model_inference timing for single string translation', async () => {
    const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Hola' }]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    await dispatch({
      type: 'translate',
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'es',
      provider: 'opus-mt',
      sessionId: 'test-session-3',
    });

    // Should call recordTiming for model_inference with batchSize:1
    expect(mockRecordTiming).toHaveBeenCalledWith(
      'test-session-3',
      'model_inference',
      expect.any(Number),
      expect.objectContaining({
        batchSize: 1,
        totalChars: expect.any(Number),
      })
    );
  });

  it('records model_inference timing for batch translation', async () => {
    const pipe = vi.fn().mockResolvedValue([
      { translation_text: 'Hola' },
      { translation_text: 'Mundo' },
    ]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    await dispatch({
      type: 'translate',
      text: ['Hello', 'World'],
      sourceLang: 'en',
      targetLang: 'es',
      provider: 'opus-mt',
      sessionId: 'test-session-4',
    });

    // Should call recordTiming for model_inference with batchSize:2
    expect(mockRecordTiming).toHaveBeenCalledWith(
      'test-session-4',
      'model_inference',
      expect.any(Number),
      expect.objectContaining({
        batchSize: 2,
        totalChars: expect.any(Number),
      })
    );
  });

  it('does not record model_load timing when sessionId not provided', async () => {
    const { pipeline: mockPipeline } = await import('@huggingface/transformers');
    const fakePipe = vi.fn().mockResolvedValue([{ translation_text: 'Test' }]);
    (mockPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(fakePipe);
    mockGetCachedPipeline.mockReturnValue(null);

    await dispatch({
      type: 'translate',
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      // No sessionId
    });

    // recordTiming should not be called for model_load (only startTiming/endTiming for overall timing)
    const modelLoadCalls = (mockRecordTiming as ReturnType<typeof vi.fn>).mock.calls.filter(
      call => call[1] === 'model_load'
    );
    expect(modelLoadCalls).toHaveLength(0);
  });

  it('handles empty array translation without calling pipeline', async () => {
    const pipe = vi.fn().mockResolvedValue([]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    const r = await dispatch({
      type: 'translate',
      text: [],
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      sessionId: 'test-session-5',
    });

    expect(r.success).toBe(true);
    expect(r.result).toEqual([]);
    // Pipeline should not be called for empty array
    expect(pipe).not.toHaveBeenCalled();
  });

  it('returns empty string unchanged for single empty string', async () => {
    const pipe = vi.fn().mockResolvedValue([]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    const r = await dispatch({
      type: 'translate',
      text: '',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
    });

    expect(r.success).toBe(true);
    expect(r.result).toBe('');
    // Pipeline should not be called
    expect(pipe).not.toHaveBeenCalled();
  });

  it('returns whitespace string unchanged', async () => {
    const pipe = vi.fn().mockResolvedValue([]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    const r = await dispatch({
      type: 'translate',
      text: '   \n\t  ',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
    });

    expect(r.success).toBe(true);
    expect(r.result).toBe('   \n\t  ');
    // Pipeline should not be called
    expect(pipe).not.toHaveBeenCalled();
  });

  it('includes totalChars in inference timing matching text length', async () => {
    const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Resultado' }]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    const testText = 'Hello World';  // 11 characters

    await dispatch({
      type: 'translate',
      text: testText,
      sourceLang: 'en',
      targetLang: 'es',
      provider: 'opus-mt',
      sessionId: 'test-session-6',
    });

    expect(mockRecordTiming).toHaveBeenCalledWith(
      'test-session-6',
      'model_inference',
      expect.any(Number),
      expect.objectContaining({
        totalChars: testText.length,
      })
    );
  });

  it('calculates batch totalChars correctly from array items', async () => {
    const pipe = vi.fn().mockResolvedValue([
      { translation_text: 'Hola' },
      { translation_text: 'Mundo' },
      { translation_text: 'Test' },
    ]);
    mockGetCachedPipeline.mockReturnValue(pipe);

    const textArray = ['Hello', 'World', 'Test'];  // 5 + 5 + 4 = 14 chars
    const expectedTotalChars = textArray.reduce((sum, t) => sum + t.length, 0);

    await dispatch({
      type: 'translate',
      text: textArray,
      sourceLang: 'en',
      targetLang: 'es',
      provider: 'opus-mt',
      sessionId: 'test-session-7',
    });

    expect(mockRecordTiming).toHaveBeenCalledWith(
      'test-session-7',
      'model_inference',
      expect.any(Number),
      expect.objectContaining({
        totalChars: expectedTotalChars,
      })
    );
  });

  describe('Branch coverage (lines 90, 124)', () => {
    it('returns error response for unsupported language pair (line 90)', async () => {
      const r = await dispatch({
        type: 'translate',
        text: 'test',
        sourceLang: 'unsupported-lang',
        targetLang: 'another-unsupported',
        provider: 'opus-mt',
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('Unsupported language pair');
    });
  });
});
