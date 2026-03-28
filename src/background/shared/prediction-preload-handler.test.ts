import { describe, expect, it, vi } from 'vitest';

import {
  createPredictionPreloadHandler,
  isPredictivePreloadUrl,
} from './prediction-preload-handler';

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe('prediction-preload-handler', () => {
  it('accepts only http(s) URLs for predictive preload', () => {
    expect(isPredictivePreloadUrl('https://example.com')).toBe(true);
    expect(isPredictivePreloadUrl('http://example.com')).toBe(true);
    expect(isPredictivePreloadUrl('chrome://extensions')).toBe(false);
    expect(isPredictivePreloadUrl('chrome-extension://abc/index.html')).toBe(false);
    expect(isPredictivePreloadUrl('file:///tmp/test.html')).toBe(false);
    expect(isPredictivePreloadUrl('not-a-url')).toBe(false);
  });

  it('skips unsupported URLs before consulting the prediction engine', async () => {
    const predictionEngine = {
      hasRecentActivity: vi.fn(),
      predict: vi.fn(),
    };

    const { preloadPredictedModels } = createPredictionPreloadHandler({
      log: createLogger(),
      predictionEngine,
      getProvider: () => 'opus-mt',
      preloadModel: vi.fn(),
      maxPreloaded: 3,
    });

    await preloadPredictedModels('chrome://extensions');
    await preloadPredictedModels('chrome-extension://test-id/src/offscreen/offscreen.html');

    expect(predictionEngine.hasRecentActivity).not.toHaveBeenCalled();
    expect(predictionEngine.predict).not.toHaveBeenCalled();
  });

  it('skips low-confidence predictions and preloads supported ones', async () => {
    const log = createLogger();
    const preloadModel = vi.fn().mockResolvedValue({ success: true, preloaded: true });
    const predictionEngine = {
      hasRecentActivity: vi.fn().mockResolvedValue(true),
      predict: vi.fn().mockResolvedValue([
        { sourceLang: 'en', targetLang: 'fr', confidence: 0.2 },
        { sourceLang: 'en', targetLang: 'fi', confidence: 0.9 },
      ]),
    };

    const { preloadPredictedModels, preloadedModels } = createPredictionPreloadHandler({
      log,
      predictionEngine,
      getProvider: () => 'opus-mt',
      preloadModel,
      maxPreloaded: 3,
    });

    await preloadPredictedModels('https://example.com/news');
    await Promise.resolve();

    expect(preloadModel).toHaveBeenCalledTimes(1);
    expect(preloadModel).toHaveBeenCalledWith({
      type: 'preloadModel',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      priority: 'low',
    });
    expect(preloadedModels.has('en-fi')).toBe(true);
    expect(log.debug).toHaveBeenCalledWith('Skipping low confidence prediction: en-fr (0.20)');
  });

  it('clears tracked models when the preload cache reaches its limit', async () => {
    const preloadModel = vi.fn().mockResolvedValue({ success: true, preloaded: true });
    const predictionEngine = {
      hasRecentActivity: vi.fn().mockResolvedValue(true),
      predict: vi.fn().mockResolvedValue([
        { sourceLang: 'en', targetLang: 'de', confidence: 0.9 },
      ]),
    };
    const preloadedModels = new Set(['en-fi']);

    const { preloadPredictedModels } = createPredictionPreloadHandler({
      log: createLogger(),
      predictionEngine,
      getProvider: () => 'opus-mt',
      preloadModel,
      maxPreloaded: 1,
      preloadedModels,
    });

    await preloadPredictedModels('https://example.com/limit');
    await Promise.resolve();

    expect([...preloadedModels]).toEqual(['en-de']);
  });

  it('routes supported tab updates through the predictive preload trigger', async () => {
    const predictionEngine = {
      hasRecentActivity: vi.fn().mockResolvedValue(true),
      predict: vi.fn().mockResolvedValue([]),
    };

    const { handleTabUpdated } = createPredictionPreloadHandler({
      log: createLogger(),
      predictionEngine,
      getProvider: () => 'opus-mt',
      preloadModel: vi.fn(),
      maxPreloaded: 3,
    });

    handleTabUpdated(1, { status: 'complete' }, { url: 'chrome://extensions' } as chrome.tabs.Tab);
    handleTabUpdated(1, { status: 'complete' }, { url: 'https://example.com' } as chrome.tabs.Tab);
    await Promise.resolve();

    expect(predictionEngine.hasRecentActivity).toHaveBeenCalledTimes(1);
    expect(predictionEngine.predict).toHaveBeenCalledWith('https://example.com');
  });
});
