import type { TranslationPipeline } from '../types';

export interface OpusMtSentenceSegment {
  text: string;
  separator: string;
}

export function splitOpusMtSentenceSegments(text: string): OpusMtSentenceSegment[] {
  if (text.length === 0) {
    return [];
  }

  const parts = text.split(/(?<=[.!?])(\s+)/u);
  const segments: OpusMtSentenceSegment[] = [];

  for (let index = 0; index < parts.length; index += 2) {
    const part = parts[index];
    if (!part) {
      continue;
    }

    const separator = parts[index + 1] ?? '';
    const trimmedPart = part.trim();
    if (trimmedPart.length === 0) {
      if (segments.length > 0) {
        segments[segments.length - 1].separator += separator;
      }
      continue;
    }

    segments.push({
      text: trimmedPart,
      separator,
    });
  }

  if (segments.length === 0) {
    const trimmedText = text.trim();
    return trimmedText.length === 0
      ? []
      : [{ text: trimmedText, separator: '' }];
  }

  return segments;
}

export function countOpusMtSentences(text: string): number {
  return splitOpusMtSentenceSegments(text).length;
}

async function translateSingleSegment(
  pipe: TranslationPipeline,
  text: string,
  pipelineOptions?: Record<string, unknown> & { max_length?: number }
): Promise<string> {
  const result = await pipe(text, pipelineOptions ?? { max_length: 512 });
  return result[0].translation_text;
}

export async function translateOpusMtText(
  pipe: TranslationPipeline,
  text: string,
  options: {
    splitMultiSentence?: boolean;
    onSplit?: (segmentCount: number) => void;
    pipelineOptions?: Record<string, unknown> & { max_length?: number };
  } = {}
): Promise<string> {
  const segments = options.splitMultiSentence
    ? splitOpusMtSentenceSegments(text)
    : [];

  if (segments.length <= 1) {
    return translateSingleSegment(pipe, text, options.pipelineOptions);
  }

  options.onSplit?.(segments.length);

  const translatedSegments: string[] = [];
  for (const segment of segments) {
    translatedSegments.push(
      await translateSingleSegment(pipe, segment.text, options.pipelineOptions)
    );
  }

  return translatedSegments
    .map((translated, index) => `${translated}${segments[index].separator}`)
    .join('');
}
