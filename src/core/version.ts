/**
 * Version detection module
 *
 * Detects extension updates by comparing stored version with manifest version.
 * Provides hooks for first-run-after-update experiences.
 */

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

  try {
    const stored = await chrome.storage.local.get(['extension_version', 'extension_first_run']);
    const previous = (stored.extension_version as string) ?? null;
    const isFirstRun = !previous;
    const isUpdate = !!previous && previous !== current;

    // Persist current version
    if (previous !== current) {
      await chrome.storage.local.set({
        extension_version: current,
        extension_updated_at: Date.now(),
      });
    }

    return { current, previous, isFirstRun, isUpdate };
  } catch {
    return { current, previous: null, isFirstRun: true, isUpdate: false };
  }
}

/**
 * Mark the "updated" notification as dismissed.
 */
export async function dismissUpdateNotice(): Promise<void> {
  try {
    await chrome.storage.local.set({ extension_update_dismissed: true });
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if the update notice has been dismissed.
 */
export async function isUpdateDismissed(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(['extension_update_dismissed']);
    return !!stored.extension_update_dismissed;
  } catch {
    return true;
  }
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
