import { CONFIG } from '../../config';
import { sleep } from '../../core/async-utils';
import {
  extractErrorMessage,
  withRetry,
  type RetryConfig,
  type TranslationError,
} from '../../core/errors';
import type {
  OffscreenMessageByType,
  OffscreenMessageResponseMap,
  OffscreenMessageType,
} from '../../offscreen/message-routing';

const DEFAULT_OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';
const DEFAULT_OFFSCREEN_JUSTIFICATION = 'Run Transformers.js ML inference in document context';

export type OffscreenRequest<TType extends OffscreenMessageType> = Omit<
  OffscreenMessageByType<TType>,
  'target'
>;

export type OffscreenTransportResponse<TType extends OffscreenMessageType> =
  | OffscreenMessageResponseMap[TType]
  | { success: false; error: string };

export interface OffscreenTransportLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

type SendOffscreenMessage = (
  message: Record<string, unknown>,
  callback: (response?: unknown) => void
) => void;

interface OffscreenTransportDependencies {
  getOffscreenUrl?: () => string;
  getExistingContexts?: () => Promise<unknown[]>;
  createDocument?: () => Promise<void>;
  closeDocument?: () => Promise<void>;
  sendMessage?: SendOffscreenMessage;
  getLastError?: () => { message?: string } | null | undefined;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface CreateOffscreenTransportOptions
  extends OffscreenTransportDependencies {
  log: OffscreenTransportLogger;
  rejectInFlightRequests?: (error: Error) => number;
  maxFailures?: number;
  maxResets?: number;
  cooldownMs?: number;
  retryConfig?: Partial<RetryConfig>;
  defaultTimeoutMs?: number;
  documentPath?: string;
  justification?: string;
}

export interface OffscreenTransport {
  ensureDocument(): Promise<void>;
  send<TType extends OffscreenMessageType>(
    message: OffscreenRequest<TType>,
    timeoutMs?: number
  ): Promise<OffscreenTransportResponse<TType>>;
  isSender(sender: chrome.runtime.MessageSender): boolean;
}

export function createOffscreenTransport(
  options: CreateOffscreenTransportOptions
): OffscreenTransport {
  const getOffscreenUrl = () =>
    options.getOffscreenUrl?.() ??
    chrome.runtime.getURL(
      options.documentPath ?? DEFAULT_OFFSCREEN_DOCUMENT_PATH
    );

  const getExistingContexts =
    options.getExistingContexts ??
    (() =>
      chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [getOffscreenUrl()],
      }));

  const createDocument =
    options.createDocument ??
    (() =>
      chrome.offscreen.createDocument({
        url: getOffscreenUrl(),
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: options.justification ?? DEFAULT_OFFSCREEN_JUSTIFICATION,
      }));

  const closeDocument =
    options.closeDocument ?? (() => chrome.offscreen.closeDocument());

  const sendMessage: SendOffscreenMessage =
    options.sendMessage ??
    ((message, callback) => {
      chrome.runtime.sendMessage(message, callback);
    });

  const getLastError =
    options.getLastError ?? (() => chrome.runtime.lastError);
  const sleepFn = options.sleepFn ?? sleep;

  const maxFailures = options.maxFailures ?? CONFIG.retry.maxOffscreenFailures;
  const maxResets = options.maxResets ?? CONFIG.retry.maxOffscreenResets;
  const cooldownMs = options.cooldownMs ?? CONFIG.retry.offscreenCooldownMs;
  const retryConfig = options.retryConfig ?? {
    maxRetries: CONFIG.retry.offscreen.maxRetries,
    baseDelayMs: CONFIG.retry.offscreen.baseDelayMs,
    maxDelayMs: CONFIG.retry.offscreen.maxDelayMs,
  };
  const defaultTimeoutMs =
    options.defaultTimeoutMs ?? CONFIG.timeouts.offscreenMs;

  let creatingOffscreen: Promise<void> | null = null;
  let offscreenFailureCount = 0;
  let offscreenResetCount = 0;
  let circuitBreakerCooldownTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleCircuitBreakerReset(): void {
    if (circuitBreakerCooldownTimer) {
      clearTimeout(circuitBreakerCooldownTimer);
    }

    /* v8 ignore start -- timer callback */
    circuitBreakerCooldownTimer = setTimeout(() => {
      if (offscreenFailureCount > 0 || offscreenResetCount > 0) {
        options.log.info(
          `Circuit breaker cooldown: resetting counters (failures=${offscreenFailureCount}, resets=${offscreenResetCount})`
        );
        offscreenFailureCount = 0;
        offscreenResetCount = 0;
      }
      circuitBreakerCooldownTimer = null;
    }, cooldownMs);
    /* v8 ignore stop */
  }

  async function ensureDocument(): Promise<void> {
    /* v8 ignore start -- concurrent creation dedup */
    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }
    /* v8 ignore stop */

    try {
      const existingContexts = await getExistingContexts();

      if (existingContexts.length > 0) {
        offscreenFailureCount = 0;
        return;
      }

      /* v8 ignore start -- concurrent creation dedup */
      if (creatingOffscreen) {
        await creatingOffscreen;
        return;
      }
      /* v8 ignore stop */

      options.log.info('Creating offscreen document...');

      const createPromise = createDocument();
      creatingOffscreen = createPromise;

      await createPromise;
      creatingOffscreen = null;
      offscreenFailureCount = 0;
      options.log.info('Offscreen document created successfully');
    } catch (error) {
      creatingOffscreen = null;
      offscreenFailureCount++;
      scheduleCircuitBreakerReset();

      const errMsg = extractErrorMessage(error);

      options.log.error(' Failed to create offscreen document:', errMsg);

      if (offscreenFailureCount >= maxFailures) {
        throw new Error(
          'Translation engine failed to start. Please reload the extension or restart Chrome.'
        );
      }

      throw new Error(`Failed to initialize translation engine: ${errMsg}`);
    }
  }

  /* v8 ignore start -- recovery function only triggered by repeated offscreen crashes */
  async function resetDocument(): Promise<void> {
    offscreenResetCount++;
    scheduleCircuitBreakerReset();
    if (offscreenResetCount > maxResets) {
      const msg =
        'Translation engine crashed repeatedly. Please reload the extension or restart Chrome.';
      options.log.error(msg);
      throw new Error(msg);
    }

    options.log.info(
      `Offscreen reset attempt ${offscreenResetCount}/${maxResets}`
    );

    const rejectedCount =
      options.rejectInFlightRequests?.(
        new Error('Translation engine reset — please retry')
      ) ?? 0;
    if (rejectedCount > 0) {
      options.log.info(
        `Rejecting ${rejectedCount} in-flight requests before offscreen reset`
      );
    }

    try {
      const contexts = await getExistingContexts();
      if (contexts.length > 0) {
        await closeDocument();
        options.log.info('Closed existing offscreen document');
      }
    } catch (error) {
      options.log.warn(' Error closing offscreen document:', error);
    }

    creatingOffscreen = null;

    await sleepFn(500);
    await ensureDocument();

    offscreenResetCount = 0;
    options.log.info('Offscreen document reset successfully');
  }
  /* v8 ignore stop */

  async function send<TType extends OffscreenMessageType>(
    message: OffscreenRequest<TType>,
    timeoutMs = defaultTimeoutMs
  ): Promise<OffscreenTransportResponse<TType>> {
    return withRetry(
      async () => {
        await ensureDocument();

        return new Promise<OffscreenTransportResponse<TType>>(
          (resolve, reject) => {
            /* v8 ignore start -- timeout callback */
            const timeout = setTimeout(() => {
              reject(new Error('Offscreen communication timeout'));
            }, timeoutMs);
            /* v8 ignore stop */

            try {
              sendMessage({ ...message, target: 'offscreen' }, (response) => {
                clearTimeout(timeout);

                const runtimeError = getLastError();
                if (runtimeError) {
                  reject(new Error(runtimeError.message));
                  return;
                }

                if (response === undefined) {
                  reject(new Error('No response from translation engine'));
                  return;
                }

                resolve(response as OffscreenTransportResponse<TType>);
              });
            } catch (error) {
              clearTimeout(timeout);
              reject(error);
            }
          }
        );
      },
      retryConfig,
      /* v8 ignore start -- retry handler with offscreen reset */
      (error: TranslationError) => {
        if (!error.retryable) return false;

        if (error.technicalDetails.includes('offscreen')) {
          options.log.info('Attempting offscreen document reset...');
          resetDocument().catch((resetError) => {
            options.log.error(
              'Offscreen reset failed:',
              extractErrorMessage(resetError)
            );
          });
        }

        return true;
      }
      /* v8 ignore stop */
    );
  }

  function isSender(sender: chrome.runtime.MessageSender): boolean {
    return sender.url === getOffscreenUrl();
  }

  return {
    ensureDocument,
    send,
    isSender,
  };
}
