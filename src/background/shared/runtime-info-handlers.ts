import { extractErrorMessage } from '../../core/errors';
import type { AggregateStats } from '../../core/profiler';
import type {
  ExtensionMessageResponseByType,
  ProvidersMessagePayload,
  Strategy,
  TranslationProviderId,
} from '../../types';
import { createSafeCapabilityHandler } from './common-background';
import type { OffscreenTransport } from './offscreen-transport';

export interface RuntimeInfoLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface RuntimeInfoProfiler {
  clear: () => void;
  formatAggregates: () => string;
  getAllAggregates: () => Record<string, AggregateStats>;
}

export interface RuntimeInfoHandlers {
  handleGetProfilingStats: () => Promise<
    ExtensionMessageResponseByType<'getProfilingStats'>
  >;
  handleClearProfilingStats: () => ExtensionMessageResponseByType<'clearProfilingStats'>;
  handleGetProviders: () => Promise<
    ExtensionMessageResponseByType<'getProviders'>
  >;
  handleCheckChromeTranslator: () => Promise<
    ExtensionMessageResponseByType<'checkChromeTranslator'>
  >;
  handleCheckWebGPU: () => Promise<
    ExtensionMessageResponseByType<'checkWebGPU'>
  >;
  handleCheckWebNN: () => Promise<ExtensionMessageResponseByType<'checkWebNN'>>;
}

export interface CreateRuntimeInfoHandlersOptions {
  getProvider: () => TranslationProviderId;
  getStrategy: () => Strategy;
  providerList: ProvidersMessagePayload['providers'];
  offscreenTransport: Pick<OffscreenTransport, 'send'>;
  profiler: RuntimeInfoProfiler;
  log: RuntimeInfoLogger;
  getActiveTabId: () => Promise<number | undefined>;
  probeChromeTranslator: (
    tabId: number,
  ) => Promise<ExtensionMessageResponseByType<'checkChromeTranslator'>>;
}

function createProviderSnapshot({
  providerList,
  getProvider,
  getStrategy,
}: Pick<
  CreateRuntimeInfoHandlersOptions,
  'providerList' | 'getProvider' | 'getStrategy'
>): Omit<ProvidersMessagePayload, 'supportedLanguages' | 'error'> {
  return {
    providers: [...providerList],
    activeProvider: getProvider(),
    strategy: getStrategy(),
  };
}

export function createRuntimeInfoHandlers({
  getProvider,
  getStrategy,
  providerList,
  offscreenTransport,
  profiler,
  log,
  getActiveTabId,
  probeChromeTranslator,
}: CreateRuntimeInfoHandlersOptions): RuntimeInfoHandlers {
  async function handleGetProfilingStats(): Promise<
    ExtensionMessageResponseByType<'getProfilingStats'>
  > {
    try {
      const localStats = profiler.getAllAggregates();

      let offscreenStats: Record<string, AggregateStats> = {};
      try {
        const offscreenResult =
          await offscreenTransport.send<'getProfilingStats'>({
            type: 'getProfilingStats',
          });
        if (offscreenResult.success) {
          offscreenStats = offscreenResult.aggregates;
        }
      } catch {
        log.debug('Offscreen not available for profiling stats merge');
      }

      return {
        success: true,
        aggregates: { ...localStats, ...offscreenStats },
        formatted: profiler.formatAggregates(),
      };
    } catch (error) {
      log.warn('Failed to get profiling stats:', error);
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  function handleClearProfilingStats(): ExtensionMessageResponseByType<'clearProfilingStats'> {
    profiler.clear();
    log.info('Profiling stats cleared');
    return { success: true };
  }

  async function handleGetProviders(): Promise<
    ExtensionMessageResponseByType<'getProviders'>
  > {
    const providerSnapshot = createProviderSnapshot({
      providerList,
      getProvider,
      getStrategy,
    });

    try {
      const response = await offscreenTransport.send<'getSupportedLanguages'>({
        type: 'getSupportedLanguages',
      });

      return {
        ...providerSnapshot,
        supportedLanguages: response.success ? (response.languages ?? []) : [],
      };
    } catch (error) {
      /* v8 ignore start -- defensive fallback when offscreen language fetch fails */
      log.warn('Error getting providers:', error);

      return {
        ...providerSnapshot,
        supportedLanguages: [],
        error: 'Could not load language list. Translation may still work.',
      };
      /* v8 ignore stop */
    }
  }

  const handleCheckChromeTranslator = createSafeCapabilityHandler({
    log,
    debugMessage: 'Chrome Translator check failed (restricted page?):',
    fallback: { success: true, available: false } as const,
    run: async () => {
      const tabId = await getActiveTabId();
      if (!tabId) {
        return { success: true, available: false } as const;
      }

      return probeChromeTranslator(tabId);
    },
  });

  const handleCheckWebGPU = createSafeCapabilityHandler({
    log,
    debugMessage: 'WebGPU check failed:',
    fallback: { success: true, supported: false, fp16: false } as const,
    run: async () => {
      const response = await offscreenTransport.send<'checkWebGPU'>({
        type: 'checkWebGPU',
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response;
    },
  });

  const handleCheckWebNN = createSafeCapabilityHandler({
    log,
    debugMessage: 'WebNN check failed:',
    fallback: { success: true, supported: false } as const,
    run: async () => {
      const response = await offscreenTransport.send<'checkWebNN'>({
        type: 'checkWebNN',
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response;
    },
  });

  return {
    handleGetProfilingStats,
    handleClearProfilingStats,
    handleGetProviders,
    handleCheckChromeTranslator,
    handleCheckWebGPU,
    handleCheckWebNN,
  };
}
