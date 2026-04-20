import type { TranslationProviderId } from '../../types';

export interface PredictivePreloadLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface PredictionCandidate {
  sourceLang: string;
  targetLang: string;
  confidence: number;
}

export interface PredictionPreloadEngine {
  hasRecentActivity: () => Promise<boolean>;
  predict: (url: string) => Promise<PredictionCandidate[]>;
}

export interface PredictionPreloadResponse {
  success: boolean;
  preloaded?: boolean;
}

export interface CreatePredictionPreloadHandlerOptions {
  log: PredictivePreloadLogger;
  predictionEngine: PredictionPreloadEngine;
  getProvider: () => TranslationProviderId;
  preloadModel: (args: {
    type: 'preloadModel';
    sourceLang: string;
    targetLang: string;
    provider: TranslationProviderId;
    priority: 'low';
  }) => Promise<PredictionPreloadResponse>;
  maxPreloaded: number;
  minimumConfidence?: number;
  preloadedModels?: Set<string>;
}

export function isPredictivePreloadUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function createPredictionPreloadHandler({
  log,
  predictionEngine,
  getProvider,
  preloadModel,
  maxPreloaded,
  minimumConfidence = 0.3,
  preloadedModels = new Set<string>(),
}: CreatePredictionPreloadHandlerOptions) {
  async function preloadPredictedModels(url: string): Promise<void> {
    if (!isPredictivePreloadUrl(url)) {
      log.debug(`Skipping predictive preload for unsupported URL: ${url}`);
      return;
    }

    try {
      const hasActivity = await predictionEngine.hasRecentActivity();
      if (!hasActivity) {
        log.debug('No recent activity, skipping predictive preload');
        return;
      }

      const predictions = await predictionEngine.predict(url);
      if (predictions.length === 0) {
        return;
      }

      log.info(`Predictive preload: ${predictions.length} candidates for ${url}`);

      for (const prediction of predictions) {
        const key = `${prediction.sourceLang}-${prediction.targetLang}`;

        /* v8 ignore start -- preloaded check branch */
        if (preloadedModels.has(key)) {
          log.debug(`Model ${key} already preloaded`);
          continue;
        }
        /* v8 ignore stop */

        if (prediction.confidence < minimumConfidence) {
          log.debug(`Skipping low confidence prediction: ${key} (${prediction.confidence.toFixed(2)})`);
          continue;
        }

        if (preloadedModels.size >= maxPreloaded) {
          preloadedModels.clear();
        }

        log.info(`Preloading predicted model: ${key} (confidence: ${prediction.confidence.toFixed(2)})`);

        preloadModel({
          type: 'preloadModel',
          sourceLang: prediction.sourceLang,
          targetLang: prediction.targetLang,
          provider: getProvider(),
          priority: 'low',
        })
          .then((response) => {
            if (response.success && response.preloaded) {
              preloadedModels.add(key);
              log.info(`Predictive preload complete: ${key}`);
            }
          })
          /* v8 ignore start */
          .catch((error) => {
            log.warn(`Predictive preload failed for ${key}:`, error);
          });
        /* v8 ignore stop */
      }
    } catch (error) {
      log.warn('Predictive preload error:', error);
    }
  }

  const handleTabUpdated = (
    _tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ): void => {
    if (changeInfo.status !== 'complete' || !tab.url) {
      return;
    }

    log.debug(`Tab updated: ${tab.url}`);

    /* v8 ignore start */
    preloadPredictedModels(tab.url).catch((error) => {
      log.warn('Predictive preload trigger failed:', error);
    });
    /* v8 ignore stop */
  };

  return {
    preloadPredictedModels,
    handleTabUpdated,
    preloadedModels,
  };
}
