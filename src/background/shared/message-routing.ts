import type { ExtensionMessage, MessageResponse } from '../../types';

export function isExtensionMessage(message: unknown): message is ExtensionMessage {
  return (
    typeof message === 'object'
    && message !== null
    && 'type' in message
    && typeof (message as { type?: unknown }).type === 'string'
  );
}

export function isHandledExtensionMessage<TType extends ExtensionMessage['type']>(
  message: ExtensionMessage,
  handledTypes: readonly TType[]
): message is Extract<ExtensionMessage, { type: TType }> {
  return (handledTypes as readonly string[]).includes(message.type);
}

export const SENSITIVE_EXTENSION_MESSAGE_TYPES = [
  'setCloudApiKey',
  'clearCloudApiKey',
  'importCorrections',
  'clearCache',
  'clearCorrections',
  'clearHistory',
  'clearAllModels',
  'clearProfilingStats',
] as const satisfies readonly ExtensionMessage['type'][];

export function isAuthorizedExtensionSender(
  message: ExtensionMessage,
  senderUrl: string | undefined,
  extensionUrlPrefix: string
): boolean {
  return (
    !(SENSITIVE_EXTENSION_MESSAGE_TYPES as readonly string[]).includes(message.type)
    || !senderUrl
    || senderUrl.startsWith(extensionUrlPrefix)
  );
}

interface RouteHandledExtensionMessageOptions<TMessage extends ExtensionMessage, TResponse> {
  message: ExtensionMessage;
  sendResponse: (response: TResponse | MessageResponse) => void;
  isHandledMessage: (message: ExtensionMessage) => message is TMessage;
  dispatch: (message: TMessage) => Promise<TResponse>;
  logUnknownMessage?: (type: ExtensionMessage['type']) => void;
  createErrorResponse: (error: unknown) => MessageResponse;
}

export function routeHandledExtensionMessage<TMessage extends ExtensionMessage, TResponse>({
  message,
  sendResponse,
  isHandledMessage,
  dispatch,
  logUnknownMessage,
  createErrorResponse,
}: RouteHandledExtensionMessageOptions<TMessage, TResponse>): true {
  if (!isHandledMessage(message)) {
    logUnknownMessage?.(message.type);
    sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
    return true;
  }

  dispatch(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse(createErrorResponse(error));
    });

  return true;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(value)}`);
}
