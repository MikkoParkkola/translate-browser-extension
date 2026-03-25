import { describe, expect, it } from 'vitest';

import {
  isOffscreenDownloadedModelUpdateMessage,
  isOffscreenModelMessage,
  isOffscreenModelProgressMessage,
} from './model-downloads';

describe('model-downloads guards', () => {
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
});
