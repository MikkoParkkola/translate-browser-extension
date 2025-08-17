const throttle = require('../src/throttle');

test('splitSentences detects boundaries', () => {
  expect(throttle.splitSentences('Hello! Bye?')).toEqual(['Hello!', 'Bye?']);
});

test('predictiveBatch groups sentences under limit', () => {
  const batches = throttle.predictiveBatch(['Hi. Yo. Ok.'], 2);
  expect(batches).toEqual([['Hi.', 'Yo.'], ['Ok.']]);
});
