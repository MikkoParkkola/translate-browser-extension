const bd = require('../src/lib/batchDelim');

test('splitSentences splits on punctuation', () => {
  expect(bd.splitSentences('Hello world. How are you?')).toEqual(['Hello world.', 'How are you?']);
});

test('createBatches respects token limit', () => {
  const texts = ['One. Two. Three. Four. Five.'];
  const approx = () => 1; // each sentence counts as 1 token
  const batches = bd.createBatches(texts, 2, approx);
  expect(batches).toHaveLength(3);
  expect(batches[0].text.split(batches[0].delimiter)).toHaveLength(2);
});
