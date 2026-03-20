/**
 * Tests for llamacpp-worker.ts (Web Worker message handler)
 *
 * Tests the InferenceWorker class and self.onmessage handler
 * that dispatches messages to load models, run translations, and cleanup.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted ensures mockEngine is defined before the hoisted vi.mock runs
const { mockEngine } = vi.hoisted(() => {
  const mockEngine = {
    init: vi.fn().mockResolvedValue({ success: true, hasWebGPU: true }),
    loadModel: vi.fn().mockResolvedValue({ success: true, modelInfo: { n_ctx: 2048 } }),
    loadModelFromBlobs: vi.fn().mockResolvedValue({ success: true, modelInfo: { n_ctx: 2048 } }),
    complete: vi.fn().mockResolvedValue({ text: 'translated', tokensGenerated: 5 }),
    chatComplete: vi.fn().mockResolvedValue({ text: 'chat translated', tokensGenerated: 4 }),
    abort: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    exit: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  };
  return { mockEngine };
});

vi.mock('./llama.cpp', () => ({
  InferenceEngine: vi.fn(() => mockEngine),
}));

// Set up worker globals before any imports
// @ts-expect-error - Mock worker self
globalThis.self = globalThis;

// Capture postMessage calls
const postMessageCalls: Record<string, unknown>[] = [];
globalThis.postMessage = vi.fn((msg: Record<string, unknown>) => { postMessageCalls.push(msg); });

// Load the worker module (side-effectful — sets self.onmessage)
await import('./llamacpp-worker');

describe('llamacpp-worker', () => {
  let onmessage: (event: { data: Record<string, unknown> }) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    postMessageCalls.length = 0;
    // @ts-expect-error - accessing worker onmessage
    onmessage = globalThis.self.onmessage;

    // Reset engine mock state
    mockEngine.init.mockResolvedValue({ success: true, hasWebGPU: true });
    mockEngine.loadModel.mockResolvedValue({ success: true, modelInfo: { n_ctx: 2048 } });
    mockEngine.complete.mockResolvedValue({ text: 'translated', tokensGenerated: 5 });
    mockEngine.chatComplete.mockResolvedValue({ text: 'chat translated', tokensGenerated: 4 });
    mockEngine.isReady.mockReturnValue(true);
  });

  function sendMessage(data: Record<string, unknown>) {
    return onmessage({ data });
  }

  describe('loadModel message', () => {
    it('initializes engine and loads model from URLs', async () => {
      const urls = [
        'http://example.com/shard-001.gguf',
        'http://example.com/shard-002.gguf',
      ];

      await sendMessage({
        type: 'loadModel',
        modelUrls: urls,
        config: { n_ctx: 4096 },
      });

      expect(mockEngine.init).toHaveBeenCalled();
      expect(mockEngine.loadModel).toHaveBeenCalledWith(
        urls,
        { n_ctx: 4096 },
        expect.any(Function),
      );

      const loadedMsg = postMessageCalls.find((m) => m.type === 'modelLoaded');
      expect(loadedMsg).toBeDefined();
      expect(loadedMsg!.modelInfo).toEqual({ n_ctx: 2048 });
    });

    it('posts progress updates during model loading', async () => {
      mockEngine.loadModel.mockImplementation(
        (urls: string[], config: unknown, onProgress?: (p: Record<string, number>) => void) => {
          if (onProgress) {
            onProgress({ loaded: 500, total: 1000, progress: 50 });
            onProgress({ loaded: 1000, total: 1000, progress: 100 });
          }
          return Promise.resolve({ success: true, modelInfo: { n_ctx: 2048 } });
        },
      );

      await sendMessage({
        type: 'loadModel',
        modelUrls: ['http://example.com/model.gguf'],
      });

      const progressMsgs = postMessageCalls.filter((m) => m.type === 'progress');
      expect(progressMsgs.length).toBe(2);
      expect(progressMsgs[0].progress).toBe(50);
      expect(progressMsgs[1].progress).toBe(100);
    });

    it('posts error on model load failure', async () => {
      mockEngine.loadModel.mockRejectedValueOnce(new Error('Out of memory'));

      await sendMessage({
        type: 'loadModel',
        modelUrls: ['http://example.com/model.gguf'],
      });

      const errorMsg = postMessageCalls.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('Failed to load model');
    });
  });

  describe('loadModelFromBlobs message', () => {
    it('loads model from blobs', async () => {
      const blobs = [new Blob(['data'])];

      await sendMessage({
        type: 'loadModelFromBlobs',
        blobs,
        config: {},
      });

      expect(mockEngine.loadModelFromBlobs).toHaveBeenCalledWith(blobs, {});
      const loadedMsg = postMessageCalls.find((m) => m.type === 'modelLoaded');
      expect(loadedMsg).toBeDefined();
    });
  });

  describe('translate message', () => {
    it('runs completion and posts result', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'translate',
        prompt: 'Translate: hello',
        maxTokens: 256,
        temperature: 0.2,
        requestId: 'req-1',
      });

      const resultMsg = postMessageCalls.find((m) => m.type === 'translationComplete');
      expect(resultMsg).toBeDefined();
      expect(resultMsg!.requestId).toBe('req-1');
      expect(resultMsg!.translatedText).toBe('translated');
      expect(resultMsg!.tokensGenerated).toBe(5);
    });

    it('posts error when model not loaded', async () => {
      mockEngine.isReady.mockReturnValue(false);

      await sendMessage({
        type: 'translate',
        prompt: 'test',
        requestId: 'req-err',
      });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'req-err',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('not loaded');
    });

    it('handles translation errors', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.isReady.mockReturnValue(true);
      mockEngine.complete.mockRejectedValueOnce(new Error('Inference failed'));
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'translate',
        prompt: 'test',
        requestId: 'req-fail',
      });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'req-fail',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('Translation failed');
    });

    it('handles abort by posting translationCancelled', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.isReady.mockReturnValue(true);
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockEngine.complete.mockRejectedValueOnce(abortError);
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'translate',
        prompt: 'test',
        requestId: 'req-abort',
      });

      const cancelMsg = postMessageCalls.find(
        (m) => m.type === 'translationCancelled' && m.requestId === 'req-abort',
      );
      expect(cancelMsg).toBeDefined();
    });
  });

  describe('chatTranslate message', () => {
    it('runs chat completion and posts result', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.isReady.mockReturnValue(true);
      postMessageCalls.length = 0;

      const messages = [{ role: 'user', content: 'Translate: hello' }];

      await sendMessage({
        type: 'chatTranslate',
        messages,
        maxTokens: 128,
        temperature: 0.3,
        requestId: 'chat-1',
      });

      const resultMsg = postMessageCalls.find((m) => m.type === 'translationComplete');
      expect(resultMsg).toBeDefined();
      expect(resultMsg!.requestId).toBe('chat-1');
      expect(resultMsg!.translatedText).toBe('chat translated');
    });
  });

  describe('abort message', () => {
    it('calls engine abort', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });

      await sendMessage({ type: 'abort', requestId: 'req-1' });

      expect(mockEngine.abort).toHaveBeenCalled();
    });
  });

  describe('cleanup message', () => {
    it('destroys engine and posts cleanupComplete', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      postMessageCalls.length = 0;

      await sendMessage({ type: 'cleanup', requestId: 'cleanup-1' });

      expect(mockEngine.destroy).toHaveBeenCalled();
      const completeMsg = postMessageCalls.find((m) => m.type === 'cleanupComplete');
      expect(completeMsg).toBeDefined();
      expect(completeMsg!.requestId).toBe('cleanup-1');
    });
  });

  describe('unknown message type', () => {
    it('posts error for unknown type', async () => {
      await sendMessage({ type: 'unknownType', requestId: 'unk-1' });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'unk-1',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('Unknown message type');
    });
  });

  describe('legacy load message', () => {
    it('redirects to loadModel when modelUrls provided', async () => {
      await sendMessage({
        type: 'load',
        modelUrls: ['http://example.com/model.gguf'],
        config: {},
      });

      expect(mockEngine.loadModel).toHaveBeenCalled();
    });

    it('posts error when legacy load without modelUrls', async () => {
      await sendMessage({ type: 'load', requestId: 'legacy-1' });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'legacy-1',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('no longer supported');
    });
  });
});
