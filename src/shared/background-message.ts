import type { Setter } from 'solid-js';
import { sendMessage } from '../core/browser-api';
import type {
  BackgroundRequestMessage,
  ExtensionMessageResponse,
} from '../types';
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

export function sendBackgroundMessage<TMessage extends BackgroundRequestMessage>(
  message: TMessage
): Promise<ExtensionMessageResponse<TMessage>>;
export function sendBackgroundMessage<TResponse = unknown>(message: unknown): Promise<TResponse>;
export async function sendBackgroundMessage(message: unknown): Promise<unknown> {
  return sendMessage(message);
}

export function trySendBackgroundMessage<TMessage extends BackgroundRequestMessage>(
  message: TMessage,
  options?: BackgroundMessageOptions
): Promise<ExtensionMessageResponse<TMessage> | undefined>;
export function trySendBackgroundMessage<TResponse = unknown>(
  message: unknown,
  options?: BackgroundMessageOptions
): Promise<TResponse | undefined>;
export async function trySendBackgroundMessage(
  message: unknown,
  options: BackgroundMessageOptions = {}
): Promise<unknown | undefined> {
  try {
    return await sendBackgroundMessage(message);
  } catch (error) {
    options.onError?.(error);
    return undefined;
  }
}

export function sendBackgroundMessageWithUiError<TMessage extends BackgroundRequestMessage>(
  message: TMessage,
  options: BackgroundMessageUiErrorOptions
): Promise<ExtensionMessageResponse<TMessage> | undefined>;
export function sendBackgroundMessageWithUiError<TResponse = unknown>(
  message: unknown,
  options: BackgroundMessageUiErrorOptions
): Promise<TResponse | undefined>;
export async function sendBackgroundMessageWithUiError(
  message: unknown,
  options: BackgroundMessageUiErrorOptions
): Promise<unknown | undefined> {
  return trySendBackgroundMessage(message, {
    onError: (error) => {
      reportUiError(options.setError, options.logger, options.userMessage, options.logMessage, error);
      options.onError?.(error);
    },
  });
}
