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

/**
 * Shared try/catch skeleton for all storage operations.
 * Clears `lastStorageError` on success; records the failure and delegates to
 * `onError` (return a fallback or rethrow) on failure.
 */
async function runStorageOp<T>(
  action: 'read' | 'save' | 'remove',
  keyStr: string,
  op: () => Promise<T>,
  onError: (error: unknown) => T,
): Promise<T> {
  try {
    const result = await op();
    lastStorageError = null;
    return result;
  } catch (error) {
    recordStorageFailure(action, keyStr, error);
    return onError(error);
  }
}

export async function safeStorageGet<T>(keys: string | string[]): Promise<Partial<T>> {
  return runStorageOp(
    'read',
    formatStorageKeys(keys),
    () => browserAPI.storage.local.get(keys) as Promise<Partial<T>>,
    () => ({} as Partial<T>),
  );
}

export async function strictStorageGet<T>(keys: string | string[]): Promise<Partial<T>> {
  return runStorageOp(
    'read',
    formatStorageKeys(keys),
    () => browserAPI.storage.local.get(keys) as Promise<Partial<T>>,
    (error) => { throw error; },
  );
}

export async function safeStorageSet(items: Record<string, unknown>): Promise<boolean> {
  return runStorageOp(
    'save',
    Object.keys(items).join(', '),
    async () => { await browserAPI.storage.local.set(items); return true; },
    () => false,
  );
}

export async function strictStorageSet(items: Record<string, unknown>): Promise<void> {
  return runStorageOp(
    'save',
    Object.keys(items).join(', '),
    () => browserAPI.storage.local.set(items),
    (error) => { throw error; },
  );
}

export async function safeStorageRemove(keys: string | string[]): Promise<boolean> {
  return runStorageOp(
    'remove',
    formatStorageKeys(keys),
    async () => { await browserAPI.storage.local.remove(keys); return true; },
    () => false,
  );
}

export async function strictStorageRemove(keys: string | string[]): Promise<void> {
  return runStorageOp(
    'remove',
    formatStorageKeys(keys),
    () => browserAPI.storage.local.remove(keys),
    (error) => { throw error; },
  );
}
