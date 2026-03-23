/**
 * Text utility helpers
 */

/**
 * Split text into sentences on common terminal punctuation.
 *
 * Splits after `.`, `!`, or `?` when followed by whitespace and an uppercase
 * letter (including accented Unicode capitals). This avoids splitting on
 * abbreviations like "Mr. Smith" where the following word starts lowercase.
 *
 * The `/u` flag enables full Unicode mode for the capital-letter lookahead.
 */
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÀÈÌÒÙÄÖÜ])/u;

export function splitIntoSentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT_RE).filter(Boolean);
}

/**
 * Approximate token count for a piece of text (~4 chars per token).
 * Useful for batching and rate-limit estimation.
 */
export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
