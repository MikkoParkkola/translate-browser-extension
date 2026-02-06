/**
 * Local Models Section
 * Downloaded models list, storage usage, clear all
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';

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

// Format bytes to human-readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format date
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        estimate = await navigator.storage.estimate() as { usage: number; quota: number };
      }

      // Get cached model info from storage
      const stored = await chrome.storage.local.get(['downloadedModels']);
      const models: ModelInfo[] = stored.downloadedModels || [];

      // Try to get model list from background
      try {
        const response = await chrome.runtime.sendMessage({ type: 'getDownloadedModels' });
        if (response?.models) {
          setStats({
            totalUsed: estimate.usage || 0,
            quota: estimate.quota || 0,
            models: response.models,
          });
          setLoading(false);
          return;
        }
      } catch {
        // Background script might not support this message
      }

      // Fallback: estimate from known model sizes
      const knownModels: ModelInfo[] = [
        { id: 'opus-mt-en-fi', name: 'OPUS-MT English-Finnish', size: 300 * 1024 * 1024 },
        { id: 'opus-mt-fi-en', name: 'OPUS-MT Finnish-English', size: 300 * 1024 * 1024 },
        { id: 'opus-mt-en-de', name: 'OPUS-MT English-German', size: 300 * 1024 * 1024 },
        { id: 'opus-mt-de-en', name: 'OPUS-MT German-English', size: 300 * 1024 * 1024 },
        { id: 'translategemma', name: 'TranslateGemma 4B', size: 2.5 * 1024 * 1024 * 1024 },
      ];

      // Merge with stored models if available
      const mergedModels = models.length > 0 ? models : knownModels.filter(
        () => estimate.usage && estimate.usage > 100 * 1024 * 1024
      );

      setStats({
        totalUsed: estimate.usage || 0,
        quota: estimate.quota || 0,
        models: mergedModels,
      });
    } catch (e) {
      console.error('[LocalModels] Failed to load stats:', e);
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
      // Try to delete via background script
      await chrome.runtime.sendMessage({
        type: 'deleteModel',
        modelId,
      });

      // Remove from local list
      setStats((prev) => ({
        ...prev,
        models: prev.models.filter((m) => m.id !== modelId),
      }));

      // Refresh stats
      await loadModelStats();
    } catch (e) {
      console.error('[LocalModels] Failed to delete model:', e);
      alert('Failed to delete model. It may be in use.');
    } finally {
      setDeleting(null);
    }
  };

  const clearAllModels = async () => {
    if (!confirm('Delete ALL downloaded models? This will free up storage but you will need to re-download models when needed.')) {
      return;
    }

    try {
      // Try to clear via background script
      await chrome.runtime.sendMessage({ type: 'clearAllModels' });

      // Clear Cache API if available
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          if (key.includes('transformers') || key.includes('model')) {
            await caches.delete(key);
          }
        }
      }

      // Refresh stats
      await loadModelStats();
    } catch (e) {
      console.error('[LocalModels] Failed to clear models:', e);
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
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Local Models</h2>
      <p class="section-description">
        Manage downloaded translation models. Local models run entirely on your device
        without sending data to any server.
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
              <p class="section-subtitle">Local storage used by downloaded models</p>
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
            Clear All Models
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
            <h3 class="section-title">About Local Models</h3>
          </div>
          <div style={{ "font-size": "0.875rem", color: "var(--color-gray-600)" }}>
            <p style={{ "margin-bottom": "0.75rem" }}>
              <strong>OPUS-MT Models</strong> (~300MB each): Helsinki-NLP translation models.
              Fast and accurate for European languages.
            </p>
            <p style={{ "margin-bottom": "0.75rem" }}>
              <strong>TranslateGemma</strong> (~2.5GB): Google's multilingual model.
              Supports 8 languages with high quality but requires WebGPU.
            </p>
            <p>
              Models are stored in IndexedDB and persist across browser restarts.
              They are downloaded on first use for each language pair.
            </p>
          </div>
        </section>
      </Show>
    </div>
  );
};

export default LocalModels;
