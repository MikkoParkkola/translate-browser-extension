/**
 * Offline Translation Section
 * Downloaded model list, storage usage, and browser-managed translation notes
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { createLogger } from '../../core/logger';
import { safeStorageGet } from '../../core/storage';
import { trySendBackgroundMessage } from '../../shared/background-message';
import { formatBytes, formatDate } from '../../shared/format-utils';

const log = createLogger('LocalModels');

interface ModelInfo {
  id: string;
  name: string;
  size: number;
  lastUsed?: number;
}

interface StorageStats {
  totalUsed: number;
  quota: number;
  models: ModelInfo[];
}

export const LocalModels: Component = () => {
  const [loading, setLoading] = createSignal(true);
  const [stats, setStats] = createSignal<StorageStats>({
    totalUsed: 0,
    quota: 0,
    models: [],
  });
  const [deleting, setDeleting] = createSignal<string | null>(null);

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
      const stored = await safeStorageGet<{ downloadedModels?: ModelInfo[] }>(['downloadedModels']);
      const models: ModelInfo[] = stored.downloadedModels || [];

      // Try to get model list from background
      const response = await trySendBackgroundMessage<{ models?: ModelInfo[] }>({
        type: 'getDownloadedModels',
      });
      if (response?.models) {
        setStats({
          totalUsed: estimate.usage || 0,
          /* v8 ignore start */
          quota: estimate.quota || 0,
          /* v8 ignore stop */
          models: response.models,
        });
        setLoading(false);
        return;
      }

      setStats({
        totalUsed: estimate.usage || 0,
        quota: estimate.quota || 0,
        models,
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

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Offline Translation</h2>
      <p class="section-description">
        Manage downloaded offline models and review how browser-managed translation works.
        Chrome Built-in translation does not download into this list because Chrome manages it separately.
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
              <p class="section-subtitle">Extension-managed storage used by downloaded models</p>
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
            <h3 class="section-title">Downloaded Models</h3>
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
                      {formatBytes(model.size)}
                      <Show when={model.lastUsed}>
                        {' | Last used: '}
                        {formatDate(model.lastUsed!)}
                      </Show>
                    </div>
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

        {/* Info */}
        <section class="settings-section">
            <div class="section-header">
            <h3 class="section-title">About Offline Translation</h3>
          </div>
          <div style={{ "font-size": "0.875rem", color: "var(--color-gray-600)" }}>
            <p style={{ "margin-bottom": "0.75rem" }}>
              <strong>OPUS-MT Models</strong> (~170MB per language pair): Helsinki-NLP translation models.
              This is the stable downloaded baseline and works without GPU acceleration.
            </p>
            <p style={{ "margin-bottom": "0.75rem" }}>
              <strong>TranslateGemma</strong> (~3.6GB): experimental high-quality translation in a single model.
              Requires WebGPU or WebNN acceleration.
            </p>
            <p>
              <strong>Chrome Built-in</strong> uses the browser translator in Chrome 138+ and does not
              require a local model download, so it does not appear in this list.
            </p>
            <p>
              Downloaded models are best-effort tracked from extension metadata and browser caches.
              Browser-managed translation may still work even when no downloaded models appear here.
            </p>
          </div>
        </section>
      </Show>
    </div>
  );
};

/* v8 ignore start */
export default LocalModels;
/* v8 ignore stop */
