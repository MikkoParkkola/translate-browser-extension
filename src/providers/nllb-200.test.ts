import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ISO_TO_FLORES, NLLB200Provider } from './nllb-200';

const mockTransformersPipeline = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  pipeline: mockTransformersPipeline,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('NLLB200Provider', () => {
  let provider: NLLB200Provider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new NLLB200Provider();
  });

  it('is always available for lazy local model loading', async () => {
    await expect(provider.isAvailable()).resolves.toBe(true);
  });

  it('returns supported language pairs without self-pairs', () => {
    const pairs = provider.getSupportedLanguages();

    expect(pairs).toContainEqual({ src: 'en', tgt: 'de' });
    expect(pairs).toContainEqual({ src: 'fi', tgt: 'en' });
    expect(pairs.every((pair) => pair.src !== pair.tgt)).toBe(true);
  });

  it('reports supported and unsupported language pairs truthfully', () => {
    expect(provider.supportsLanguagePair('en', 'de')).toBe(true);
    expect(provider.supportsLanguagePair('fi', 'ja')).toBe(true);
    expect(provider.supportsLanguagePair('xx', 'de')).toBe(false);
    expect(provider.supportsLanguagePair('en', 'yy')).toBe(false);
  });

  it('keeps common ISO to FLORES mappings stable', () => {
    expect(ISO_TO_FLORES.en).toBe('eng_Latn');
    expect(ISO_TO_FLORES.de).toBe('deu_Latn');
    expect(ISO_TO_FLORES.fi).toBe('fin_Latn');
    expect(ISO_TO_FLORES.zh).toBe('zho_Hans');
  });

  it('rejects unsupported language pairs before loading the model', async () => {
    await expect(provider.translate('Hello', 'xx', 'yy')).rejects.toThrow(
      'NLLB-200: unsupported language pair xx→yy',
    );
    expect(mockTransformersPipeline).not.toHaveBeenCalled();
  });

  it('translates a single string with FLORES language codes', async () => {
    const mockPipe = vi
      .fn()
      .mockResolvedValue([{ translation_text: 'Hallo Welt' }]);
    mockTransformersPipeline.mockResolvedValue(mockPipe);

    const result = await provider.translate('Hello World', 'en', 'de');

    expect(result).toBe('Hallo Welt');
    expect(mockTransformersPipeline).toHaveBeenCalledWith(
      'translation',
      'Xenova/nllb-200-distilled-600M',
      expect.objectContaining({ device: 'wasm', dtype: 'q8' }),
    );
    expect(mockPipe).toHaveBeenCalledWith('Hello World', {
      src_lang: 'eng_Latn',
      tgt_lang: 'deu_Latn',
    });
  });

  it('translates arrays while preserving empty and whitespace-only items', async () => {
    const mockPipe = vi
      .fn()
      .mockImplementation(async (text: string) => [
        { translation_text: text === 'Hello' ? 'Hallo' : 'Maailma' },
      ]);
    mockTransformersPipeline.mockResolvedValue(mockPipe);

    const result = await provider.translate(
      ['Hello', '', '   ', 'World'],
      'en',
      'fi',
    );

    expect(result).toEqual(['Hallo', '', '   ', 'Maailma']);
    expect(mockPipe).toHaveBeenCalledTimes(2);
  });

  it('falls back to the original text when the pipeline returns no translation text', async () => {
    const mockPipe = vi.fn().mockResolvedValue([{}]);
    mockTransformersPipeline.mockResolvedValue(mockPipe);

    const result = await provider.translate('Hello', 'en', 'de');

    expect(result).toBe('Hello');
  });

  it('deduplicates concurrent pipeline loading and reuses the loaded pipeline', async () => {
    const load =
      deferred<
        (
          text: string,
          options?: Record<string, unknown>,
        ) => Promise<Array<{ translation_text: string }>>
      >();
    const mockPipe = vi
      .fn()
      .mockImplementation(async (text: string) => [
        { translation_text: `${text}-translated` },
      ]);
    mockTransformersPipeline.mockImplementation(() => load.promise);

    const first = provider.translate('Hello', 'en', 'de');
    const second = provider.translate('World', 'en', 'de');

    load.resolve(mockPipe);

    await expect(Promise.all([first, second])).resolves.toEqual([
      'Hello-translated',
      'World-translated',
    ]);

    await expect(provider.translate('Again', 'en', 'de')).resolves.toBe(
      'Again-translated',
    );
    expect(mockTransformersPipeline).toHaveBeenCalledTimes(1);
    expect(mockPipe).toHaveBeenCalledTimes(3);
  });
});
