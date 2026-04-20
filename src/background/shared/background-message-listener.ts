import type {
  BackgroundRequestMessage,
  ExtensionMessage,
  MessageResponse,
} from '../../types';
import { createTranslationError } from '../../core/errors';
import { formatUserError } from './provider-management';
import {
  isAuthorizedExtensionSender,
  isExtensionMessage,
  routeHandledExtensionMessage,
} from './message-routing';

interface BackgroundMessageListenerLogger {
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

interface BackgroundMessagePreRouteArgs<TResponse> {
  message: ExtensionMessage;
  sender: chrome.runtime.MessageSender;
  sendResponse: (response: TResponse | MessageResponse | unknown) => void;
}

interface CreateBackgroundMessageListenerOptions<
  TMessage extends BackgroundRequestMessage,
  TResponse,
> {
  extensionUrlPrefix: string;
  isHandledMessage: (message: ExtensionMessage) => message is TMessage;
  dispatch: (message: TMessage) => Promise<TResponse>;
  log: BackgroundMessageListenerLogger;
  beforeRoute?: (args: BackgroundMessagePreRouteArgs<TResponse>) => boolean | void;
  logUnknownMessage?: (type: ExtensionMessage['type']) => void;
  errorLogPrefix?: string;
}

export function createBackgroundMessageListener<
  TMessage extends BackgroundRequestMessage,
  TResponse,
>({
  extensionUrlPrefix,
  isHandledMessage,
  dispatch,
  log,
  beforeRoute,
  logUnknownMessage,
  errorLogPrefix = '',
}: CreateBackgroundMessageListenerOptions<TMessage, TResponse>) {
  return (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: TResponse | MessageResponse | unknown) => void
  ): boolean | void => {
    if (!isExtensionMessage(message)) {
      return;
    }

    if ('target' in message && message.target === 'offscreen') {
      return false;
    }

    const preRouteResult = beforeRoute?.({
      message,
      sender,
      sendResponse,
    });

    if (preRouteResult !== undefined) {
      return preRouteResult;
    }

    if (!isAuthorizedExtensionSender(message, sender.url, extensionUrlPrefix)) {
      sendResponse({ success: false, error: 'Unauthorized sender' });
      return true;
    }

    return routeHandledExtensionMessage({
      message,
      sendResponse,
      isHandledMessage,
      dispatch,
      logUnknownMessage: logUnknownMessage
        ?? ((type) => log.warn(`Unknown message type: ${type}`)),
      createErrorResponse: (error) => {
        const translationError = createTranslationError(error);
        log.error(`${errorLogPrefix}Error:`, translationError.technicalDetails);
        return {
          success: false,
          error: formatUserError(translationError),
        };
      },
    });
  };
}
