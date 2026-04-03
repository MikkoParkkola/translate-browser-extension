/**
 * Abstract base class for all cloud translation providers.
 *
 * Extracts the three lifecycle methods that are structurally identical
 * across every cloud provider: initialize(), isAvailable(), and clearApiKey().
 *
 * Subclasses implement the storage/config hooks:
 *   - getStorageKeys()  – keys to load/clear from storage
 *   - applyStoredConfig() – populate internal config from loaded values
 *   - resetConfig()     – clear provider-specific in-memory state
 *   - getConfigState()  – read the current config state
 *   - setConfigState()  – replace the current config state
 */

import { BaseProvider } from './base-provider';
import {
  strictStorageGet,
  strictStorageRemove,
  strictStorageSet,
} from '../core/storage';
import { createTranslationError } from '../core/errors';
import { createLogger } from '../core/logger';
import type { ProviderConfig } from '../types';
import type {
  CloudProviderStorageKey,
  CloudProviderStorageMutation,
  CloudProviderStorageRecord,
} from '../background/shared/provider-config-types';

type ApiKeyConfig<TDefaults extends object> = { apiKey: string } & TDefaults;
type UsageTrackedRuntimeState<TConfig extends { apiKey: string }, TUsageField extends string> = {
  config: TConfig;
} & Record<TUsageField, number>;

export function createCloudProviderConfig<TDefaults extends object>(
  apiKey: string,
  defaults: TDefaults
): ApiKeyConfig<TDefaults> {
  return { apiKey, ...defaults };
}

export function updateCloudProviderApiKey<TDefaults extends object>(
  current: ApiKeyConfig<TDefaults> | null,
  apiKey: string,
  defaults: TDefaults
): ApiKeyConfig<TDefaults> {
  return current ? { ...current, apiKey } : createCloudProviderConfig(apiKey, defaults);
}

export abstract class CloudProvider<TConfig extends { apiKey: string }> extends BaseProvider {
  protected readonly log = createLogger(this.name);
  private usageCounter = 0;

  /**
   * Storage keys this provider reads during initialize() and removes during clearApiKey().
   * Should include the API key and all related settings.
   */
  protected abstract getStorageKeys(): string[];

  /**
   * Populate this provider's internal config from the values loaded from storage.
   * Called with a partial record — check for key presence before using values.
   */
  protected abstract applyStoredConfig(stored: CloudProviderStorageRecord): void;

  /**
   * Hook called after clearApiKey() removes keys from storage.
   * Subclasses reset their internal config state here.
   */
  protected abstract resetConfig(): void;

  /**
   * Read the current in-memory config state.
   */
  protected abstract getConfigState(): TConfig | null;

  /**
   * Replace the current in-memory config state.
   */
  protected abstract setConfigState(config: TConfig | null): void;

  /**
   * Read the current config only when it includes a usable API key.
   */
  protected getConfiguredConfig(): TConfig | null {
    const config = this.getConfigState();
    return config?.apiKey ? config : null;
  }

  /**
   * Require credentials for request paths that cannot proceed without them.
   */
  protected requireConfiguredConfig(providerLabel: string): TConfig {
    const config = this.getConfiguredConfig();
    if (!config) {
      throw createTranslationError(new Error(`${providerLabel} API key not configured`));
    }
    return config;
  }

  /**
   * Return true if the provider has a valid configuration (API key loaded).
   */
  protected hasConfig(): boolean {
    return this.getConfiguredConfig() !== null;
  }

  async initialize(): Promise<void> {
    try {
      const stored = await strictStorageGet<CloudProviderStorageRecord>(this.getStorageKeys());
      this.applyStoredConfig(stored);
    } catch (error) {
      this.resetConfig();
      this.log.error('Failed to load config from storage:', error);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.hasConfig()) {
      await this.initialize();
    }
    return this.hasConfig();
  }

  async clearApiKey(): Promise<void> {
    await strictStorageRemove(this.getStorageKeys());
    this.resetConfig();
  }

  /**
   * Persist one or more config values to storage.
   * Thin wrapper so subclasses don't need to import safeStorageSet directly.
   */
  protected persist(items: CloudProviderStorageMutation): Promise<void> {
    return strictStorageSet(items);
  }

  /**
   * Persist storage updates, then refresh in-memory config using the current local state.
   */
  protected async persistAndUpdateConfig(
    items: CloudProviderStorageMutation,
    update: (config: TConfig | null) => TConfig | null
  ): Promise<void> {
    await this.persist(items);
    this.setConfigState(update(this.getConfigState()));
  }

  /**
   * Persist settings even before the provider is configured, but only mutate in-memory state when
   * a config is already loaded.
   */
  protected async persistAndUpdateLoadedConfig(
    items: CloudProviderStorageMutation,
    update: (config: TConfig) => TConfig
  ): Promise<void> {
    await this.persistAndUpdateConfig(items, (config) => (config ? update(config) : null));
  }

  /**
   * Best-effort persistence for counters/telemetry that must not fail the request path.
   */
  protected persistBestEffort(items: CloudProviderStorageMutation, failureMessage: string): void {
    /* v8 ignore start -- fire-and-forget persist */
    void this.persist(items).catch((error) => this.log.warn(failureMessage, error));
    /* v8 ignore stop */
  }

  /**
   * Hydrate provider config plus a persisted usage counter from validated runtime state.
   */
  protected applyStoredUsageConfig<TUsageField extends string>(
    runtimeState: UsageTrackedRuntimeState<TConfig, TUsageField> | null,
    usageField: TUsageField,
  ): TConfig | null {
    if (!runtimeState) {
      this.resetConfig();
      return null;
    }

    this.setConfigState(runtimeState.config);
    this.usageCounter = runtimeState[usageField];

    return runtimeState.config;
  }

  /**
   * Reset the in-memory usage counter for providers that track persisted telemetry.
   */
  protected resetUsageCounter(): void {
    this.usageCounter = 0;
  }

  /**
   * Read the current in-memory usage counter.
   */
  protected getUsageCounter(): number {
    return this.usageCounter;
  }

  /**
   * Increment the usage counter and persist it best-effort without affecting the request path.
   */
  protected trackUsageCounter(
    delta: number,
    storageKey: CloudProviderStorageKey,
    failureMessage: string,
  ): number {
    this.usageCounter += delta;
    this.persistBestEffort(
      { [storageKey]: this.usageCounter } as CloudProviderStorageMutation,
      failureMessage,
    );
    return this.usageCounter;
  }

  /**
   * Build the shared usage response shape for providers with a single persisted counter.
   */
  protected buildTrackedUsage(cost: number): {
    requests: number;
    tokens: number;
    cost: number;
    limitReached: boolean;
  } {
    return {
      requests: 0,
      tokens: this.usageCounter,
      cost,
      limitReached: false,
    };
  }

  getInfo(): ProviderConfig {
    return super.getInfo();
  }
}

export default CloudProvider;
