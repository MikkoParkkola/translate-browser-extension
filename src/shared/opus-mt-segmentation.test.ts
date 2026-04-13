import { describe, it, expect, vi } from 'vitest';
import {
  countOpusMtSentences,
  splitOpusMtSentenceSegments,
  translateOpusMtText,
} from './opus-mt-segmentation';

describe('splitOpusMtSentenceSegments', () => {
  it('returns no segments for empty input', () => {
    expect(splitOpusMtSentenceSegments('')).toEqual([]);
  });

  it('returns no segments for whitespace-only input', () => {
    expect(splitOpusMtSentenceSegments('   ')).toEqual([]);
  });

  it('returns a trimmed single segment when no sentence boundary exists', () => {
    expect(splitOpusMtSentenceSegments('  Hello world  ')).toEqual([
      { text: 'Hello world', separator: '' },
    ]);
  });

  it('splits multi-sentence text and preserves separators', () => {
    expect(
      splitOpusMtSentenceSegments('First sentence. Second sentence!\nThird sentence?')
    ).toEqual([
      { text: 'First sentence.', separator: ' ' },
      { text: 'Second sentence!', separator: '\n' },
      { text: 'Third sentence?', separator: '' },
    ]);
  });

  it('keeps trailing whitespace on the final completed sentence', () => {
    expect(splitOpusMtSentenceSegments('First sentence. ')).toEqual([
      { text: 'First sentence.', separator: ' ' },
    ]);
  });
});

describe('countOpusMtSentences', () => {
  it('counts segmented sentences', () => {
    expect(countOpusMtSentences('First sentence. Second sentence! Third sentence?')).toBe(3);
  });
});

describe('translateOpusMtText', () => {
  it('uses a single pipeline call when splitting is disabled', async () => {
    const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Hallo Welt' }]);

    const result = await translateOpusMtText(pipe, 'Hello world', {
      pipelineOptions: { max_length: 256, src_lang: 'en' },
    });

    expect(result).toBe('Hallo Welt');
    expect(pipe).toHaveBeenCalledTimes(1);
    expect(pipe).toHaveBeenCalledWith('Hello world', {
      max_length: 256,
      src_lang: 'en',
    });
  });

  it('does not split a single sentence even when probe splitting is enabled', async () => {
    const pipe = vi.fn().mockResolvedValue([{ translation_text: 'Hallo Welt.' }]);
    const onSplit = vi.fn();

    const result = await translateOpusMtText(pipe, 'Hello world.', {
      splitMultiSentence: true,
      onSplit,
      pipelineOptions: { max_length: 512 },
    });

    expect(result).toBe('Hallo Welt.');
    expect(onSplit).not.toHaveBeenCalled();
    expect(pipe).toHaveBeenCalledTimes(1);
    expect(pipe).toHaveBeenCalledWith('Hello world.', { max_length: 512 });
  });

  it('splits multi-sentence text into per-sentence inference calls', async () => {
    const pipe = vi.fn()
      .mockResolvedValueOnce([{ translation_text: 'Ensimmäinen lause.' }])
      .mockResolvedValueOnce([{ translation_text: 'Toinen lause!' }])
      .mockResolvedValueOnce([{ translation_text: 'Kolmas lause?' }]);
    const onSplit = vi.fn();

    const result = await translateOpusMtText(
      pipe,
      'First sentence. Second sentence!\nThird sentence?',
      {
        splitMultiSentence: true,
        onSplit,
        pipelineOptions: { max_length: 512, src_lang: 'en', tgt_lang: 'fi' },
      }
    );

    expect(result).toBe('Ensimmäinen lause. Toinen lause!\nKolmas lause?');
    expect(onSplit).toHaveBeenCalledWith(3);
    expect(pipe).toHaveBeenNthCalledWith(1, 'First sentence.', {
      max_length: 512,
      src_lang: 'en',
      tgt_lang: 'fi',
    });
    expect(pipe).toHaveBeenNthCalledWith(2, 'Second sentence!', {
      max_length: 512,
      src_lang: 'en',
      tgt_lang: 'fi',
    });
    expect(pipe).toHaveBeenNthCalledWith(3, 'Third sentence?', {
      max_length: 512,
      src_lang: 'en',
      tgt_lang: 'fi',
    });
  });
});
