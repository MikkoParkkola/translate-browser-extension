import { describe, expect, it, vi } from 'vitest';
import {
  httpErrorResponse,
  installCloudProviderTestHarness,
  okJsonResponse,
  queueFetchSequence,
  queueHttpError,
  queueJsonResponse,
  queueRejectedFetch,
} from './cloud-provider-test-harness';

describe('cloud provider test harness helpers', () => {
  it('okJsonResponse provides json, text, and headers access', async () => {
    const response = okJsonResponse(
      { ok: true },
      {
        headers: { 'Retry-After': '60' },
      },
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(response.text()).resolves.toBe('{"ok":true}');
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('missing')).toBeNull();
  });

  it('httpErrorResponse supports optional headers and json body', async () => {
    const response = httpErrorResponse(429, 'Rate limited', {
      headers: { 'Retry-After': '30' },
      jsonBody: { error: 'rate_limit_exceeded' },
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
    await expect(response.text()).resolves.toBe('Rate limited');
    await expect(response.json()).resolves.toEqual({
      error: 'rate_limit_exceeded',
    });
    expect(response.headers.get('retry-after')).toBe('30');
  });

  it('queues individual helper responses onto mock fetch', async () => {
    const mockFetch = vi.fn();

    queueJsonResponse(mockFetch, { value: 1 });
    queueHttpError(mockFetch, 500, 'Boom');
    queueRejectedFetch(mockFetch, new Error('offline'));

    await expect(mockFetch()).resolves.toMatchObject({ ok: true, status: 200 });
    await expect(mockFetch()).resolves.toMatchObject({
      ok: false,
      status: 500,
    });
    await expect(mockFetch()).rejects.toThrow('offline');
  });

  it('queues mixed fetch sequences from the installed harness', async () => {
    const harness = installCloudProviderTestHarness();

    harness.queueFetchSequence(
      { type: 'json', body: { first: true } },
      {
        type: 'httpError',
        status: 429,
        body: 'Slow down',
        options: { headers: { 'Retry-After': '15' } },
      },
      { type: 'reject', error: new TypeError('network down') },
    );

    const first = await harness.mockFetch();
    expect(await first.json()).toEqual({ first: true });

    const second = await harness.mockFetch();
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('15');

    await expect(harness.mockFetch()).rejects.toThrow('network down');
  });

  it('supports direct queueFetchSequence usage with shared mockFetch', async () => {
    const mockFetch = vi.fn();

    queueFetchSequence(
      mockFetch,
      { type: 'json', body: { one: 1 } },
      { type: 'json', body: { two: 2 }, options: { text: 'custom' } },
    );

    const first = await mockFetch();
    expect(await first.json()).toEqual({ one: 1 });

    const second = await mockFetch();
    expect(await second.text()).toBe('custom');
  });
});
