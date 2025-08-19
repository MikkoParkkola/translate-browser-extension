// @jest-environment node
const { splitLongText } = require('../src/translator/batching.js');

describe('translator batching splitLongText', () => {
  test('splits at sentence boundaries', () => {
    const text = 'One two. Three four. Five six.';
    const chunks = splitLongText(text, 2);
    expect(chunks).toEqual(['One two.', 'Three four.', 'Five six.']);
  });

  test('handles long paragraphs without punctuation', () => {
    const text = 'a'.repeat(1000);
    const chunks = splitLongText(text, 100);
    expect(chunks).toHaveLength(3); // step 400 => 3 chunks
    chunks.forEach(ch => expect(ch.length).toBeLessThanOrEqual(400));
  });

  test('splits overlong sentences respecting token limits', () => {
    const text = `${'a'.repeat(500)}. Next sentence.`;
    const chunks = splitLongText(text, 50);
    expect(chunks).toHaveLength(4);
    expect(chunks[3]).toBe('Next sentence.');
  });
});
