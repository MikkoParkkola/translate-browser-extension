import type {
  BackgroundRequestMessage,
  BackgroundRequestMessageType,
  ExtensionMessage,
  ExtensionMessageResponse,
  ExtensionMessageResponseByType,
  PreloadModelMessage,
  TranslationProviderId,
} from '../../types';
import { extractErrorMessage } from '../../core/errors';
import { handleSetProvider } from './provider-management';
import {
  handleClearCloudApiKey,
  handleGetCacheStats,
  handleGetCloudProviderStatus,
  handleGetUsage,
  handleSetCloudApiKey,
  handleSetCloudProviderEnabled,
} from './message-handlers';
import { assertNever, isHandledExtensionMessage } from './message-routing';
import type { TranslationCache } from './storage-ops';

type Awaitable<T> = T | Promise<T>;

export const COMMON_BACKGROUND_MESSAGE_TYPES = [
  'ping',
  'translate',
  'getUsage',
  'getProviders',
  'preloadModel',
  'setProvider',
  'getCacheStats',
  'clearCache',
  'checkChromeTranslator',
  'checkWebGPU',
  'checkWebNN',
  'getCloudProviderStatus',
  'setCloudApiKey',
  'clearCloudApiKey',
  'setCloudProviderEnabled',
] as const satisfies readonly BackgroundRequestMessageType[];

export type CommonBackgroundMessage = Extract<
  BackgroundRequestMessage,
  { type: (typeof COMMON_BACKGROUND_MESSAGE_TYPES)[number] }
>;

export type CommonBackgroundResponse = ExtensionMessageResponse<CommonBackgroundMessage>;

export function createBackgroundMessageGuard<const TTypes extends readonly BackgroundRequestMessageType[]>(
  handledTypes: TTypes
) {
  return (
    message: ExtensionMessage
  ): message is Extract<BackgroundRequestMessage, { type: TTypes[number] }> =>
    isHandledExtensionMessage(message, handledTypes);
}

export const isCommonBackgroundMessage = createBackgroundMessageGuard(
  COMMON_BACKGROUND_MESSAGE_TYPES
);

interface CommonBackgroundDispatcherDependencies {
  translationCache: TranslationCache;
  getProvider: () => TranslationProviderId;
  handleTranslate: (
    message: Extract<CommonBackgroundMessage, { type: 'translate' }>
  ) => Awaitable<ExtensionMessageResponseByType<'translate'>>;
  handleGetProviders: () => Awaitable<ExtensionMessageResponseByType<'getProviders'>>;
  handlePreloadModel: (
    message: Extract<CommonBackgroundMessage, { type: 'preloadModel' }>
  ) => Awaitable<ExtensionMessageResponseByType<'preloadModel'>>;
  handleClearCache: () => Awaitable<ExtensionMessageResponseByType<'clearCache'>>;
  handleCheckChromeTranslator: () => Awaitable<ExtensionMessageResponseByType<'checkChromeTranslator'>>;
  handleCheckWebGPU: () => Awaitable<ExtensionMessageResponseByType<'checkWebGPU'>>;
  handleCheckWebNN: () => Awaitable<ExtensionMessageResponseByType<'checkWebNN'>>;
}

export function createCommonBackgroundMessageDispatcher({
  translationCache,
  getProvider,
  handleTranslate,
  handleGetProviders,
  handlePreloadModel,
  handleClearCache,
  handleCheckChromeTranslator,
  handleCheckWebGPU,
  handleCheckWebNN,
}: CommonBackgroundDispatcherDependencies) {
  return async (message: CommonBackgroundMessage): Promise<CommonBackgroundResponse> => {
    switch (message.type) {
      case 'ping':
        return { success: true, status: 'ready', provider: getProvider() };
      case 'translate':
        return handleTranslate(message);
      case 'getUsage':
        return handleGetUsage(translationCache);
      case 'getProviders':
        return handleGetProviders();
      case 'preloadModel':
        return handlePreloadModel(message);
      case 'setProvider':
        return handleSetProvider(message);
      case 'getCacheStats':
        return handleGetCacheStats(translationCache);
      case 'clearCache':
        return handleClearCache();
      case 'checkChromeTranslator':
        return handleCheckChromeTranslator();
      case 'checkWebGPU':
        return handleCheckWebGPU();
      case 'checkWebNN':
        return handleCheckWebNN();
      case 'getCloudProviderStatus':
        return handleGetCloudProviderStatus();
      case 'setCloudApiKey':
        return handleSetCloudApiKey(message);
      case 'clearCloudApiKey':
        return handleClearCloudApiKey(message);
      case 'setCloudProviderEnabled':
        return handleSetCloudProviderEnabled(message);
      default:
        return assertNever(message);
    }
  };
}

interface PreloadModelLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

interface CreatePreloadModelHandlerDependencies {
  log: PreloadModelLogger;
  getProvider: () => TranslationProviderId;
  preloadModel: (
    message: PreloadModelMessage,
    provider: TranslationProviderId
  ) => Promise<ExtensionMessageResponseByType<'preloadModel'>>;
  logPrefix?: string;
}

export function createPreloadModelHandler({
  log,
  getProvider,
  preloadModel,
  logPrefix = '',
}: CreatePreloadModelHandlerDependencies) {
  return async (
    message: PreloadModelMessage
  ): Promise<ExtensionMessageResponseByType<'preloadModel'>> => {
    const provider = message.provider || getProvider();
    log.info(`${logPrefix}Preloading ${provider} model: ${message.sourceLang} -> ${message.targetLang}`);

    try {
      return await preloadModel(message, provider);
    } catch (error) {
      log.warn(`${logPrefix}Preload failed:`, error);
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  };
}

interface SafeCapabilityHandlerLogger {
  debug: (message: string, ...args: unknown[]) => void;
}

interface CreateSafeCapabilityHandlerOptions<TResponse> {
  run: () => Promise<TResponse>;
  fallback: TResponse;
  log: SafeCapabilityHandlerLogger;
  debugMessage: string;
}

export function createSafeCapabilityHandler<TResponse>({
  run,
  fallback,
  log,
  debugMessage,
}: CreateSafeCapabilityHandlerOptions<TResponse>) {
  return async (): Promise<TResponse> => {
    try {
      return await run();
    } catch (error) {
      log.debug(debugMessage, error);
      return fallback;
    }
  };
}
