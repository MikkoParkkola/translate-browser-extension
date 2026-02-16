/**
 * Cache Settings Section
 * Cache size, hit rate, clear cache
 */

import { Component, createSignal, onMount, Show } from 'solid-js';
import type { TranslationCacheStats } from '../../core/translation-cache';
import { ConfirmDialog } from '../../shared/ConfirmDialog';

// Format bytes to human-readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format percentage
function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

// Format date
function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const CacheSettings: Component = () => {
  const [loading, setLoading] = createSignal(true);
  const [clearing, setClearing] = createSignal(false);
  const [stats, setStats] = createSignal<TranslationCacheStats | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = createSignal(false);

  onMount(async () => {
    await loadStats();
  });

  const loadStats = async () => {
    setLoading(true);

    try {
      // Try to get cache stats from background
      const response = await chrome.runtime.sendMessage({ type: 'getCacheStats' });

      if (response?.stats) {
        setStats(response.stats);
      } else {
        // Fallback: estimate from storage
        const estimate = await navigator.storage?.estimate?.() || { usage: 0, quota: 0 };

        setStats({
          entries: 0,
          totalSize: estimate.usage || 0,
          maxSize: 100 * 1024 * 1024, // 100MB default
          hits: 0,
          misses: 0,
          hitRate: 0,
          oldestTimestamp: null,
          newestTimestamp: null,
        });
      }
    } catch (e) {
      console.error('[CacheSettings] Failed to load stats:', e);
      setError('Failed to load cache statistics');
    } finally {
      setLoading(false);
    }
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

  const clearCache = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    setError(null);

    try {
      await chrome.runtime.sendMessage({ type: 'clearCache' });
      await loadStats();
      showSuccess('Cache cleared successfully');
    } catch (e) {
      console.error('[CacheSettings] Failed to clear cache:', e);
      setError('Failed to clear cache');
    } finally {
      setClearing(false);
    }
  };

  const usagePercent = () => {
    const s = stats();
    if (!s || s.maxSize === 0) return 0;
    return Math.min(100, (s.totalSize / s.maxSize) * 100);
  };

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Translation Cache</h2>
      <p class="section-description">
        Translations are cached locally to improve performance and reduce API calls.
        The cache uses IndexedDB with LRU (Least Recently Used) eviction when full.
      </p>

      {/* Alerts */}
      <Show when={error()}>
        <div class="alert alert-error">{error()}</div>
      </Show>
      <Show when={success()}>
        <div class="alert alert-success">{success()}</div>
      </Show>

      <Show when={loading()}>
        <div class="settings-section">
          <div class="loading" style={{ height: "100px" }}>
            <span class="spinner" />
          </div>
        </div>
      </Show>

      <Show when={!loading() && stats()}>
        {/* Stats Cards */}
        <div class="cache-stats">
          <div class="stat-card">
            <div class="stat-value">{stats()!.entries.toLocaleString()}</div>
            <div class="stat-label">Cached Entries</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">{formatBytes(stats()!.totalSize)}</div>
            <div class="stat-label">Storage Used</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">{formatPercent(stats()!.hitRate)}</div>
            <div class="stat-label">Hit Rate</div>
          </div>
        </div>

        {/* Storage Usage */}
        <section class="settings-section">
          <div class="section-header">
            <div>
              <h3 class="section-title">Storage Usage</h3>
              <p class="section-subtitle">Cache storage allocation and usage</p>
            </div>
          </div>

          <div style={{ "margin-bottom": "1rem" }}>
            <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "0.5rem" }}>
              <span style={{ "font-weight": "500" }}>{formatBytes(stats()!.totalSize)}</span>
              <span style={{ color: "var(--color-gray-500)" }}>
                of {formatBytes(stats()!.maxSize)} maximum
              </span>
            </div>
            <div class="progress-bar">
              <div
                class={`progress-fill ${usagePercent() > 80 ? 'danger' : usagePercent() > 50 ? 'warning' : ''}`}
                style={{ width: `${usagePercent()}%` }}
              />
            </div>
          </div>

          <div style={{ display: "flex", "justify-content": "space-between", "font-size": "0.875rem", color: "var(--color-gray-600)" }}>
            <div>
              <strong>Oldest entry:</strong> {formatDate(stats()!.oldestTimestamp)}
            </div>
            <div>
              <strong>Newest entry:</strong> {formatDate(stats()!.newestTimestamp)}
            </div>
          </div>
        </section>

        {/* Performance Stats */}
        <section class="settings-section">
          <div class="section-header">
            <div>
              <h3 class="section-title">Performance</h3>
              <p class="section-subtitle">Cache hit and miss statistics</p>
            </div>
          </div>

          <div style={{ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "1rem" }}>
            <div>
              <div style={{ "font-size": "1.25rem", "font-weight": "600", color: "var(--color-green-600)" }}>
                {stats()!.hits.toLocaleString()}
              </div>
              <div style={{ "font-size": "0.75rem", color: "var(--color-gray-500)" }}>Cache Hits</div>
            </div>

            <div>
              <div style={{ "font-size": "1.25rem", "font-weight": "600", color: "var(--color-gray-600)" }}>
                {stats()!.misses.toLocaleString()}
              </div>
              <div style={{ "font-size": "0.75rem", color: "var(--color-gray-500)" }}>Cache Misses</div>
            </div>

            <div>
              <div style={{ "font-size": "1.25rem", "font-weight": "600", color: "var(--color-primary-600)" }}>
                {(stats()!.hits + stats()!.misses).toLocaleString()}
              </div>
              <div style={{ "font-size": "0.75rem", color: "var(--color-gray-500)" }}>Total Lookups</div>
            </div>
          </div>

          <Show when={stats()!.hitRate > 0}>
            <div class="alert alert-info" style={{ "margin-top": "1rem" }}>
              Your cache hit rate of {formatPercent(stats()!.hitRate)} means {formatPercent(stats()!.hitRate)} of
              translations are served from cache, saving API calls and improving response time.
            </div>
          </Show>
        </section>

        {/* Clear Cache */}
        <section class="settings-section">
          <div class="section-header">
            <div>
              <h3 class="section-title">Clear Cache</h3>
              <p class="section-subtitle">Remove all cached translations</p>
            </div>
          </div>

          <p style={{ "font-size": "0.875rem", color: "var(--color-gray-600)", "margin-bottom": "1rem" }}>
            Clearing the cache will remove all stored translations. Future translations
            will need to be fetched again, which may result in increased API usage.
          </p>

          <div class="btn-group">
            <button
              class="btn btn-danger"
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing() || stats()!.entries === 0}
            >
              {clearing() ? (
                <>
                  <span class="spinner" />
                  Clearing...
                </>
              ) : (
                'Clear Cache'
              )}
            </button>

            <button class="btn btn-secondary" onClick={loadStats}>
              Refresh Stats
            </button>
          </div>
        </section>

        {/* Info */}
        <section class="settings-section">
          <div class="section-header">
            <h3 class="section-title">How Caching Works</h3>
          </div>
          <div style={{ "font-size": "0.875rem", color: "var(--color-gray-600)" }}>
            <p style={{ "margin-bottom": "0.75rem" }}>
              <strong>LRU Eviction:</strong> When the cache reaches its size limit,
              the least recently used entries are automatically removed to make room
              for new translations.
            </p>
            <p style={{ "margin-bottom": "0.75rem" }}>
              <strong>Cache Keys:</strong> Translations are cached based on the
              source text, source language, target language, and provider. The same
              text translated with different settings will have separate cache entries.
            </p>
            <p>
              <strong>Persistence:</strong> The cache is stored in IndexedDB and
              persists across browser restarts. It is not synced across devices.
            </p>
          </div>
        </section>
      </Show>

      <ConfirmDialog
        open={showClearConfirm()}
        title="Clear Translation Cache"
        message="This will delete all cached translations. You cannot undo this action. Future translations will need to be fetched again."
        confirmLabel="Clear Cache"
        cancelLabel="Keep Cache"
        variant="warning"
        onConfirm={clearCache}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
};

export default CacheSettings;
