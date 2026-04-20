import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
  },
});

describe('model-download-tracker', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ success: true });
  });

  it('routes model progress through the background contract', async () => {
    const { reportModelProgress } = await import('./model-download-tracker');

    reportModelProgress('opus-mt-en-fi', {
      status: 'progress',
      progress: 42,
      loaded: 420,
      total: 1000,
      file: 'model.onnx',
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'offscreenModelProgress',
      target: 'background',
      modelId: 'opus-mt-en-fi',
      status: 'progress',
      progress: 42,
      loaded: 420,
      total: 1000,
      file: 'model.onnx',
    });
  });

  it('routes downloaded model inventory updates through background', async () => {
    const { trackDownloadedModel } = await import('./model-download-tracker');

    await trackDownloadedModel('opus-mt-en-fi', {
      lastUsed: 1234,
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'offscreenDownloadedModelUpdate',
      target: 'background',
      modelId: 'opus-mt-en-fi',
      name: 'OPUS-MT EN-FI',
      size: undefined,
      lastUsed: 1234,
    });
  });

  it('throws when background rejects an inventory update', async () => {
    const { trackDownloadedModel } = await import('./model-download-tracker');
    mockSendMessage.mockResolvedValueOnce({ success: false, error: 'storage failed' });

    await expect(trackDownloadedModel('opus-mt-en-fi')).rejects.toThrow('storage failed');
  });

  it('does not throw when background progress relay fails', async () => {
    const { reportModelProgress } = await import('./model-download-tracker');
    mockSendMessage.mockRejectedValueOnce(new Error('background unavailable'));

    expect(() => {
      reportModelProgress('opus-mt-en-fi', {
        status: 'ready',
        progress: 100,
      });
    }).not.toThrow();

    await Promise.resolve();
  });
});
