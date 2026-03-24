import type { Page } from '@playwright/test';

export const MOCK_HARNESS_URL = 'http://127.0.0.1:8080/e2e/mock.html';
export const MOCK_HARNESS_FRAGMENT = '/e2e/mock.html';

export interface MockTranslateRequest {
  provider: string;
  source: string;
  target: string;
  text: string;
  force?: boolean;
  providerOrder?: string[];
  stream?: boolean;
}

export interface MockBatchTranslateRequest {
  provider: string;
  source: string;
  target: string;
  texts: string[];
  force?: boolean;
}

export interface MockConfig {
  providerOrder: string[];
  debug: boolean;
  [key: string]: unknown;
}

type MockProviderLog = {
  logMessage?: string;
};

export type MockProviderScenario =
  | ({
      id: string;
      type: 'suffix';
      suffix: string;
    } & MockProviderLog)
  | ({
      id: string;
      type: 'error';
      message: string;
      retryable?: boolean;
    } & MockProviderLog)
  | ({
      id: string;
      type: 'quota';
      suffix: string;
      failAfter: number;
      message: string;
      retryable?: boolean;
    } & MockProviderLog)
  | ({
      id: string;
      type: 'flaky';
      suffix: string;
      failCount: number;
      message: string;
      retryable?: boolean;
    } & MockProviderLog)
  | ({
      id: string;
      type: 'stream';
      chunks: string[];
      resultText: string;
      delayMs?: number;
    } & MockProviderLog);

export async function gotoMockHarness(page: Page): Promise<void> {
  await page.goto(MOCK_HARNESS_URL);
  await page.waitForLoadState('domcontentloaded');
}

export async function installNoopCache(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.qwenCache = {
      cacheReady: Promise.resolve(),
      getCache: () => null,
      setCache: () => {},
      removeCache: () => {},
      qwenClearCache: () => {},
      qwenGetCacheSize: () => 0,
      qwenSetCacheLimit: () => {},
      qwenSetCacheTTL: () => {},
    };
    window.qwenClearCache = window.qwenCache.qwenClearCache;
  });
}

export async function installLocalStorageCache(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.qwenCache = {
      cacheReady: Promise.resolve(),
      getCache: (key: string) => {
        const raw = localStorage.getItem(`cache:${key}`);
        return raw ? JSON.parse(raw) : null;
      },
      setCache: (key: string, value: unknown) => {
        localStorage.setItem(`cache:${key}`, JSON.stringify(value));
      },
      removeCache: (key: string) => {
        localStorage.removeItem(`cache:${key}`);
      },
      qwenClearCache: () => {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('cache:'))
          .forEach((key) => localStorage.removeItem(key));
      },
      qwenGetCacheSize: () => Object.keys(localStorage).filter((key) => key.startsWith('cache:')).length,
      qwenSetCacheLimit: () => {},
      qwenSetCacheTTL: () => {},
    };
    window.qwenClearCache = window.qwenCache.qwenClearCache;
  });
}

export async function installLocalStorageConfig(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.qwenLoadConfig = async () => {
      const raw = localStorage.getItem('cfg');
      return raw ? JSON.parse(raw) : { providerOrder: [], debug: false };
    };
    window.qwenSaveConfig = async (config: unknown) => {
      localStorage.setItem('cfg', JSON.stringify(config));
    };
  });
}

export async function installDirectTranslate(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.qwenTranslate = async (options: { provider: string; text: string; source: string; target: string }) => {
      const provider = window.qwenProviders.getProvider(options.provider);
      return provider.translate(options);
    };
    window.qwenTranslateBatch = async ({
      texts = [],
      provider,
      source,
      target,
    }: {
      texts?: string[];
      provider: string;
      source: string;
      target: string;
    }) => {
      const runtimeProvider = window.qwenProviders.getProvider(provider);
      const results = await Promise.all(
        texts.map((text) => runtimeProvider.translate({ text, source, target, provider })),
      );
      return { texts: results.map((result: { text: string }) => result.text) };
    };
  });
}

export async function installCachedBatchTranslate(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.qwenTranslate = async (options: { provider: string; text: string; source: string; target: string }) => {
      const provider = window.qwenProviders.getProvider(options.provider);
      return provider.translate(options);
    };
    window.qwenTranslateBatch = async ({
      texts = [],
      provider,
      source,
      target,
      force,
    }: {
      texts?: string[];
      provider: string;
      source: string;
      target: string;
      force?: boolean;
    }) => {
      const runtimeProvider = window.qwenProviders.getProvider(provider);
      const translatedTexts: string[] = [];
      for (const text of texts) {
        const cacheKey = `${provider}:${source}:${target}:${text}`;
        const cached = !force && window.qwenCache.getCache(cacheKey);
        if (cached) {
          translatedTexts.push(cached.text);
          continue;
        }

        const result = await runtimeProvider.translate({ text, source, target, provider });
        window.qwenCache.setCache(cacheKey, { text: result.text });
        translatedTexts.push(result.text);
      }

      return { texts: translatedTexts };
    };
  });
}

