import { createLogger } from './logger';
import { browserAPI } from './browser-api';

const log = createLogger('Storage');

/** Last storage error message, available for UI display. Cleared on success. */
export let lastStorageError: string | null = null;

export async function safeStorageGet<T>(keys: string | string[]): Promise<Partial<T>> {
  try {
    const result = await browserAPI.storage.local.get(keys) as Partial<T>;
    lastStorageError = null;
    return result;
  } catch (error) {
    const keyStr = Array.isArray(keys) ? keys.join(', ') : keys;
    const errorMsg = error instanceof Error ? error.message : String(error);
    lastStorageError = `Failed to read settings (${keyStr}): ${errorMsg}`;
    log.error(`Storage get failed for keys [${keyStr}]:`, errorMsg);
    return {};
  }
}

export async function safeStorageSet(items: Record<string, unknown>): Promise<boolean> {
  try {
    await browserAPI.storage.local.set(items);
    lastStorageError = null;
    return true;
  } catch (error) {
    const keyStr = Object.keys(items).join(', ');
    const errorMsg = error instanceof Error ? error.message : String(error);
    lastStorageError = `Failed to save settings (${keyStr}): ${errorMsg}`;
    log.error(`Storage set failed for keys [${keyStr}]:`, errorMsg);
    return false;
  }
}
