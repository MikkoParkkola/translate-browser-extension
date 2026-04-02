import { describe, expect, it } from 'vitest';

import { buildTranslationPrompt, generateLanguagePairs } from './provider-utils';

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
