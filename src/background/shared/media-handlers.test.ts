import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMediaHandlers } from './media-handlers';

function createDependencies() {
  return {
    offscreenTransport: {
      send: vi.fn(),
    },
    captureVisibleTab: vi.fn(),
    deleteDownloadedModelInventoryEntry: vi.fn().mockResolvedValue(undefined),
    clearDownloadedModelInventory: vi.fn().mockResolvedValue(undefined),
    clearMatchingCaches: vi.fn().mockResolvedValue([]),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('createMediaHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a model after best-effort offscreen pipeline cleanup', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({ success: true });
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleDeleteModel({ type: 'deleteModel', modelId: 'model-1' })
    ).resolves.toEqual({ success: true });

    expect(deps.offscreenTransport.send).toHaveBeenCalledWith({
      type: 'clearPipelineCache',
    });
    expect(deps.deleteDownloadedModelInventoryEntry).toHaveBeenCalledWith('model-1');
  });

  it('keeps deleteModel successful when the offscreen pipeline cache clear fails', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockRejectedValue(new Error('offscreen unavailable'));
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleDeleteModel({ type: 'deleteModel', modelId: 'model-2' })
    ).resolves.toEqual({ success: true });

    expect(deps.log.warn).toHaveBeenCalledWith(
      'Could not clear offscreen pipeline cache (may not be running)'
    );
    expect(deps.deleteDownloadedModelInventoryEntry).toHaveBeenCalledWith('model-2');
  });

  it('returns an extracted error when model deletion fails', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({ success: true });
    deps.deleteDownloadedModelInventoryEntry.mockRejectedValue(new Error('Storage error'));
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleDeleteModel({ type: 'deleteModel', modelId: 'model-3' })
    ).resolves.toEqual({
      success: false,
      error: 'Storage error',
    });
    expect(deps.log.error).toHaveBeenCalledWith(
      'Failed to delete model:',
      expect.any(Error)
    );
  });

  it('clears model inventory and matching caches', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({ success: true });
    deps.clearMatchingCaches.mockResolvedValue([
      'transformers-cache-v1',
      'onnx-model-cache',
    ]);
    const handlers = createMediaHandlers(deps);

    await expect(handlers.handleClearAllModels()).resolves.toEqual({ success: true });

    expect(deps.clearDownloadedModelInventory).toHaveBeenCalled();
    expect(deps.clearMatchingCaches).toHaveBeenCalledWith([
      'transformers',
      'onnx',
      'model',
    ]);
    expect(deps.log.info).toHaveBeenCalledWith('Cleared cache: transformers-cache-v1');
    expect(deps.log.info).toHaveBeenCalledWith('Cleared cache: onnx-model-cache');
  });

  it('preserves clearAllModels success when CacheStorage is unavailable', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({ success: true });
    deps.clearMatchingCaches.mockResolvedValue(null);
    const handlers = createMediaHandlers(deps);

    await expect(handlers.handleClearAllModels()).resolves.toEqual({ success: true });
    expect(deps.log.info).toHaveBeenCalledWith(
      'CacheStorage unavailable in service worker; skipping model cache cleanup'
    );
  });

  it('preserves clearAllModels success when cache cleanup throws', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({ success: true });
    deps.clearMatchingCaches.mockRejectedValue(new Error('caches unavailable'));
    const handlers = createMediaHandlers(deps);

    await expect(handlers.handleClearAllModels()).resolves.toEqual({ success: true });
    expect(deps.log.warn).toHaveBeenCalledWith(
      'Model cache cleanup failed:',
      expect.any(Error)
    );
  });

  it('forwards OCR requests to offscreen and returns the response unchanged', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockResolvedValue({
      success: true,
      text: 'Extracted text',
      confidence: 95.1,
      blocks: [
        {
          text: 'Block 1',
          confidence: 95.1,
          bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
        },
      ],
    });
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleOCRImage({
        type: 'ocrImage',
        imageData: 'data:image/png;base64,abc',
        lang: 'en',
      })
    ).resolves.toEqual({
      success: true,
      text: 'Extracted text',
      confidence: 95.1,
      blocks: [
        {
          text: 'Block 1',
          confidence: 95.1,
          bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
        },
      ],
    });
    expect(deps.offscreenTransport.send).toHaveBeenCalledWith({
      type: 'ocrImage',
      imageData: 'data:image/png;base64,abc',
      lang: 'en',
    });
  });

  it('returns an extracted error when OCR throws', async () => {
    const deps = createDependencies();
    deps.offscreenTransport.send.mockRejectedValue(new Error('OCR failed'));
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleOCRImage({
        type: 'ocrImage',
        imageData: 'data:image/png;base64,abc',
      })
    ).resolves.toEqual({
      success: false,
      error: 'OCR failed',
    });
  });

  it('captures a full screenshot when no crop rect is provided', async () => {
    const deps = createDependencies();
    deps.captureVisibleTab.mockResolvedValue('data:image/png;base64,full');
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleCaptureScreenshot({ type: 'captureScreenshot' })
    ).resolves.toEqual({
      success: true,
      imageData: 'data:image/png;base64,full',
    });
    expect(deps.captureVisibleTab).toHaveBeenCalledWith({ format: 'png' });
  });

  it('returns cropped screenshot data when cropping succeeds', async () => {
    const deps = createDependencies();
    deps.captureVisibleTab.mockResolvedValue('data:image/png;base64,full');
    deps.offscreenTransport.send.mockResolvedValue({
      success: true,
      imageData: 'data:image/png;base64,cropped',
    });
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleCaptureScreenshot({
        type: 'captureScreenshot',
        rect: { x: 1, y: 2, width: 3, height: 4 },
        devicePixelRatio: 2,
      })
    ).resolves.toEqual({
      success: true,
      imageData: 'data:image/png;base64,cropped',
    });
    expect(deps.offscreenTransport.send).toHaveBeenCalledWith({
      type: 'cropImage',
      imageData: 'data:image/png;base64,full',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      devicePixelRatio: 2,
    });
  });

  it('falls back to the original screenshot when cropImage returns failure', async () => {
    const deps = createDependencies();
    deps.captureVisibleTab.mockResolvedValue('data:image/png;base64,full');
    deps.offscreenTransport.send.mockResolvedValue({
      success: false,
      error: 'crop failed',
    });
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleCaptureScreenshot({
        type: 'captureScreenshot',
        rect: { x: 10, y: 20, width: 30, height: 40 },
      })
    ).resolves.toEqual({
      success: true,
      imageData: 'data:image/png;base64,full',
    });
  });

  it('returns an extracted error when screenshot capture throws', async () => {
    const deps = createDependencies();
    deps.captureVisibleTab.mockRejectedValue(new Error('Cannot capture restricted page'));
    const handlers = createMediaHandlers(deps);

    await expect(
      handlers.handleCaptureScreenshot({ type: 'captureScreenshot' })
    ).resolves.toEqual({
      success: false,
      error: 'Cannot capture restricted page',
    });
    expect(deps.log.error).toHaveBeenCalledWith(
      'Screenshot capture failed:',
      expect.any(Error)
    );
  });
});
