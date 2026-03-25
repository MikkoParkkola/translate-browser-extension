/**
 * Cache Settings Section
 * Cache size, hit rate, clear cache
 */

import { Component, createSignal, onMount, Show } from 'solid-js';
import { CONFIG } from '../../config';
import { createLogger } from '../../core/logger';
import type { DetailedCacheStats } from '../../types';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { formatPercent, formatDate } from '../../shared/format-utils';
import { sendBackgroundMessageWithUiError } from '../../shared/background-message';
import { reportUiError, showTemporaryMessage } from '../../shared/ui-feedback';

const log = createLogger('CacheSettings');
const EMPTY_CACHE_STATS: DetailedCacheStats = {
  size: 0,
  maxSize: CONFIG.cache.maxSize,
  hitRate: '0/0 (0%)',
  oldestEntry: null,
  totalHits: 0,
  totalMisses: 0,
  mostUsed: [],
  memoryEstimate: '~0KB',
  languagePairs: {},
};

export const CacheSettings: Component = () => {
  const [loading, setLoading] = createSignal(true);
  const [clearing, setClearing] = createSignal(false);
  const [stats, setStats] = createSignal<DetailedCacheStats | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = createSignal(false);

  onMount(async () => {
    await loadStats();
  });

  const loadStats = async () => {
    setLoading(true);

    try {
      const response = await sendBackgroundMessageWithUiError<{
        cache?: DetailedCacheStats;
      }>(
        { type: 'getCacheStats' },
        {
          setError,
          logger: log,
          userMessage: 'Failed to load cache statistics',
          logMessage: 'Failed to load stats:',
        }
      );
      if (!response) return;

      setStats(response.cache ?? EMPTY_CACHE_STATS);
    } catch (error) {
      reportUiError(setError, log, 'Failed to load cache statistics', 'Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearCache = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    setError(null);

    try {
      const response = await sendBackgroundMessageWithUiError(
        { type: 'clearCache' },
        {
          setError,
          logger: log,
          userMessage: 'Failed to clear cache',
          logMessage: 'Failed to clear cache:',
        }
      );
      if (response === undefined) return;
      await loadStats();
      showTemporaryMessage(setSuccess, 'Cache cleared successfully');
    } finally {
      setClearing(false);
    }
  };

  const usagePercent = () => {
    const s = stats();
    /* v8 ignore start -- guard */
    if (!s || s.maxSize === 0) return 0;
    /* v8 ignore stop */
    return Math.min(100, (s.size / s.maxSize) * 100);
  };

  const totalLookups = () => {
    const s = stats();
    return s ? s.totalHits + s.totalMisses : 0;
  };

  const hitRate = () => {
    const lookups = totalLookups();
    /* v8 ignore start -- guard */
    if (lookups === 0) return 0;
    /* v8 ignore stop */
    return stats()!.totalHits / lookups;
  };

  const languagePairCount = () => Object.keys(stats()?.languagePairs ?? {}).length;

  const capacityLabel = () => {
    const s = stats();
    if (!s) return '0 entries';
    return `${s.size.toLocaleString()} entries`;
  };

  return (
    <div>
      <h2 class="section-title" style={{ "margin-bottom": "0.5rem" }}>Translation Cache</h2>
      <p class="section-description">
        Recent translations are stored in the extension's persistent background cache to speed up repeated requests.
        This screen reflects that translation memory, not the offscreen runtime's internal model caches.
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
            <div class="stat-value">{stats()!.size.toLocaleString()}</div>
            <div class="stat-label">Cached Entries</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">{stats()!.memoryEstimate}</div>
            <div class="stat-label">Estimated Memory</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">{formatPercent(hitRate())}</div>
            <div class="stat-label">Hit Rate</div>
          </div>
        </div>

        {/* Capacity Usage */}
        <section class="settings-section">
          <div class="section-header">
            <div>
              <h3 class="section-title">Capacity Usage</h3>
              <p class="section-subtitle">Persistent background cache entry usage</p>
            </div>
          </div>

          <div style={{ "margin-bottom": "1rem" }}>
            <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "0.5rem" }}>
              <span style={{ "font-weight": "500" }}>{capacityLabel()}</span>
              <span style={{ color: "var(--color-gray-500)" }}>
                of {stats()!.maxSize.toLocaleString()} maximum
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
              <strong>Oldest entry:</strong> {formatDate(stats()!.oldestEntry, { showTime: true })}
            </div>
            <div>
              <strong>Language pairs:</strong> {languagePairCount().toLocaleString()}
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
                {stats()!.totalHits.toLocaleString()}
              </div>
              <div style={{ "font-size": "0.75rem", color: "var(--color-gray-500)" }}>Cache Hits</div>
            </div>

            <div>
              <div style={{ "font-size": "1.25rem", "font-weight": "600", color: "var(--color-gray-600)" }}>
                {stats()!.totalMisses.toLocaleString()}
              </div>
              <div style={{ "font-size": "0.75rem", color: "var(--color-gray-500)" }}>Cache Misses</div>
            </div>

            <div>
              <div style={{ "font-size": "1.25rem", "font-weight": "600", color: "var(--color-primary-600)" }}>
                {totalLookups().toLocaleString()}
              </div>
              <div style={{ "font-size": "0.75rem", color: "var(--color-gray-500)" }}>Total Lookups</div>
            </div>
          </div>

          <Show when={hitRate() > 0}>
            <div class="alert alert-info" style={{ "margin-top": "1rem" }}>
              Your cache served {stats()!.totalHits.toLocaleString()} of {totalLookups().toLocaleString()} repeated
              translations from memory ({formatPercent(hitRate())}), reducing repeated translation work and API calls.
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
            Clearing the cache will remove all stored translations from the background translation memory.
            Future translations will need to be processed again, which may increase latency and API usage.
          </p>

          <div class="btn-group">
            <button
              class="btn btn-danger"
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing() || stats()!.size === 0}
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
              <strong>Persistence:</strong> The background translation memory is stored
              in extension storage and persists across browser restarts. It is not synced across devices.
            </p>
          </div>
        </section>
      </Show>

      <ConfirmDialog
        open={showClearConfirm()}
        title="Clear Translation Cache"
        message="This will delete all cached translations from the background translation memory. You cannot undo this action. Future translations will need to be processed again."
        confirmLabel="Clear Cache"
        cancelLabel="Keep Cache"
        variant="warning"
        onConfirm={clearCache}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
};

/* v8 ignore start */
export default CacheSettings;
/* v8 ignore stop */
