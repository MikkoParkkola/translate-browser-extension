import type { ExtensionMessage } from '../../types';

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

export function assertNever(value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(value)}`);
}
