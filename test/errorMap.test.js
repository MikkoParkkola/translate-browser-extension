const errorMap = require('../src/lib/errorMap');

describe('errorMap.classify', () => {
  it('classifies authentication errors', () => {
    const result401 = errorMap.classify({ status: 401, message: 'Unauthorized' });
    const result403 = errorMap.classify({ code: 403, message: 'Forbidden' });

    expect(result401).toEqual({ key: 'auth', text: 'Authentication issue. Check your API key.' });
    expect(result403).toEqual({ key: 'auth', text: 'Authentication issue. Check your API key.' });
  });

  it('classifies rate limit errors', () => {
    const result = errorMap.classify({ status: 429, message: 'Rate limit' });
    expect(result).toEqual({ key: 'rate', text: 'Rate limited. Please retry in a moment.' });
  });

  it('classifies provider availability errors', () => {
    const result = errorMap.classify({ status: 503, message: 'Service unavailable' });
    expect(result).toEqual({ key: 'provider', text: 'Provider unavailable. Try again shortly.' });
  });

  it('classifies timeout errors using message heuristics', () => {
    const result = errorMap.classify({ code: 0, message: 'Request timed out after 30s' });
    expect(result).toEqual({ key: 'timeout', text: 'Request timed out. Retry or switch provider.' });
  });

  it('classifies offline/network errors using message heuristics', () => {
    const result = errorMap.classify({ message: 'Network connection offline' });
    expect(result).toEqual({ key: 'offline', text: 'You appear offline. Check your connection.' });
  });

  it('falls back to generic classification when no signal matches', () => {
    const result = errorMap.classify({ message: 'Unexpected error occurred' });
    expect(result).toEqual({ key: 'generic', text: 'Translation failed. Please try again.' });
  });

  it('handles missing error object safely', () => {
    const result = errorMap.classify(null);
    expect(result).toEqual({ key: 'generic', text: 'Translation failed. Please try again.' });
  });
});
