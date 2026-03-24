import { createLogger } from './logger';
import { extractErrorMessage } from './errors';
import { browserAPI } from './browser-api';

const log = createLogger('Storage');

/** Last storage error message, available for UI display. Cleared on success. */
export let lastStorageError: string | null = null;

function formatStorageKeys(keys: string | string[]): string {
  return Array.isArray(keys) ? keys.join(', ') : keys;
}

function recordStorageFailure(action: 'read' | 'save' | 'remove', keyStr: string, error: unknown): void {
  const errorMsg = extractErrorMessage(error);
  lastStorageError = `Failed to ${action} settings (${keyStr}): ${errorMsg}`;
  log.error(`Storage ${action} failed for keys [${keyStr}]:`, errorMsg);
}

export async function safeStorageGet<T>(keys: string | string[]): Promise<Partial<T>> {
  try {
    const result = await browserAPI.storage.local.get(keys) as Partial<T>;
    lastStorageError = null;
    return result;
  } catch (error) {
    recordStorageFailure('read', formatStorageKeys(keys), error);
    return {};
  }
}

export async function strictStorageGet<T>(keys: string | string[]): Promise<Partial<T>> {
  try {
    const result = await browserAPI.storage.local.get(keys) as Partial<T>;
    lastStorageError = null;
    return result;
  } catch (error) {
    recordStorageFailure('read', formatStorageKeys(keys), error);
    throw error;
  }
}

export async function safeStorageSet(items: Record<string, unknown>): Promise<boolean> {
  try {
    await browserAPI.storage.local.set(items);
    lastStorageError = null;
    return true;
  } catch (error) {
    recordStorageFailure('save', Object.keys(items).join(', '), error);
    return false;
  }
}

export async function strictStorageSet(items: Record<string, unknown>): Promise<void> {
  try {
    await browserAPI.storage.local.set(items);
    lastStorageError = null;
  } catch (error) {
    recordStorageFailure('save', Object.keys(items).join(', '), error);
    throw error;
  }
}

export async function safeStorageRemove(keys: string | string[]): Promise<boolean> {
  try {
    await browserAPI.storage.local.remove(keys);
    lastStorageError = null;
    return true;
  } catch (error) {
    recordStorageFailure('remove', formatStorageKeys(keys), error);
    return false;
  }
}

export async function strictStorageRemove(keys: string | string[]): Promise<void> {
  try {
    await browserAPI.storage.local.remove(keys);
    lastStorageError = null;
  } catch (error) {
    recordStorageFailure('remove', formatStorageKeys(keys), error);
    throw error;
  }
}
