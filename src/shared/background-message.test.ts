import { describe, expect, it, vi } from 'vitest';
import { createBrowserApiModuleMock } from '../test-helpers/module-mocks';

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock('../core/browser-api', () =>
  createBrowserApiModuleMock({
    runtimeSendMessage: mockSendMessage,
    includeSendMessageExport: true,
  })
);

import {
  sendBackgroundMessage,
  sendBackgroundMessageWithUiError,
  trySendBackgroundMessage,
} from './background-message';

describe('background-message helpers', () => {
  it('delegates sendBackgroundMessage to browser-api sendMessage', async () => {
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValueOnce({ ok: true });

    const result = await sendBackgroundMessage<{ ok: boolean }>({ type: 'ping' });

    expect(result).toEqual({ ok: true });
    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'ping' });
  });

  it('returns undefined and calls onError when trySendBackgroundMessage fails', async () => {
    const onError = vi.fn();
    mockSendMessage.mockReset();
    mockSendMessage.mockRejectedValueOnce(new Error('boom'));

    const result = await trySendBackgroundMessage({ type: 'ping' }, { onError });

    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports UI errors when sendBackgroundMessageWithUiError fails', async () => {
    const setError = vi.fn();
    const logger = { error: vi.fn() };
    mockSendMessage.mockReset();
    mockSendMessage.mockRejectedValueOnce(new Error('boom'));

    const result = await sendBackgroundMessageWithUiError(
      { type: 'ping' },
      {
        setError,
        logger,
        userMessage: 'Failed to ping background',
        logMessage: 'Ping failed:',
      }
    );

    expect(result).toBeUndefined();
    expect(setError).toHaveBeenCalledWith('Failed to ping background');
    expect(logger.error).toHaveBeenCalledWith('Ping failed:', expect.any(Error));
  });
});
