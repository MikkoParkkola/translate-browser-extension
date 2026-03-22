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
  InferenceEngine: vi.fn(function () { return mockEngine; }),
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
        (_urls: string[], _config: unknown, onProgress?: (p: Record<string, number>) => void) => {
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

  describe('chatTranslate message', () => {
    it('posts error when model not loaded', async () => {
      mockEngine.isReady.mockReturnValue(false);

      await sendMessage({
        type: 'chatTranslate',
        messages: [{ role: 'user', content: 'hello' }],
        requestId: 'chat-nolm',
      });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'chat-nolm',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('not loaded');
    });

    it('handles abort by posting translationCancelled', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.isReady.mockReturnValue(true);
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockEngine.chatComplete.mockRejectedValueOnce(abortError);
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'chatTranslate',
        messages: [{ role: 'user', content: 'hello' }],
        requestId: 'chat-abort',
      });

      const cancelMsg = postMessageCalls.find(
        (m) => m.type === 'translationCancelled' && m.requestId === 'chat-abort',
      );
      expect(cancelMsg).toBeDefined();
    });

    it('handles generic error', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.isReady.mockReturnValue(true);
      mockEngine.chatComplete.mockRejectedValueOnce(new Error('Chat inference failed'));
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'chatTranslate',
        messages: [{ role: 'user', content: 'hello' }],
        requestId: 'chat-err',
      });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'chat-err',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('Chat translation failed');
    });
  });

  describe('loadModelFromBlobs message', () => {
    it('posts error on blob load failure', async () => {
      mockEngine.loadModelFromBlobs.mockRejectedValueOnce(new Error('Blob corrupt'));

      await sendMessage({
        type: 'loadModelFromBlobs',
        blobs: [new Blob(['bad'])],
        config: {},
      });

      const errorMsg = postMessageCalls.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('Failed to load model from cache');
    });
  });

  describe('cleanup message', () => {
    it('posts error on cleanup failure', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.destroy.mockRejectedValueOnce(new Error('Cleanup boom'));
      postMessageCalls.length = 0;

      await sendMessage({ type: 'cleanup', requestId: 'clean-err' });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'clean-err',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('Cleanup failed');
    });
  });

  describe('loadModel with modelUrl (singular)', () => {
    it('falls back to modelUrl when modelUrls is missing', async () => {
      await sendMessage({
        type: 'loadModel',
        modelUrl: 'http://example.com/single.gguf',
        config: {},
      });

      expect(mockEngine.loadModel).toHaveBeenCalledWith(
        'http://example.com/single.gguf',
        {},
        expect.any(Function),
      );
    });

    it('falls back to empty array when both modelUrls and modelUrl are missing', async () => {
      await sendMessage({
        type: 'loadModel',
        config: {},
      });

      expect(mockEngine.loadModel).toHaveBeenCalledWith(
        [],
        {},
        expect.any(Function),
      );
    });
  });

  describe('initialize idempotency', () => {
    it('does not re-initialize if engine already exists', async () => {
      // First call initializes
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      const initCount1 = mockEngine.init.mock.calls.length;

      // Second call should still call init since worker creates new engine
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m2.gguf'] });
      // After first loadModel, engine is set, so initialize() returns early
      expect(mockEngine.init.mock.calls.length).toBe(initCount1);
    });
  });

  describe('translate message (additional paths)', () => {
    it('uses default maxTokens and temperature when not provided', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.isReady.mockReturnValue(true);
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'translate',
        prompt: 'test',
        requestId: 'req-defaults',
      });

      expect(mockEngine.complete).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ maxTokens: 512, temperature: 0.1 }),
      );
    });
  });

  describe('chatTranslate message (additional paths)', () => {
    it('uses default maxTokens and temperature when not provided', async () => {
      await sendMessage({ type: 'loadModel', modelUrls: ['http://example.com/m.gguf'] });
      mockEngine.isReady.mockReturnValue(true);
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'chatTranslate',
        messages: [{ role: 'user', content: 'hi' }],
        requestId: 'chat-defaults',
      });

      expect(mockEngine.chatComplete).toHaveBeenCalledWith(
        [{ role: 'user', content: 'hi' }],
        expect.objectContaining({ maxTokens: 512, temperature: 0.1 }),
      );
    });
  });

  describe('top-level error handler', () => {
    it('catches errors thrown from message handlers', async () => {
      // Force an error in the switch by making the type handler throw
      mockEngine.init.mockRejectedValueOnce(new Error('Init explosion'));
      // Reset engine to force re-init
      mockEngine.destroy.mockResolvedValueOnce(undefined);
      await sendMessage({ type: 'cleanup' });
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'loadModel',
        modelUrls: ['http://example.com/m.gguf'],
        requestId: 'top-err',
      });

      // The error should be caught by the top-level try/catch or inner handler
      const errorMsg = postMessageCalls.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
    });

    it('catches uncaught errors that escape inner handlers via abort', async () => {
      // Load model first to set isReady and engine
      await sendMessage({
        type: 'loadModel',
        modelUrls: ['http://example.com/m.gguf'],
      });
      postMessageCalls.length = 0;

      // Make engine.abort throw — abort() has no try/catch, so it propagates to outer catch
      mockEngine.abort.mockImplementationOnce(() => {
        throw new Error('Abort explosion');
      });

      await sendMessage({ type: 'abort', requestId: 'abort-err' });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'abort-err',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toBe('Abort explosion');
    });
  });

  describe('beforeunload event', () => {
    it('calls cleanup when beforeunload fires', () => {
      // The worker registers self.addEventListener('beforeunload', ...) at module init
      // Dispatch beforeunload event to trigger it
      const event = new Event('beforeunload');
      self.dispatchEvent(event);

      // cleanup calls engine.destroy and resets state
      expect(mockEngine.destroy).toHaveBeenCalled();
    });
  });

  describe('translate model not loaded (isReady false)', () => {
    it('posts error when translate called before model is loaded', async () => {
      // Don't load any model — worker.isReady is false
      // But first we need to re-import to get fresh state — the loadModel calls
      // in other tests set isReady. However, since we share state, let's call cleanup first.
      mockEngine.destroy.mockResolvedValueOnce(undefined);
      await sendMessage({ type: 'cleanup' });
      postMessageCalls.length = 0;

      await sendMessage({
        type: 'translate',
        prompt: 'test',
        requestId: 'not-loaded-1',
      });

      const errorMsg = postMessageCalls.find(
        (m) => m.type === 'error' && m.requestId === 'not-loaded-1',
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('not loaded');
    });
  });

  describe('abort with active AbortController', () => {
    it('aborts the current controller when one is active', async () => {
      // Load a model first so the worker is ready
      await sendMessage({ type: 'loadModel', modelUrl: 'test-model.gguf' });
      postMessageCalls.length = 0;

      // Start a translate to set up the _currentAbortController
      // The translate sets _currentAbortController before calling engine.complete
      // Make engine.complete hang so abort can fire
      mockEngine.complete.mockImplementation(() => new Promise(() => {})); // never resolves
      mockEngine.isReady.mockReturnValue(true);

      // Fire translate in the background (don't await — it'll hang)
      // @ts-expect-error unused side-effect
      const _translatePromise = sendMessage({
        type: 'translate',
        prompt: 'test translate',
        requestId: 'abort-test-1',
      });

      // Give microtask a tick so translate sets up the controller
      await new Promise((r) => setTimeout(r, 0));

      // Now abort
      await sendMessage({ type: 'abort', requestId: 'abort-test-1' });

      // engine.abort should have been called (from the abort method)
      expect(mockEngine.abort).toHaveBeenCalled();
    });
  });
});
