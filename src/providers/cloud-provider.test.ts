import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installCloudProviderTestHarness } from '../__contract__/cloud-provider-test-harness';
import type { CloudProviderStorageRecord } from '../background/shared/provider-config-types';
import type { LanguagePair, TranslationOptions } from '../types';
import { CloudProvider, updateCloudProviderApiKey } from './cloud-provider';

interface TestCloudConfig {
  apiKey: string;
}

class TestCloudProvider extends CloudProvider<TestCloudConfig> {
  private config: TestCloudConfig | null = null;

  constructor() {
    super({
      id: 'test-cloud',
      name: 'Test Cloud',
      type: 'cloud',
      qualityTier: 'standard',
      costPerMillion: 0,
      icon: '',
    });
  }

  protected getStorageKeys(): string[] {
    return ['openai_api_key', 'openai_tokens_used'];
  }

  protected applyStoredConfig(stored: CloudProviderStorageRecord): void {
    const apiKey = typeof stored.openai_api_key === 'string' ? stored.openai_api_key : null;
    if (!apiKey) {
      this.resetConfig();
      return;
    }

    this.applyStoredUsageConfig(
      {
        config: { apiKey },
        tokensUsed: typeof stored.openai_tokens_used === 'number' ? stored.openai_tokens_used : 0,
      },
      'tokensUsed',
    );
  }

  protected resetConfig(): void {
    this.config = null;
    this.resetUsageCounter();
  }

  protected getConfigState(): TestCloudConfig | null {
    return this.config;
  }

  protected setConfigState(config: TestCloudConfig | null): void {
    this.config = config;
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.persistAndUpdateConfig(
      { openai_api_key: apiKey },
      (config) => updateCloudProviderApiKey(config, apiKey, {}),
    );
  }

  recordUsage(delta: number): number {
    return this.trackUsageCounter(
      delta,
      'openai_tokens_used',
      'Failed to persist queued telemetry:',
    );
  }

  async translate(
    text: string | string[],
    _sourceLang: string,
    _targetLang: string,
    _options?: TranslationOptions,
  ): Promise<string | string[]> {
    return text;
  }

  getSupportedLanguages(): LanguagePair[] {
    return [];
  }
}

const { mockStorage, resetCloudProviderState } = installCloudProviderTestHarness();
const waitForAsyncQueue = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CloudProvider best-effort persistence', () => {
  let provider: TestCloudProvider;

  beforeEach(() => {
    resetCloudProviderState();
    provider = new TestCloudProvider();
  });

  it('coalesces overlapping telemetry writes so the latest counter wins', async () => {
    await provider.setApiKey('sk-test');

    vi.mocked(chrome.storage.local.set).mockClear();

    const pendingWrites: Array<{ items: Record<string, unknown>; resolve: () => void }> = [];
    vi.mocked(chrome.storage.local.set).mockImplementation((items: Record<string, unknown>) => {
      if ('openai_tokens_used' in items) {
        return new Promise<void>((resolve) => {
          pendingWrites.push({
            items,
            resolve: () => {
              Object.assign(mockStorage, items);
              resolve();
            },
          });
        });
      }

      Object.assign(mockStorage, items);
      return Promise.resolve();
    });

    expect(provider.recordUsage(5)).toBe(5);
    expect(provider.recordUsage(7)).toBe(12);
    expect(provider.recordUsage(11)).toBe(23);

    expect(pendingWrites).toHaveLength(1);
    expect(pendingWrites[0]?.items).toEqual({ openai_tokens_used: 5 });
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);

    pendingWrites[0]!.resolve();
    await waitForAsyncQueue();

    expect(pendingWrites).toHaveLength(2);
    expect(pendingWrites[1]?.items).toEqual({ openai_tokens_used: 23 });
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);

    pendingWrites[1]!.resolve();
    await provider.flush();

    expect(mockStorage['openai_tokens_used']).toBe(23);
  });

  it('flushes pending telemetry before clearing provider storage', async () => {
    await provider.setApiKey('sk-test');

    vi.mocked(chrome.storage.local.set).mockClear();
    vi.mocked(chrome.storage.local.remove).mockClear();

    let resolveTelemetryWrite: (() => void) | null = null;
    vi.mocked(chrome.storage.local.set).mockImplementation((items: Record<string, unknown>) => {
      if ('openai_tokens_used' in items) {
        return new Promise<void>((resolve) => {
          resolveTelemetryWrite = () => {
            Object.assign(mockStorage, items);
            resolve();
          };
        });
      }

      Object.assign(mockStorage, items);
      return Promise.resolve();
    });

    provider.recordUsage(9);
    const clearPromise = provider.clearApiKey();

    await waitForAsyncQueue();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();

    expect(resolveTelemetryWrite).not.toBeNull();
    resolveTelemetryWrite!();
    await clearPromise;

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([
      'openai_api_key',
      'openai_tokens_used',
    ]);
    expect(mockStorage['openai_api_key']).toBeUndefined();
    expect(mockStorage['openai_tokens_used']).toBeUndefined();
  });
});
