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
import { safeStorageGet, safeStorageRemove, safeStorageSet } from '../core/storage';
import { createLogger } from '../core/logger';
import type { ProviderConfig } from '../types';

export abstract class CloudProvider extends BaseProvider {
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
  protected abstract applyStoredConfig(stored: Record<string, unknown>): void;

  /**
   * Return true if the provider has a valid configuration (API key loaded).
   */
  protected abstract hasConfig(): boolean;

  /**
   * Hook called after clearApiKey() removes keys from storage.
   * Subclasses reset their internal config state here.
   */
  protected abstract resetConfig(): void;

  async initialize(): Promise<void> {
    try {
      const stored = await safeStorageGet<Record<string, unknown>>(this.getStorageKeys());
      this.applyStoredConfig(stored as Record<string, unknown>);
    } catch (error) {
      this.log.error('Failed to load config:', error);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.hasConfig()) {
      await this.initialize();
    }
    return this.hasConfig();
  }

  async clearApiKey(): Promise<void> {
    await safeStorageRemove(this.getStorageKeys());
    this.resetConfig();
  }

  /**
   * Persist one or more config values to storage.
   * Thin wrapper so subclasses don't need to import safeStorageSet directly.
   */
  protected persist(items: Record<string, unknown>): Promise<boolean> {
    return safeStorageSet(items);
  }

  /**
   * Best-effort persistence for counters/telemetry that must not fail the request path.
   */
  protected persistBestEffort(items: Record<string, unknown>, failureMessage: string): void {
    /* v8 ignore start -- fire-and-forget persist */
    void this.persist(items).catch((error) => this.log.warn(failureMessage, error));
    /* v8 ignore stop */
  }

  getInfo(): ProviderConfig {
    return super.getInfo();
  }
}

export default CloudProvider;
