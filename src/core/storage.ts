import { createLogger } from './logger';
import { browserAPI } from './browser-api';

const log = createLogger('Storage');

export async function safeStorageGet<T>(keys: string | string[]): Promise<Partial<T>> {
  try {
    return await browserAPI.storage.local.get(keys) as Partial<T>;
  } catch (error) {
    log.warn('Storage get failed:', error);
    return {};
  }
}

export async function safeStorageSet(items: Record<string, unknown>): Promise<boolean> {
  try {
    await browserAPI.storage.local.set(items);
    return true;
  } catch (error) {
    log.warn('Storage set failed:', error);
    return false;
  }
}
