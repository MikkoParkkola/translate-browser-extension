import type {
  DownloadedModelRecord,
  ModelProgressMessage,
  OffscreenDownloadedModelUpdateMessage,
  OffscreenModelMessage,
  OffscreenModelProgressMessage,
} from '../../types';
import { createLogger } from '../../core/logger';
import {
  safeStorageGet,
  strictStorageGet,
  strictStorageRemove,
  strictStorageSet,
} from '../../core/storage';
import {
  deriveDownloadedModelName,
  normalizeDownloadedModelRecords,
  upsertDownloadedModelRecord,
} from '../../shared/downloaded-models';

const log = createLogger('ModelDownloads');
const DOWNLOADED_MODELS_KEY = 'downloadedModels';

export function isOffscreenModelProgressMessage(
  message: unknown,
): message is OffscreenModelProgressMessage {
  return (
    typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'offscreenModelProgress'
    && (message as { target?: unknown }).target === 'background'
    && typeof (message as { modelId?: unknown }).modelId === 'string'
  );
}

export function isOffscreenDownloadedModelUpdateMessage(
  message: unknown,
): message is OffscreenDownloadedModelUpdateMessage {
  return (
    typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'offscreenDownloadedModelUpdate'
    && (message as { target?: unknown }).target === 'background'
    && typeof (message as { modelId?: unknown }).modelId === 'string'
  );
}

export function isOffscreenModelMessage(message: unknown): message is OffscreenModelMessage {
  return (
    isOffscreenModelProgressMessage(message)
    || isOffscreenDownloadedModelUpdateMessage(message)
  );
}

export async function getDownloadedModelInventory(): Promise<DownloadedModelRecord[]> {
  const stored = await safeStorageGet<{ downloadedModels?: unknown[] }>([DOWNLOADED_MODELS_KEY]);
  return normalizeDownloadedModelRecords(stored.downloadedModels);
}

export async function upsertDownloadedModelInventory(
  update: OffscreenDownloadedModelUpdateMessage,
): Promise<DownloadedModelRecord[]> {
  const stored = await strictStorageGet<{ downloadedModels?: unknown[] }>([
    DOWNLOADED_MODELS_KEY,
  ]);
  const next = upsertDownloadedModelRecord(stored.downloadedModels, {
    id: update.modelId,
    name: update.name ?? deriveDownloadedModelName(update.modelId),
    size: update.size,
    lastUsed: update.lastUsed,
  });
  await strictStorageSet({ [DOWNLOADED_MODELS_KEY]: next });
  return next;
}

export async function deleteDownloadedModelInventoryEntry(
  modelId: string,
): Promise<DownloadedModelRecord[]> {
  const stored = await strictStorageGet<{ downloadedModels?: unknown[] }>([
    DOWNLOADED_MODELS_KEY,
  ]);
  const models = normalizeDownloadedModelRecords(stored.downloadedModels);
  const next = models.filter((model) => model.id !== modelId);
  await strictStorageSet({ [DOWNLOADED_MODELS_KEY]: next });
  return next;
}

export async function clearDownloadedModelInventory(): Promise<void> {
  await strictStorageRemove([DOWNLOADED_MODELS_KEY]);
}

export function relayModelProgress(update: Omit<ModelProgressMessage, 'type'>): void {
  try {
    const maybePromise = chrome.runtime.sendMessage({
      type: 'modelProgress',
      ...update,
    });
    if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === 'function') {
      void (maybePromise as Promise<unknown>).catch((error) => {
        log.debug('Model progress relay skipped:', error);
      });
    }
  } catch (error) {
    log.debug('Model progress relay threw:', error);
  }
}
