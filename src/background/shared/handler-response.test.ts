import { describe, expect, it, vi } from 'vitest';

import {
  withMessageResponse,
  withMessageResponseFallback,
  withMessageResponseFixedError,
} from './handler-response';

describe('handler response helpers', () => {
  it('keeps success payloads from overriding reserved response keys', async () => {
    const response = await withMessageResponse(async () => ({
      success: false,
      error: 'shadowed',
      value: 42,
    }));

    expect(response).toEqual({
      success: true,
      value: 42,
    });
  });

  it('keeps fixed-error responses from leaking reserved payload keys', async () => {
    const onError = vi.fn();

    const response = await withMessageResponseFixedError(
      async () => ({
        error: 'shadowed',
        status: 'ok',
      }),
      'Failed to do thing',
      onError,
    );

    expect(response).toEqual({
      success: true,
      status: 'ok',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps fallback payloads from overriding failure envelopes', async () => {
    const response = await withMessageResponseFallback(
      async () => {
        throw new Error('boom');
      },
      {
        success: true,
        error: 'shadowed',
        items: [],
      } as unknown as { items: string[] },
    );

    expect(response).toEqual({
      success: false,
      error: 'boom',
      items: [],
    });
  });
});
