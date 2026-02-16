/**
 * Network Status Detection
 * Provides online/offline detection for fast-fail on cloud providers
 * and automatic fallback to local models when offline.
 */

import { createLogger } from './logger';

const log = createLogger('Network');

/** Current network status */
let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

/** Listeners for network status changes */
type NetworkListener = (online: boolean) => void;
const listeners: NetworkListener[] = [];

/**
 * Initialize network status monitoring.
 * Call once from service worker or offscreen document.
 */
export function initNetworkMonitoring(): void {
  if (typeof globalThis.addEventListener !== 'function') return;

  globalThis.addEventListener('online', () => {
    _isOnline = true;
    log.info('Network restored');
    listeners.forEach((fn) => fn(true));
  });

  globalThis.addEventListener('offline', () => {
    _isOnline = false;
    log.warn('Network lost - cloud providers unavailable');
    listeners.forEach((fn) => fn(false));
  });

  log.info(`Network monitoring initialized (online: ${_isOnline})`);
}

/**
 * Check if network is currently available.
 * Uses navigator.onLine as primary signal.
 */
export function isOnline(): boolean {
  // Always re-check navigator.onLine in case event was missed
  if (typeof navigator !== 'undefined') {
    _isOnline = navigator.onLine;
  }
  return _isOnline;
}

/**
 * Subscribe to network status changes.
 * Returns unsubscribe function.
 */
export function onNetworkChange(listener: NetworkListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Check if a provider requires network access.
 */
export function isCloudProvider(providerId: string): boolean {
  return ['deepl', 'openai', 'anthropic', 'google-cloud'].includes(providerId);
}
