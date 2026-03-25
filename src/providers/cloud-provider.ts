/**
 * Abstract base class for all cloud translation providers.
 *
 * Extracts the three lifecycle methods that are structurally identical
 * across every cloud provider: initialize(), isAvailable(), and clearApiKey().
 *
 * Subclasses implement three hooks:
 *   - getStorageKeys()  – keys to load/clear from storage
 *   - applyStoredConfig() – populate internal config from loaded values
 *   - hasConfig()       – whether the provider is currently configured
 */

import { BaseProvider } from './base-provider';
import {
  strictStorageGet,
  strictStorageRemove,
  strictStorageSet,
} from '../core/storage';
import { createLogger } from '../core/logger';
import type { ProviderConfig } from '../types';
import type {
  CloudProviderStorageMutation,
  CloudProviderStorageRecord,
} from '../background/shared/provider-config-types';

export abstract class CloudProvider<TConfig> extends BaseProvider {
  protected readonly log = createLogger(this.name);

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
   * Return true if the provider has a valid configuration (API key loaded).
   */
  protected abstract hasConfig(): boolean;

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

  getInfo(): ProviderConfig {
    return super.getInfo();
  }
}

export default CloudProvider;
