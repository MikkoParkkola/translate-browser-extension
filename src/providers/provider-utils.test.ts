import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTranslationPrompt,
  detectProviderLanguageCode,
  generateLanguagePairs,
  parseBatchResponse,
} from './provider-utils';

describe('generateLanguagePairs', () => {
  it('returns all non-identity pairs for the provided languages', () => {
    expect(generateLanguagePairs(['en', 'fi', 'de'])).toEqual([
      { src: 'en', tgt: 'fi' },
      { src: 'en', tgt: 'de' },
      { src: 'fi', tgt: 'en' },
      { src: 'fi', tgt: 'de' },
      { src: 'de', tgt: 'en' },
      { src: 'de', tgt: 'fi' },
    ]);
  });

  it('deduplicates repeated language codes before building pairs', () => {
    expect(generateLanguagePairs(['en', 'fi', 'en'])).toEqual([
      { src: 'en', tgt: 'fi' },
      { src: 'fi', tgt: 'en' },
    ]);
  });

  it('memoizes equivalent language lists', () => {
    const first = generateLanguagePairs(['en', 'fi', 'de']);
    const second = generateLanguagePairs(['en', 'fi', 'de']);

    expect(second).toBe(first);
  });
});

describe('buildTranslationPrompt', () => {
  it('builds a single-line provider prompt while preserving formal wording', () => {
    expect(
      buildTranslationPrompt('fi', 'formal', {
        roleDescription: 'You are a professional translator.',
        translationInstruction: 'Translate the following text to',
        formalInstruction: 'Use formal language and polite forms.',
        informalInstruction: 'Use casual, informal language.',
        trailingInstruction: 'Provide only the translation, no explanations.',
      }),
    ).toBe(
      'You are a professional translator. Translate the following text to Finnish. Use formal language and polite forms. Provide only the translation, no explanations.',
    );
  });

  it('builds a multiline rules prompt and omits neutral formality instructions', () => {
    expect(
      buildTranslationPrompt('fi', 'neutral', {
        roleDescription: 'You are an expert translator.',
        translationInstruction: 'Translate the provided text to',
        formalInstruction: 'Use formal register and polite forms where appropriate.',
        informalInstruction: 'Use casual, conversational language.',
        rules: [
          'Rules:',
          '- Output ONLY the translation, no explanations or notes',
          '- Preserve formatting (line breaks, punctuation)',
        ],
      }),
    ).toBe(
      'You are an expert translator. Translate the provided text to Finnish.\n\nRules:\n- Output ONLY the translation, no explanations or notes\n- Preserve formatting (line breaks, punctuation)',
    );
  });
});

describe('detectProviderLanguageCode', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const logError = vi.fn<(message: string, error: unknown) => void>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    logError.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes detected provider codes to lowercase ISO-639-1 output', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: ' FI ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      detectProviderLanguageCode<{ code: string }>(
        'Example',
        'https://example.test/detect',
        { method: 'POST' },
        (data) => data.code,
        logError,
      ),
    ).resolves.toBe('fi');
  });

  it('returns auto and logs when the provider responds with an HTTP error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Bad gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    await expect(
      detectProviderLanguageCode<{ code: string }>(
        'Example',
        'https://example.test/detect',
        { method: 'POST' },
        (data) => data.code,
        logError,
      ),
    ).resolves.toBe('auto');
    expect(logError).toHaveBeenCalledWith(
      'Language detection error:',
      expect.any(Error),
    );
  });

  it('returns auto when the extracted language code is not ISO-639-1', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'English' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      detectProviderLanguageCode<{ code: string }>(
        'Example',
        'https://example.test/detect',
        { method: 'POST' },
        (data) => data.code,
        logError,
      ),
    ).resolves.toBe('auto');
  });
});

describe('parseBatchResponse', () => {
  it('falls through when separator fallback is enabled but the separator is absent', () => {
    const results = parseBatchResponse('Hei\nMaailma', 2, {
      separatorFallback: true,
      newlineFallback: true,
    });

    expect(results).toEqual(['Hei', 'Maailma']);
  });

  it('keeps allowExtras XML results dense when extra indices are non-consecutive', () => {
    const results = parseBatchResponse('<t0>Hello</t0><t4>World</t4>', 2, {
      allowExtras: true,
    });

    expect(results).toEqual(['Hello', '', '', '', 'World']);
    expect(results.every(value => typeof value === 'string')).toBe(true);
  });

  it('keeps legacy XML extras dense when allowExtras is enabled', () => {
    const results = parseBatchResponse(
      '<text id="0">One</text><text id="3">Four</text>',
      1,
      {
        allowExtras: true,
        legacyXmlFallback: true,
      },
    );

    expect(results).toEqual(['One', '', '', 'Four']);
    expect(results.every(value => typeof value === 'string')).toBe(true);
  });
});
