import { describe, it, expect } from 'vitest';
import { HandledError, standardErrorHandler } from './standardErrorHandler';

describe('HandledError', () => {
  it('sets message, name, and context', () => {
    const ctx = { source: 'test', operation: 'init' };
    const err = new HandledError('something broke', ctx);

    expect(err.message).toBe('something broke');
    expect(err.name).toBe('HandledError');
    expect(err.context).toEqual(ctx);
  });

  it('is an instance of Error', () => {
    const err = new HandledError('msg', {});
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HandledError);
  });
});

describe('standardErrorHandler.handleError', () => {
  it('wraps an Error into HandledError with context', () => {
    const original = new Error('original error');
    const ctx = { source: 'unit-test', operation: 'testing' };
    const handled = standardErrorHandler.handleError(original, ctx);

    expect(handled).toBeInstanceOf(HandledError);
    expect(handled.message).toBe('original error');
    expect(handled.context).toEqual(ctx);
  });

  it('uses "handled error" as default message when error.message is empty', () => {
    const original = new Error('');
    const handled = standardErrorHandler.handleError(original, { source: 'test' });

    expect(handled.message).toBe('handled error');
  });

  it('works with empty context (default {})', () => {
    const original = new Error('fail');
    const handled = standardErrorHandler.handleError(original);

    expect(handled).toBeInstanceOf(HandledError);
    expect(handled.message).toBe('fail');
    expect(handled.context).toEqual({});
  });
});
