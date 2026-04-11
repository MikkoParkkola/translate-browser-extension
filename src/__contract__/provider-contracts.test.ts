/**
 * Provider Contract / Schema Tests
 *
 * Validates that every translation provider conforms to the expected
 * interfaces (TranslationResult shape, BaseProvider contract, and
 * provider-specific response parsing).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseProvider } from '../providers/base-provider';
import { AnthropicProvider } from '../providers/anthropic';
import { OpenAIProvider } from '../providers/openai';
import { DeepLProvider } from '../providers/deepl';
import { GoogleCloudProvider } from '../providers/google-cloud';
import { ChromeTranslatorProvider } from '../providers/chrome-translator';
import { OpusMTProvider } from '../providers/opus-mt-local';
import {
  installCloudProviderTestHarness,
  okJsonResponse,
} from './cloud-provider-test-harness';

const { mockStorage, resetCloudProviderState, mockFetch } = installCloudProviderTestHarness();

const okResponse = okJsonResponse;

// ---------------------------------------------------------------------------
// Module mocks (same as the individual test files)
// ---------------------------------------------------------------------------
vi.mock('../core/language-map', () => ({
  getLanguageName: (code: string) => {
    const names: Record<string, string> = { en: 'English', fi: 'Finnish', de: 'German', fr: 'French', es: 'Spanish' };
    return names[code] ?? code;
  },
  getAllLanguageCodes: () => ['en', 'fi', 'de', 'fr', 'es'],
  toDeepLCode: (code: string) => {
    const map: Record<string, string> = { en: 'EN', fi: 'FI', de: 'DE', fr: 'FR', es: 'ES' };
    return map[code.toLowerCase()] ?? code.toUpperCase();
  },
  getDeepLSupportedLanguages: () => ['en', 'fi', 'de', 'fr', 'es'],
}));

vi.mock('../core/webgpu-detector', () => ({
  webgpuDetector: {
    detect: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    supported: false,
  },
}));

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
}));

// =========================================================================
// 1. BaseProvider abstract contract
// =========================================================================
describe('BaseProvider abstract contract', () => {
  it('all providers extend BaseProvider', () => {
    expect(new AnthropicProvider()).toBeInstanceOf(BaseProvider);
    expect(new OpenAIProvider()).toBeInstanceOf(BaseProvider);
    expect(new DeepLProvider()).toBeInstanceOf(BaseProvider);
    expect(new GoogleCloudProvider()).toBeInstanceOf(BaseProvider);
    expect(new ChromeTranslatorProvider()).toBeInstanceOf(BaseProvider);
    expect(new OpusMTProvider()).toBeInstanceOf(BaseProvider);
  });

  it('all providers implement translate method', () => {
    const providers = [
      new AnthropicProvider(),
      new OpenAIProvider(),
      new DeepLProvider(),
      new GoogleCloudProvider(),
      new ChromeTranslatorProvider(),
      new OpusMTProvider(),
    ];
    for (const p of providers) {
      expect(typeof p.translate).toBe('function');
    }
  });

  it('all providers have a name property (non-empty string)', () => {
    const providers = [
      new AnthropicProvider(),
      new OpenAIProvider(),
      new DeepLProvider(),
      new GoogleCloudProvider(),
      new ChromeTranslatorProvider(),
      new OpusMTProvider(),
    ];
    for (const p of providers) {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('all providers have a unique id', () => {
    const providers = [
      new AnthropicProvider(),
      new OpenAIProvider(),
      new DeepLProvider(),
      new GoogleCloudProvider(),
      new ChromeTranslatorProvider(),
      new OpusMTProvider(),
    ];
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all providers implement getInfo returning ProviderConfig shape', () => {
    const providers = [
      new AnthropicProvider(),
      new OpenAIProvider(),
      new DeepLProvider(),
      new GoogleCloudProvider(),
      new ChromeTranslatorProvider(),
      new OpusMTProvider(),
    ];
    for (const p of providers) {
      const info = p.getInfo();
      expect(info).toHaveProperty('id');
      expect(info).toHaveProperty('name');
      expect(info).toHaveProperty('type');
      expect(info).toHaveProperty('qualityTier');
      expect(info).toHaveProperty('costPerMillion');
      expect(info).toHaveProperty('icon');
    }
  });

  it('all providers implement getSupportedLanguages returning LanguagePair[]', () => {
    const providers = [
      new AnthropicProvider(),
      new OpenAIProvider(),
      new DeepLProvider(),
      new GoogleCloudProvider(),
      new ChromeTranslatorProvider(),
      new OpusMTProvider(),
    ];
    for (const p of providers) {
      const langs = p.getSupportedLanguages();
      expect(Array.isArray(langs)).toBe(true);
      if (langs.length > 0) {
        expect(langs[0]).toHaveProperty('src');
        expect(langs[0]).toHaveProperty('tgt');
      }
    }
  });
});

// =========================================================================
// 2. Anthropic response parsing contract
// =========================================================================
describe('Anthropic response parsing contract', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    resetCloudProviderState();
    provider = new AnthropicProvider();
  });

  it('parses {content: [{text: "..."}]} format correctly (single)', async () => {
    mockStorage['anthropic_api_key'] = 'sk-test';
    await provider.initialize();

    const apiResponse = {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hei maailma' }],
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn',
      usage: { input_tokens: 20, output_tokens: 5 },
    };

    mockFetch.mockResolvedValueOnce(okResponse(apiResponse));

    const result = await provider.translate('Hello world', 'en', 'fi');
    expect(typeof result).toBe('string');
    expect(result).toBe('Hei maailma');
  });

  it('returns string for single-text input', async () => {
    mockStorage['anthropic_api_key'] = 'sk-test';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        content: [{ type: 'text', text: 'Terve' }],
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
    );

    const result = await provider.translate('Hi', 'en', 'fi');
    expect(typeof result).toBe('string');
  });

  it('returns string[] for array input (batch)', async () => {
    mockStorage['anthropic_api_key'] = 'sk-test';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        content: [{ type: 'text', text: '<text id="0">Hei</text>\n<text id="1">Maailma</text>' }],
        usage: { input_tokens: 30, output_tokens: 10 },
      }),
    );

    const result = await provider.translate(['Hello', 'World'], 'en', 'fi');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Hei');
    expect(result[1]).toBe('Maailma');
  });

  it('returns single-element array when array input has one item', async () => {
    mockStorage['anthropic_api_key'] = 'sk-test';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        content: [{ type: 'text', text: 'Terve' }],
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
    );

    const result = await provider.translate(['Hi'], 'en', 'fi');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });
});

// =========================================================================
// 3. OpenAI response parsing contract
// =========================================================================
describe('OpenAI response parsing contract', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    resetCloudProviderState();
    provider = new OpenAIProvider();
  });

  it('parses {choices: [{message: {content: "..."}}]} format correctly', async () => {
    mockStorage['openai_api_key'] = 'sk-test';
    await provider.initialize();

    const apiResponse = {
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'Hei maailma' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 25, completion_tokens: 5, total_tokens: 30 },
    };

    mockFetch.mockResolvedValueOnce(okResponse(apiResponse));

    const result = await provider.translate('Hello world', 'en', 'fi');
    expect(typeof result).toBe('string');
    expect(result).toBe('Hei maailma');
  });

  it('returns string for single-text input', async () => {
    mockStorage['openai_api_key'] = 'sk-test';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        choices: [{ message: { content: 'Terve' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    );

    const result = await provider.translate('Hi', 'en', 'fi');
    expect(typeof result).toBe('string');
  });

  it('returns string[] for array input (batch via separator)', async () => {
    mockStorage['openai_api_key'] = 'sk-test';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        choices: [
          {
            message: { content: 'Hei\n---TRANSLATE_SEPARATOR---\nMaailma' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
      }),
    );

    const result = await provider.translate(['Hello', 'World'], 'en', 'fi');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Hei');
    expect(result[1]).toBe('Maailma');
  });

  it('recovers plain-text batches when the separator is missing', async () => {
    mockStorage['openai_api_key'] = 'sk-test';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        choices: [
          {
            message: { content: 'Hei\nMaailma' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
      }),
    );

    const result = await provider.translate(['Hello', 'World'], 'en', 'fi');
    expect(result).toEqual(['Hei', 'Maailma']);
  });
});

// =========================================================================
// 4. DeepL response parsing contract
// =========================================================================
describe('DeepL response parsing contract', () => {
  let provider: DeepLProvider;

  beforeEach(() => {
    resetCloudProviderState();
    provider = new DeepLProvider();
  });

  it('parses {translations: [{text: "..."}]} format correctly', async () => {
    mockStorage['deepl_api_key'] = 'test-key';
    await provider.initialize();

    const apiResponse = {
      translations: [{ detected_source_language: 'EN', text: 'Hei maailma' }],
    };

    mockFetch.mockResolvedValueOnce(okResponse(apiResponse));

    const result = await provider.translate('Hello world', 'en', 'fi');
    expect(typeof result).toBe('string');
    expect(result).toBe('Hei maailma');
  });

  it('returns string for single-text input', async () => {
    mockStorage['deepl_api_key'] = 'test-key';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        translations: [{ detected_source_language: 'EN', text: 'Terve' }],
      }),
    );

    const result = await provider.translate('Hi', 'en', 'fi');
    expect(typeof result).toBe('string');
  });

  it('returns string[] for array input', async () => {
    mockStorage['deepl_api_key'] = 'test-key';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        translations: [
          { detected_source_language: 'EN', text: 'Hei' },
          { detected_source_language: 'EN', text: 'Maailma' },
        ],
      }),
    );

    const result = await provider.translate(['Hello', 'World'], 'en', 'fi');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Hei');
    expect(result[1]).toBe('Maailma');
  });
});

// =========================================================================
// 5. Google Cloud response parsing contract
// =========================================================================
describe('Google Cloud response parsing contract', () => {
  let provider: GoogleCloudProvider;

  beforeEach(() => {
    resetCloudProviderState();
    provider = new GoogleCloudProvider();
  });

  it('parses {data: {translations: [{translatedText: "..."}]}} format correctly', async () => {
    mockStorage['google_cloud_api_key'] = 'test-key';
    await provider.initialize();

    const apiResponse = {
      data: {
        translations: [{ translatedText: 'Hei maailma', detectedSourceLanguage: 'en' }],
      },
    };

    mockFetch.mockResolvedValueOnce(okResponse(apiResponse));

    const result = await provider.translate('Hello world', 'en', 'fi');
    expect(typeof result).toBe('string');
    expect(result).toBe('Hei maailma');
  });

  it('returns string for single-text input', async () => {
    mockStorage['google_cloud_api_key'] = 'test-key';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        data: { translations: [{ translatedText: 'Terve' }] },
      }),
    );

    const result = await provider.translate('Hi', 'en', 'fi');
    expect(typeof result).toBe('string');
  });

  it('returns string[] for array input', async () => {
    mockStorage['google_cloud_api_key'] = 'test-key';
    await provider.initialize();

    mockFetch.mockResolvedValueOnce(
      okResponse({
        data: {
          translations: [
            { translatedText: 'Hei' },
            { translatedText: 'Maailma' },
          ],
        },
      }),
    );

    const result = await provider.translate(['Hello', 'World'], 'en', 'fi');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Hei');
    expect(result[1]).toBe('Maailma');
  });
});

// =========================================================================
// 6. Cloud providers throw on missing API key (not silent failure)
// =========================================================================
describe('Cloud providers throw on missing API key', () => {
  beforeEach(() => {
    resetCloudProviderState();
  });

  it('AnthropicProvider throws when no API key', async () => {
    const provider = new AnthropicProvider();
    await expect(provider.translate('Hi', 'en', 'fi')).rejects.toThrow();
  });

  it('OpenAIProvider throws when no API key', async () => {
    const provider = new OpenAIProvider();
    await expect(provider.translate('Hi', 'en', 'fi')).rejects.toThrow();
  });

  it('DeepLProvider throws when no API key', async () => {
    const provider = new DeepLProvider();
    await expect(provider.translate('Hi', 'en', 'fi')).rejects.toThrow();
  });

  it('GoogleCloudProvider throws when no API key', async () => {
    const provider = new GoogleCloudProvider();
    await expect(provider.translate('Hi', 'en', 'fi')).rejects.toThrow();
  });
});

// =========================================================================
// 7. OpusMT local provider contract
// =========================================================================
describe('OpusMT local provider contract', () => {
  let provider: OpusMTProvider;

  beforeEach(() => {
    resetCloudProviderState();
    provider = new OpusMTProvider();
  });

  it('throws for unsupported language pair (not silent)', async () => {
    // Mock the dynamic import so initialize succeeds
    const { pipeline } = await import('@huggingface/transformers');
    (pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(vi.fn());

    await provider.initialize();
    await expect(provider.translate('Hi', 'en', 'xx')).rejects.toThrow(/[Uu]nsupported/);
  });

  it('returns string for single-text input when pipeline succeeds', async () => {
    const mockPipe = vi.fn().mockResolvedValue([{ translation_text: 'Hei' }]);
    const { pipeline } = await import('@huggingface/transformers');
    (pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockPipe);

    await provider.initialize();

    const result = await provider.translate('Hi', 'en', 'fi');
    expect(typeof result).toBe('string');
    expect(result).toBe('Hei');
  });

  it('returns string[] for array input when pipeline succeeds', async () => {
    const mockPipe = vi.fn()
      .mockResolvedValueOnce([{ translation_text: 'Hei' }])
      .mockResolvedValueOnce([{ translation_text: 'Maailma' }]);
    const { pipeline } = await import('@huggingface/transformers');
    (pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockPipe);

    await provider.initialize();

    const result = await provider.translate(['Hi', 'World'], 'en', 'fi');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });
});
