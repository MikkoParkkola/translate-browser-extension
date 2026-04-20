/**
 * Version detection module
 *
 * Detects extension updates by comparing stored version with manifest version.
 * Provides hooks for first-run-after-update experiences.
 */

import { safeStorageGet, safeStorageSet } from './storage';

export interface VersionInfo {
  current: string;
  previous: string | null;
  isFirstRun: boolean;
  isUpdate: boolean;
}

/**
 * Check extension version against stored version.
 * Returns version info including whether this is an update.
 */
export async function checkVersion(): Promise<VersionInfo> {
  const current = getManifestVersion();

  const stored = await safeStorageGet<{ extension_version?: string; extension_first_run?: boolean }>(
    ['extension_version', 'extension_first_run'],
  );
  const previous = stored.extension_version ?? null;
  const isFirstRun = !previous;
  const isUpdate = !!previous && previous !== current;

  if (previous !== current) {
    await safeStorageSet({ extension_version: current, extension_updated_at: Date.now() });
  }

  return { current, previous, isFirstRun, isUpdate };
}

/**
 * Mark the "updated" notification as dismissed.
 */
export async function dismissUpdateNotice(): Promise<void> {
  await safeStorageSet({ extension_update_dismissed: true });
}

/**
 * Check if the update notice has been dismissed.
 */
export async function isUpdateDismissed(): Promise<boolean> {
  const stored = await safeStorageGet<{ extension_update_dismissed?: boolean }>(
    ['extension_update_dismissed'],
  );
  return stored.extension_update_dismissed === true;
}

/**
 * Get version from chrome.runtime.getManifest() with fallback.
 */
function getManifestVersion(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      return chrome.runtime.getManifest().version;
    }
  } catch {
    // Fallback
  }
  return '0.0.0';
}
