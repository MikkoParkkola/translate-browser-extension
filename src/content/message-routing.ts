import { hasStringMessageType } from '../shared/message-guards';
import type {
  ContentMessage,
  ContentMessageByType,
  ContentMessageResponse,
  ContentMessageResponseMap,
  ContentMessageType,
  StartedContentResponse,
} from './content-types';

export type ContentMessageHandler<TType extends ContentMessageType> = (
  message: ContentMessageByType<TType>,
  sendResponse: (response: ContentMessageResponseMap[TType]) => void
) => true;

export type ContentMessageHandlers = {
  [TType in ContentMessageType]: ContentMessageHandler<TType>;
};

type StartedContentMessageType = {
  [TType in ContentMessageType]: ContentMessageResponseMap[TType] extends StartedContentResponse
    ? TType
    : never;
}[ContentMessageType];

const STARTED_CONTENT_RESPONSE = {
  success: true,
  status: 'started',
} as const satisfies StartedContentResponse;

export function defineImmediateContentHandler<TType extends ContentMessageType>(
  _type: TType,
  getResponse: (message: ContentMessageByType<TType>) => ContentMessageResponseMap[TType]
): ContentMessageHandler<TType> {
  return (message, sendResponse) => {
    sendResponse(getResponse(message));
    return true;
  };
}

export function defineStartedContentHandler<TType extends StartedContentMessageType>(
  _type: TType,
  dispatch: (message: ContentMessageByType<TType>) => Promise<void>,
  onError: (error: unknown) => void
): ContentMessageHandler<TType> {
  return (message, sendResponse) => {
    sendResponse(STARTED_CONTENT_RESPONSE);
    void dispatch(message).catch(onError);
    return true;
  };
}

export function routeContentMessage(
  message: unknown,
  sendResponse: (response: ContentMessageResponse) => void,
  handlers: ContentMessageHandlers
): boolean {
  if (!hasStringMessageType(message) || !(message.type in handlers)) {
    return false;
  }

  const handler = handlers[message.type as ContentMessageType] as (
    message: ContentMessage,
    sendResponse: (response: ContentMessageResponse) => void
  ) => true;

  return handler(message as ContentMessage, sendResponse);
}
