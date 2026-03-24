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

interface MockTranslateResult {
  text: string;
}

interface MockHarnessProviderRequest {
  text?: string;
  source?: string;
  target?: string;
  provider?: string;
  onData?: (chunk: string) => void;
  signal?: AbortSignal;
  stream?: boolean;
}

interface MockHarnessProvider {
  translate(options: MockHarnessProviderRequest): Promise<MockTranslateResult>;
}

interface MockHarnessProviderRegistry {
  register(providerId: string, provider: MockHarnessProvider): void;
  get(providerId: string): MockHarnessProvider;
  list(): string[];
  reset(): void;
}

interface MockHarnessCacheValue {
  text: string;
}

interface MockHarnessCache {
  cacheReady: Promise<void>;
  get(key: string): MockHarnessCacheValue | null;
  set(key: string, value: MockHarnessCacheValue): void;
  remove(key: string): void;
  clear(): void;
  size(): number;
  setLimit(limit?: number): void;
  setTTL(ttl?: number): void;
}

interface MockHarnessRuntime {
  providers: MockHarnessProviderRegistry;
  cache: MockHarnessCache;
  clearCache(): void;
  loadConfig(): Promise<MockConfig>;
  saveConfig(config: unknown): Promise<void>;
  translate(request: MockTranslateRequest): Promise<MockTranslateResult>;
  translateBatch(request: MockBatchTranslateRequest): Promise<{ texts: string[] }>;
  translateStream(
    request: MockTranslateRequest & { signal?: AbortSignal },
    onChunk: (chunk: string) => void,
  ): Promise<MockTranslateResult>;
}

type MockHarnessWindow = Window &
  typeof globalThis & {
    mockHarness: MockHarnessRuntime;
  };

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
    const mockWindow = window as MockHarnessWindow;
    mockWindow.mockHarness.cache = {
      cacheReady: Promise.resolve(),
      get: () => null,
      set: () => {},
      remove: () => {},
      clear: () => {},
      size: () => 0,
      setLimit: () => {},
      setTTL: () => {},
    };
    mockWindow.mockHarness.clearCache = () => mockWindow.mockHarness.cache.clear();
  });
}

export async function installLocalStorageCache(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mockWindow = window as MockHarnessWindow;
    mockWindow.mockHarness.cache = {
      cacheReady: Promise.resolve(),
      get: (key: string) => {
        const raw = localStorage.getItem(`cache:${key}`);
        return raw ? JSON.parse(raw) : null;
      },
      set: (key: string, value: unknown) => {
        localStorage.setItem(`cache:${key}`, JSON.stringify(value));
      },
      remove: (key: string) => {
        localStorage.removeItem(`cache:${key}`);
      },
      clear: () => {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('cache:'))
          .forEach((key) => localStorage.removeItem(key));
      },
      size: () => Object.keys(localStorage).filter((key) => key.startsWith('cache:')).length,
      setLimit: () => {},
      setTTL: () => {},
    };
    mockWindow.mockHarness.clearCache = () => mockWindow.mockHarness.cache.clear();
  });
}

export async function installLocalStorageConfig(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mockWindow = window as MockHarnessWindow;
    mockWindow.mockHarness.loadConfig = async () => {
      const raw = localStorage.getItem('cfg');
      return raw ? JSON.parse(raw) : { providerOrder: [], debug: false };
    };
    mockWindow.mockHarness.saveConfig = async (config: unknown) => {
      localStorage.setItem('cfg', JSON.stringify(config));
    };
  });
}

export async function installDirectTranslate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mockWindow = window as MockHarnessWindow;
    mockWindow.mockHarness.translate = async (options: {
      provider: string;
      text: string;
      source: string;
      target: string;
    }) => {
      const provider = mockWindow.mockHarness.providers.get(options.provider);
      return provider.translate(options);
    };
    mockWindow.mockHarness.translateBatch = async ({
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
      const runtimeProvider = mockWindow.mockHarness.providers.get(provider);
      const results = await Promise.all(texts.map((text) => runtimeProvider.translate({ text, source, target, provider })));
      return { texts: results.map((result) => result.text) };
    };
  });
}

