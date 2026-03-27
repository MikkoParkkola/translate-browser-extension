import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/errors', () => ({
  extractErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  withRetry: vi.fn(),
}));

import { withRetry, type TranslationError } from '../../core/errors';
import {
  createOffscreenTransport,
  type CreateOffscreenTransportOptions,
} from './offscreen-transport';

const OFFSCREEN_URL =
  'chrome-extension://test-id/src/offscreen/offscreen.html';

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createTransport(
  overrides: Partial<CreateOffscreenTransportOptions> = {}
) {
  const log = createLogger();
  const options: CreateOffscreenTransportOptions = {
    log,
    getOffscreenUrl: () => OFFSCREEN_URL,
    getExistingContexts: vi.fn().mockResolvedValue([{ documentUrl: OFFSCREEN_URL }]),
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn((_message, callback) => {
      callback({ success: true, status: 'ready' });
    }),
    getLastError: vi.fn().mockReturnValue(undefined),
    sleepFn: vi.fn().mockResolvedValue(undefined),
    maxFailures: 2,
    maxResets: 2,
    cooldownMs: 5,
    defaultTimeoutMs: 50,
    retryConfig: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 },
    ...overrides,
  };

  return {
    transport: createOffscreenTransport(options),
    log,
    options,
  };
}

describe('createOffscreenTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withRetry).mockImplementation(
      async <T>(
        operation: () => Promise<T>,
        _config?: unknown,
        _shouldRetry?: (error: TranslationError) => boolean
      ) => operation()
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates the offscreen document when no context exists', async () => {
    const getExistingContexts = vi.fn().mockResolvedValue([]);
    const createDocument = vi.fn().mockResolvedValue(undefined);
    const { transport } = createTransport({
      getExistingContexts,
      createDocument,
    });

    await transport.ensureDocument();

    expect(getExistingContexts).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent offscreen creation attempts', async () => {
    let resolveFirstContextCheck!: (value: unknown[]) => void;
    const firstContextCheck = new Promise<unknown[]>((resolve) => {
      resolveFirstContextCheck = resolve;
    });
    let createResolved!: () => void;
    const createDocument = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          createResolved = resolve;
        })
    );
    const getExistingContexts = vi
      .fn()
      .mockImplementationOnce(() => firstContextCheck)
      .mockResolvedValue([]);

    const { transport } = createTransport({
      getExistingContexts,
      createDocument,
    });

    const first = transport.ensureDocument();
    await Promise.resolve();
    const second = transport.ensureDocument();

    resolveFirstContextCheck([]);
    await Promise.resolve();

    expect(createDocument).toHaveBeenCalledTimes(1);

    createResolved();
    await Promise.all([first, second]);
  });

  it('sends targeted messages through the offscreen transport', async () => {
    const sendMessage = vi.fn((_message, callback) => {
      callback({ success: true, supported: true, fp16: false });
    });
    const { transport } = createTransport({ sendMessage });

    const response = await transport.send<'checkWebGPU'>({
      type: 'checkWebGPU',
    });

    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'checkWebGPU', target: 'offscreen' },
      expect.any(Function)
    );
    expect(response).toEqual({
      success: true,
      supported: true,
      fp16: false,
    });
  });

  it('resets the offscreen document after a retryable offscreen failure', async () => {
    vi.mocked(withRetry).mockImplementation(
      async <T>(
        operation: () => Promise<T>,
        _config: unknown,
        shouldRetry?: (error: TranslationError) => boolean
      ) => {
        try {
          return await operation();
        } catch (error) {
          const retryableError: TranslationError = {
            category: 'internal',
            message: 'offscreen disconnected',
            retryable: true,
            technicalDetails:
              error instanceof Error ? error.message : String(error),
          };
          if (!shouldRetry?.(retryableError)) {
            throw error;
          }
          return operation();
        }
      }
    );

    const getExistingContexts = vi
      .fn()
      .mockResolvedValueOnce([{ documentUrl: OFFSCREEN_URL }])
      .mockResolvedValueOnce([{ documentUrl: OFFSCREEN_URL }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ documentUrl: OFFSCREEN_URL }]);
    const sendMessage = vi
      .fn()
      .mockImplementationOnce((_message, callback) => {
        callback(undefined);
      })
      .mockImplementationOnce((_message, callback) => {
        callback({ success: true, status: 'ready' });
      });
    const getLastError = vi
      .fn()
      .mockReturnValueOnce({ message: 'offscreen disconnected' })
      .mockReturnValue(undefined);
    const closeDocument = vi.fn().mockResolvedValue(undefined);
    const createDocument = vi.fn().mockResolvedValue(undefined);
    const rejectInFlightRequests = vi.fn().mockReturnValue(2);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const { transport } = createTransport({
      getExistingContexts,
      sendMessage,
      getLastError,
      closeDocument,
      createDocument,
      rejectInFlightRequests,
      sleepFn,
    });

    const response = await transport.send<'ping'>({ type: 'ping' });

    expect(response).toEqual({ success: true, status: 'ready' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(rejectInFlightRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Translation engine reset — please retry',
      })
    );
    expect(closeDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(500);
  });

  it('matches senders against the offscreen document URL', () => {
    const { transport } = createTransport();

    expect(transport.isSender({ url: OFFSCREEN_URL })).toBe(true);
    expect(transport.isSender({ url: 'chrome-extension://test-id/other.html' })).toBe(false);
  });
});
