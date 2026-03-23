import type { Setter } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportUiError, showTemporaryMessage } from './ui-feedback';

function createSetterRecorder(): { calls: Array<string | null>; setter: Setter<string | null> } {
  const calls: Array<string | null> = [];
  const setter: Setter<string | null> = (value) => {
    const previous = calls.length > 0 ? calls[calls.length - 1]! : null;
    const nextValue = typeof value === 'function' ? value(previous) : value;
    calls.push(nextValue);
    return nextValue;
  };

  return { calls, setter };
}

describe('ui-feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reportUiError sets the user message and logs the raw error', () => {
    const { calls, setter } = createSetterRecorder();
    const logger = { error: vi.fn() };
    const error = new Error('boom');

    reportUiError(setter, logger, 'Failed to save', 'Save error:', error);

    expect(calls).toEqual(['Failed to save']);
    expect(logger.error).toHaveBeenCalledWith('Save error:', error);
  });

  it('showTemporaryMessage clears the message after the timeout', () => {
    const { calls, setter } = createSetterRecorder();
    const onClear = vi.fn();

    showTemporaryMessage(setter, 'Saved', 1500, onClear);

    expect(calls).toEqual(['Saved']);

    vi.advanceTimersByTime(1499);
    expect(calls).toEqual(['Saved']);

    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['Saved', null]);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
