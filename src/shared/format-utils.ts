/**
 * Shared formatting utilities for human-readable display values.
 */

/** Format a byte count as a human-readable string (e.g., "1.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Format a 0–1 fraction as a percentage string (e.g., 0.42 → "42.0%"). */
export function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

/**
 * Format a Unix timestamp (ms) as a locale date string.
 * Returns 'N/A' when timestamp is null/undefined/0.
 */
export function formatDate(timestamp: number | null | undefined, options?: { showTime?: boolean }): string {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(options?.showTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