export async function installCachedBatchTranslate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mockWindow = window as MockHarnessWindow;
    mockWindow.mockHarness.translate = async (options: {
      provider: string;
      text: string;
      source: string;
      target: string;
    }) => {
      const provider = mockWindow.mockHarness.providers.get(options.provider);
      return provider.translate(options);
    };
    mockWindow.mockHarness.translateBatch = async ({
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
      const runtimeProvider = mockWindow.mockHarness.providers.get(provider);
      const translatedTexts: string[] = [];
      for (const text of texts) {
        const cacheKey = `${provider}:${source}:${target}:${text}`;
        const cached = !force && mockWindow.mockHarness.cache.get(cacheKey);
        if (cached) {
          translatedTexts.push(cached.text);
          continue;
        }

        const result = await runtimeProvider.translate({ text, source, target, provider });
        mockWindow.mockHarness.cache.set(cacheKey, { text: result.text });
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
    const mockWindow = window as MockHarnessWindow;
    const createError = (message: string, retryable = false) => {
      const error = new Error(message) as Error & { retryable?: boolean };
      error.retryable = retryable;
      return error;
    };

    for (const scenario of definitions) {
      let callCount = 0;
      mockWindow.mockHarness.providers.register(scenario.id, {
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
): Promise<MockTranslateResult> {
  return page.evaluate((options) => {
    const mockWindow = window as MockHarnessWindow;
    return mockWindow.mockHarness.translate(options);
  }, request);
}

export async function translateBatch(
  page: Page,
  request: MockBatchTranslateRequest,
): Promise<{ texts: string[] }> {
  return page.evaluate((options) => {
    const mockWindow = window as MockHarnessWindow;
    return mockWindow.mockHarness.translateBatch(options);
  }, request);
}

export async function translateBatchAndCaptureProviderCalls(
  page: Page,
  providerId: string,
  request: MockBatchTranslateRequest,
): Promise<{ texts: string[]; calls: number }> {
  return page.evaluate(async ({ activeProviderId, batchRequest }) => {
    const mockWindow = window as MockHarnessWindow;
    const provider = mockWindow.mockHarness.providers.get(activeProviderId);
    const originalTranslate = provider.translate;
    let calls = 0;

    provider.translate = async (options: unknown) => {
      calls += 1;
      return originalTranslate.call(provider, options);
    };

    try {
      const response = await mockWindow.mockHarness.translateBatch(batchRequest);
      return { texts: response.texts, calls };
    } finally {
      provider.translate = originalTranslate;
    }
  }, { activeProviderId: providerId, batchRequest: request });
}

export async function clearMockCache(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mockWindow = window as MockHarnessWindow;
    mockWindow.mockHarness.clearCache();
  });
}

export async function loadMockConfig(page: Page): Promise<MockConfig> {
  return page.evaluate(() => {
    const mockWindow = window as MockHarnessWindow;
    return mockWindow.mockHarness.loadConfig();
  });
}

export async function saveMockConfig(page: Page, config: MockConfig): Promise<void> {
  await page.evaluate((nextConfig) => {
    const mockWindow = window as MockHarnessWindow;
    return mockWindow.mockHarness.saveConfig(nextConfig);
  }, config);
}

export async function runStreamingTranslationWithAbort(
  page: Page,
  request: MockTranslateRequest,
  abortAfterMs: number,
): Promise<{ error: string | null; chunks: string[] }> {
  return page.evaluate(
    ({ options, abortDelayMs }) =>
      new Promise<{ error: string | null; chunks: string[] }>((resolve) => {
        const mockWindow = window as MockHarnessWindow;
        const controller = new AbortController();
        const chunks: string[] = [];

        mockWindow.mockHarness.translateStream(
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
