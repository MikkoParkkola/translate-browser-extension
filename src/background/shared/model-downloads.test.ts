import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isOffscreenDownloadedModelUpdateMessage,
  isOffscreenModelMessage,
  isOffscreenModelProgressMessage,
  relayModelProgress,
} from './model-downloads';

describe('model-downloads guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts valid offscreen progress updates', () => {
    expect(
      isOffscreenModelProgressMessage({
        type: 'offscreenModelProgress',
        target: 'background',
        modelId: 'opus-mt-en-fi',
        status: 'progress',
      })
    ).toBe(true);
  });

  it('rejects offscreen progress updates with the wrong target', () => {
    expect(
      isOffscreenModelProgressMessage({
        type: 'offscreenModelProgress',
        target: 'popup',
        modelId: 'opus-mt-en-fi',
        status: 'progress',
      })
    ).toBe(false);
  });

  it('accepts valid downloaded model updates', () => {
    expect(
      isOffscreenDownloadedModelUpdateMessage({
        type: 'offscreenDownloadedModelUpdate',
        target: 'background',
        modelId: 'opus-mt-en-fi',
      })
    ).toBe(true);
  });

  it('treats both internal message variants as offscreen model messages', () => {
    expect(
      isOffscreenModelMessage({
        type: 'offscreenModelProgress',
        target: 'background',
        modelId: 'opus-mt-en-fi',
        status: 'ready',
      })
    ).toBe(true);

    expect(
      isOffscreenModelMessage({
        type: 'offscreenDownloadedModelUpdate',
        target: 'background',
        modelId: 'opus-mt-en-fi',
      })
    ).toBe(true);
  });

  it('attaches a rejection handler when runtime messaging returns a promise', async () => {
    const rejection = new Error('port closed');
    const sendMessageSpy = vi.fn().mockReturnValue(Promise.reject(rejection));
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: sendMessageSpy,
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    relayModelProgress({
      modelId: 'opus-mt-en-fi',
      status: 'progress',
      progress: 42,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'modelProgress',
      modelId: 'opus-mt-en-fi',
      status: 'progress',
      progress: 42,
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[ModelDownloads]',
      'Model progress relay skipped:',
      rejection
    );
  });
});
