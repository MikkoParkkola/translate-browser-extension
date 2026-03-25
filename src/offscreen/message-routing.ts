import type {
  ClearCacheMessage,
  CloudProviderUsage,
  GetCloudProviderUsageMessage,
  GetProfilingStatsMessage,
  GetSupportedLanguagesMessage,
  MessageResponse,
  OCRBlock,
  OCRImageMessage,
  PingMessage,
  PreloadModelMessage,
  SupportedLanguageInfo,
  TranslationProviderId,
} from '../types';
import type { AggregateStats } from '../core/profiler';
import type { TranslationCacheStats } from '../core/translation-cache';
import { hasStringMessageType, isObjectRecord } from '../shared/message-guards';

export interface OffscreenTranslateMessage {
  type: 'translate';
  target: 'offscreen';
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  provider?: TranslationProviderId;
  sessionId?: string;
  pageContext?: string;
}

export interface OffscreenGetCacheStatsMessage {
  type: 'getCacheStats';
  target: 'offscreen';
}

export interface OffscreenCheckWebGPUMessage {
  type: 'checkWebGPU';
  target: 'offscreen';
}

export interface OffscreenCheckWebNNMessage {
  type: 'checkWebNN';
  target: 'offscreen';
}

export interface OffscreenClearPipelineCacheMessage {
  type: 'clearPipelineCache';
  target: 'offscreen';
}

export interface OffscreenTerminateOCRMessage {
  type: 'terminateOCR';
  target: 'offscreen';
}

export interface OffscreenCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OffscreenCropImageMessage {
  type: 'cropImage';
  target: 'offscreen';
  imageData: string;
  rect: OffscreenCropRect;
  devicePixelRatio?: number;
}

type TargetedOffscreenMessage<TMessage> = TMessage & { target: 'offscreen' };

export type OffscreenMessage =
  | OffscreenTranslateMessage
  | TargetedOffscreenMessage<GetProfilingStatsMessage>
  | TargetedOffscreenMessage<PreloadModelMessage>
  | TargetedOffscreenMessage<GetSupportedLanguagesMessage>
  | TargetedOffscreenMessage<PingMessage>
  | OffscreenCheckWebGPUMessage
  | OffscreenCheckWebNNMessage
  | OffscreenGetCacheStatsMessage
  | TargetedOffscreenMessage<ClearCacheMessage>
  | OffscreenClearPipelineCacheMessage
  | TargetedOffscreenMessage<GetCloudProviderUsageMessage>
  | TargetedOffscreenMessage<OCRImageMessage>
  | OffscreenTerminateOCRMessage
  | OffscreenCropImageMessage;

export type OffscreenMessageType = OffscreenMessage['type'];

export type OffscreenMessageByType<TType extends OffscreenMessageType> = Extract<
  OffscreenMessage,
  { type: TType }
>;

export interface OffscreenMessageResponseMap {
  translate: MessageResponse<{ result: string | string[]; profilingData?: unknown }>;
  getProfilingStats: MessageResponse<{ aggregates: Record<string, AggregateStats>; formatted: string }>;
  preloadModel: MessageResponse<{ preloaded: boolean; available?: boolean; partial?: boolean }>;
  getSupportedLanguages: { success: true; languages: SupportedLanguageInfo[] };
  ping: { success: true; status: 'ready' };
  checkWebGPU: { success: true; supported: boolean; fp16: boolean };
  checkWebNN: { success: true; supported: boolean };
  getCacheStats: MessageResponse<{ cache: TranslationCacheStats }>;
  clearCache: MessageResponse<{ cleared: true }>;
  clearPipelineCache: MessageResponse<{ cleared: true }>;
  getCloudProviderUsage: MessageResponse<{ usage: CloudProviderUsage }>;
  ocrImage: MessageResponse<{ text: string; confidence: number; blocks: OCRBlock[] }>;
  terminateOCR: MessageResponse;
  cropImage: MessageResponse<{ imageData: string }>;
}

export type OffscreenMessageResponse = OffscreenMessageResponseMap[OffscreenMessageType];
export type OffscreenRoutedResponse = OffscreenMessageResponse | MessageResponse;

export type OffscreenMessageHandler<TType extends OffscreenMessageType> = (
  message: OffscreenMessageByType<TType>
) => Promise<OffscreenMessageResponseMap[TType]>;

export type OffscreenMessageHandlers = {
  [TType in OffscreenMessageType]: OffscreenMessageHandler<TType>;
};

export interface OffscreenTargetedMessageRecord {
  target: 'offscreen';
  type?: unknown;
}

export function isOffscreenTargetedMessage(value: unknown): value is OffscreenTargetedMessageRecord {
  return isObjectRecord(value) && value.target === 'offscreen';
}

export function isHandledOffscreenMessage(
  message: OffscreenTargetedMessageRecord,
  handlers: OffscreenMessageHandlers
): message is OffscreenMessage {
  return hasStringMessageType(message) && Object.prototype.hasOwnProperty.call(handlers, message.type);
}

export async function routeOffscreenMessage(
  message: OffscreenTargetedMessageRecord,
  handlers: OffscreenMessageHandlers
): Promise<OffscreenRoutedResponse> {
  if (!isHandledOffscreenMessage(message, handlers)) {
    return {
      success: false,
      error: `Unknown type: ${typeof message.type === 'string' ? message.type : String(message.type)}`,
    };
  }

  const handler = handlers[message.type as OffscreenMessageType] as (
    message: OffscreenMessage
  ) => Promise<OffscreenMessageResponse>;

  return handler(message);
}
