/**
 * Local translation runtimes section.
 * Shows the extension-managed download inventory plus browser-managed runtime notes.
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { createLogger } from '../../core/logger';
import { safeStorageGet } from '../../core/storage';
import { trySendBackgroundMessage } from '../../shared/background-message';
import { normalizeDownloadedModelRecords } from '../../shared/downloaded-models';
import { formatBytes, formatDate } from '../../shared/format-utils';
import {
  MODEL_SELECTOR_OFFLINE_MODELS,
  getProviderDeliveryLabel,
  getProviderRuntimeLabel,
  getProviderStabilityLabel,
  resolveProviderFromModelId,
} from '../../shared/provider-options';
import type { DownloadedModelRecord } from '../../types';

const log = createLogger('LocalModels');

interface StorageStats {
  totalUsed: number;
  quota: number;
  models: DownloadedModelRecord[];
}

type InventorySource = 'background' | 'storage-fallback';

export const LocalModels: Component = () => {
  const [loading, setLoading] = createSignal(true);
  const [stats, setStats] = createSignal<StorageStats>({
    totalUsed: 0,
    quota: 0,
    models: [],
  });
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [inventorySource, setInventorySource] = createSignal<InventorySource>('background');

  onMount(async () => {
    await loadModelStats();
  });

  const loadModelStats = async () => {
    setLoading(true);

    try {
      // Get storage estimate
      let estimate = { usage: 0, quota: 0 };
      /* v8 ignore start */
      if ('storage' in navigator && 'estimate' in navigator.storage) {
      /* v8 ignore stop */
        estimate = await navigator.storage.estimate() as { usage: number; quota: number };
      }

      // Get cached model info from storage
      const stored = await safeStorageGet<{ downloadedModels?: unknown[] }>(['downloadedModels']);
      const fallbackModels = normalizeDownloadedModelRecords(stored.downloadedModels);

      // Try to get model list from background
      const response = await trySendBackgroundMessage<{ models?: DownloadedModelRecord[] }>({
        type: 'getDownloadedModels',
      });
      if (response && Array.isArray(response.models)) {
        setInventorySource('background');
        setStats({
          totalUsed: estimate.usage || 0,
          /* v8 ignore start */
          quota: estimate.quota || 0,
          /* v8 ignore stop */
          models: normalizeDownloadedModelRecords(response.models),
        });
        setLoading(false);
        return;
      }

      setInventorySource('storage-fallback');
      setStats({
        totalUsed: estimate.usage || 0,
        quota: estimate.quota || 0,
        models: fallbackModels,
      });
    } catch (error) {
      log.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteModel = async (modelId: string) => {
    if (!confirm(`Delete model "${modelId}"? You will need to re-download it to use it again.`)) {
      return;
    }

    setDeleting(modelId);

    try {
      const response = await trySendBackgroundMessage(
        {
          type: 'deleteModel',
          modelId,
        },
        {
          onError: (error) => {
            log.error('Failed to delete model:', error);
            alert('Failed to delete model. It may be in use.');
          },
        }
      );
      if (response === undefined) return;

      // Remove from local list
      setStats((prev) => ({
        ...prev,
        models: prev.models.filter((m) => m.id !== modelId),
      }));

      // Refresh stats
      await loadModelStats();
    } catch (error) {
      log.error('Failed to refresh models after delete:', error);
      alert('Failed to delete model. It may be in use.');
    } finally {
      setDeleting(null);
    }
  };

  const clearAllModels = async () => {
    if (!confirm('Delete all downloaded models? This frees extension-managed storage, but you will need to download models again when needed.')) {
      return;
    }

    try {
      const response = await trySendBackgroundMessage(
        { type: 'clearAllModels' },
        {
          onError: (error) => {
            log.error('Failed to clear models:', error);
            alert('Failed to clear models. Some models may still be cached.');
          },
        }
      );
      if (response === undefined) return;

      // Clear Cache API if available
      /* v8 ignore start */
      if ('caches' in window) {
      /* v8 ignore stop */
        const keys = await caches.keys();
        for (const key of keys) {
          if (key.includes('transformers') || key.includes('model')) {
            await caches.delete(key);
          }
        }
      }

      // Refresh stats
      await loadModelStats();
    } catch (error) {
      log.error('Failed to clear models:', error);
      alert('Failed to clear models. Some models may still be cached.');
    }
  };

  const usagePercent = () => {
    const s = stats();
    if (s.quota === 0) return 0;
    return Math.min(100, (s.totalUsed / s.quota) * 100);
  };

  const formatTrackedSize = (size: number) => (size > 0 ? formatBytes(size) : 'Size unavailable');

  const getInventoryNote = () =>
    inventorySource() === 'background'
      ? 'This is the extension-managed download inventory. Chrome Built-in stays outside this list because Chrome manages that runtime separately.'
      : 'Background inventory was unavailable, so this list is using the last extension-managed storage snapshot and may lag behind current caches.';

  const getRuntimeMeta = (modelId: string) => {
    const providerId = resolveProviderFromModelId(modelId);
    return providerId ? MODEL_SELECTOR_OFFLINE_MODELS.find((model) => model.id === providerId) : undefined;
  };

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Local Translation Runtimes</h2>
      <p class="section-description">
        Review extension-managed model downloads and the browser-native or local runtimes the
        extension can use.
      </p>

      <Show when={loading()}>
        <div class="settings-section">
          <div class="loading" style={{ height: "100px" }}>
            <span class="spinner" />
          </div>
        </div>
      </Show>

      <Show when={!loading()}>
        {/* Storage Usage */}
        <section class="settings-section">
          <div class="section-header">
            <div>
              <h3 class="section-title">Storage Usage</h3>
              <p class="section-subtitle">Browser storage used by extension-managed model downloads and caches</p>
            </div>
          </div>

          <div style={{ "margin-bottom": "1rem" }}>
            <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "0.5rem" }}>
              <span style={{ "font-weight": "500" }}>{formatBytes(stats().totalUsed)}</span>
              <span style={{ color: "var(--color-gray-500)" }}>
                of {formatBytes(stats().quota)} available
              </span>
            </div>
            <div class="progress-bar">
              <div
                class={`progress-fill ${usagePercent() > 80 ? 'danger' : usagePercent() > 50 ? 'warning' : ''}`}
                style={{ width: `${usagePercent()}%` }}
              />
            </div>
          </div>

          <button class="btn btn-danger" onClick={clearAllModels}>
            Clear Downloaded Models
          </button>
        </section>

        {/* Downloaded Models */}
        <section class="settings-section">
          <div class="section-header">
            <div>
              <h3 class="section-title">Downloaded Models</h3>
              <p class="section-subtitle">{getInventoryNote()}</p>
            </div>
          </div>

          <Show
            when={stats().models.length > 0}
            fallback={
              <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2" />
                  <path d="M9 9h6M9 13h6M9 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
                <p>No models downloaded yet</p>
                <p style={{ "font-size": "0.875rem" }}>
                  Models will be downloaded automatically when you first use a language pair.
                </p>
              </div>
            }
          >
            <For each={stats().models}>
              {(model) => (
                <div class="model-card">
                  <div class="model-info">
                    <div class="model-name">{model.name || model.id}</div>
                    <div class="model-size">
                      {formatTrackedSize(model.size)}
                      <Show when={model.lastUsed}>
                        {' | Last used: '}
                        {formatDate(model.lastUsed!)}
                      </Show>
                    </div>
                    <Show when={getRuntimeMeta(model.id)}>
                      {(runtime) => (
                        <div class="model-size">
                          {runtime().name}
                          {' | '}
                          {getProviderStabilityLabel(runtime().stability!)}
                          {' | '}
                          {getProviderRuntimeLabel(runtime().runtimeKind!)}
                        </div>
                      )}
                    </Show>
                  </div>
                  <div class="model-actions">
                    <button
                      class="btn btn-sm btn-danger"
                      onClick={() => deleteModel(model.id)}
                      disabled={deleting() === model.id}
                    >
                      {deleting() === model.id ? <span class="spinner" /> : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </section>

        {/* Runtime overview */}
        <section class="settings-section">
          <div class="section-header">
            <h3 class="section-title">Runtime Overview</h3>
          </div>
          <For each={MODEL_SELECTOR_OFFLINE_MODELS}>
            {(runtime) => (
              <div class="model-card">
                <div class="model-info">
                  <div class="model-name">{runtime.name}</div>
                  <div class="model-size">
                    {getProviderStabilityLabel(runtime.stability!)}
                    {' | '}
                    {getProviderRuntimeLabel(runtime.runtimeKind!)}
                    {' | '}
                    {getProviderDeliveryLabel(runtime.deliveryKind!)}
                  </div>
                  <div class="model-size">{runtime.description}</div>
                  <Show when={runtime.availabilityNote}>
                    <div class="model-size">{runtime.availabilityNote}</div>
                  </Show>
                </div>
                <div class="model-actions">
                  <span class="model-size">{runtime.size}</span>
                </div>
              </div>
            )}
          </For>
        </section>
      </Show>
    </div>
  );
};

/* v8 ignore start */
export default LocalModels;
/* v8 ignore stop */
