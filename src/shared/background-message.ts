import type { Setter } from 'solid-js';
import { sendMessage } from '../core/browser-api';
import { reportUiError, type ErrorLogger } from './ui-feedback';

export interface BackgroundMessageOptions {
  onError?: (error: unknown) => void;
}

export interface BackgroundMessageUiErrorOptions extends BackgroundMessageOptions {
  setError: Setter<string | null>;
  logger: ErrorLogger;
  userMessage: string;
  logMessage: string;
}

export async function sendBackgroundMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
  return sendMessage<TResponse>(message);
}

export async function trySendBackgroundMessage<TResponse = unknown>(
  message: unknown,
  options: BackgroundMessageOptions = {}
): Promise<TResponse | undefined> {
  try {
    return await sendBackgroundMessage<TResponse>(message);
  } catch (error) {
    options.onError?.(error);
    return undefined;
  }
}

export async function sendBackgroundMessageWithUiError<TResponse = unknown>(
  message: unknown,
  options: BackgroundMessageUiErrorOptions
): Promise<TResponse | undefined> {
  return trySendBackgroundMessage<TResponse>(message, {
    onError: (error) => {
      reportUiError(options.setError, options.logger, options.userMessage, options.logMessage, error);
      options.onError?.(error);
    },
  });
}