export async function registerMockProviders(
  page: Page,
  scenarios: readonly MockProviderScenario[],
): Promise<void> {
  await page.evaluate((definitions) => {
    const createError = (message: string, retryable = false) => {
      const error = new Error(message) as Error & { retryable?: boolean };
      error.retryable = retryable;
      return error;
    };

    for (const scenario of definitions) {
      let callCount = 0;
      window.qwenProviders.registerProvider(scenario.id, {
        async translate(options: {
          text?: string;
          onData?: (chunk: string) => void;
          signal?: AbortSignal;
        }) {
          callCount += 1;

          if ('logMessage' in scenario && scenario.logMessage) {
            console.log(scenario.logMessage);
          }

          const inputText = options.text ?? '';
          switch (scenario.type) {
            case 'suffix':
              return { text: `${inputText}${scenario.suffix}` };
            case 'error':
              throw createError(scenario.message, scenario.retryable ?? false);
            case 'quota':
              if (callCount > scenario.failAfter) {
                throw createError(scenario.message, scenario.retryable ?? false);
              }
              return { text: `${inputText}${scenario.suffix}` };
            case 'flaky':
              if (callCount <= scenario.failCount) {
                throw createError(scenario.message, scenario.retryable ?? false);
              }
              return { text: `${inputText}${scenario.suffix}` };
            case 'stream':
              for (const chunk of scenario.chunks) {
                if (options.signal?.aborted) {
                  throw new DOMException('Aborted', 'AbortError');
                }
                await new Promise((resolve) => setTimeout(resolve, scenario.delayMs ?? 100));
                if (options.signal?.aborted) {
                  throw new DOMException('Aborted', 'AbortError');
                }
                options.onData?.(chunk);
              }
              return { text: scenario.resultText };
          }
        },
      });
    }
  }, scenarios);
}

export async function translate(
  page: Page,
  request: MockTranslateRequest,
): Promise<{ text: string }> {
  return page.evaluate((options) => window.qwenTranslate(options), request);
}

export async function translateBatch(
  page: Page,
  request: MockBatchTranslateRequest,
): Promise<{ texts: string[] }> {
  return page.evaluate((options) => window.qwenTranslateBatch(options), request);
}

export async function translateBatchAndCaptureProviderCalls(
  page: Page,
  providerId: string,
  request: MockBatchTranslateRequest,
): Promise<{ texts: string[]; calls: number }> {
  return page.evaluate(async ({ activeProviderId, batchRequest }) => {
    const provider = window.qwenProviders.getProvider(activeProviderId);
    const originalTranslate = provider.translate;
    let calls = 0;

    provider.translate = async (options: unknown) => {
      calls += 1;
      return originalTranslate.call(provider, options);
    };

    try {
      const response = await window.qwenTranslateBatch(batchRequest);
      return { texts: response.texts, calls };
    } finally {
      provider.translate = originalTranslate;
    }
  }, { activeProviderId: providerId, batchRequest: request });
}

export async function clearMockCache(page: Page): Promise<void> {
  await page.evaluate(() => window.qwenClearCache());
}

export async function loadMockConfig(page: Page): Promise<MockConfig> {
  return page.evaluate(() => window.qwenLoadConfig());
}

export async function saveMockConfig(page: Page, config: MockConfig): Promise<void> {
  await page.evaluate((nextConfig) => window.qwenSaveConfig(nextConfig), config);
}

export async function runStreamingTranslationWithAbort(
  page: Page,
  request: MockTranslateRequest,
  abortAfterMs: number,
): Promise<{ error: string | null; chunks: string[] }> {
  return page.evaluate(
    ({ options, abortDelayMs }) =>
      new Promise<{ error: string | null; chunks: string[] }>((resolve) => {
        const controller = new AbortController();
        const chunks: string[] = [];

        window.qwenTranslateStream(
          { ...options, signal: controller.signal },
          (chunk: string) => chunks.push(chunk),
        ).then(
          () => resolve({ error: null, chunks }),
          (error: Error) => resolve({ error: error.name, chunks }),
        );

        setTimeout(() => controller.abort(), abortDelayMs);
      }),
    { options: request, abortDelayMs: abortAfterMs },
  );
}
