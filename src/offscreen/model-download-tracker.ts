import { createLogger } from '../core/logger';
import { upsertDownloadedModelRecord } from '../shared/downloaded-models';
import {
  getProviderModelInfo,
  resolveProviderFromModelId,
} from '../shared/provider-options';
import type { ModelProgressMessage } from '../types';

const log = createLogger('ModelDownloadTracker');
const trackedModelSizes = new Map<string, number>();

function readFinitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getTrackedModelName(modelId: string): string | undefined {
  const providerId = resolveProviderFromModelId(modelId);
  if (!providerId) {
    return undefined;
  }

  if (providerId === 'opus-mt') {
    const pair = modelId.match(/opus-mt-(.+)$/)?.[1];
    return pair ? `OPUS-MT ${pair.toUpperCase()}` : getProviderModelInfo(providerId).name;
  }

  return getProviderModelInfo(providerId).name;
}

export function reportModelProgress(
  modelId: string,
  update: Omit<ModelProgressMessage, 'type' | 'modelId'>,
): void {
  const trackedSize = readFinitePositiveNumber(update.total);
  if (trackedSize !== undefined) {
    trackedModelSizes.set(
      modelId,
      Math.max(trackedSize, trackedModelSizes.get(modelId) ?? 0),
    );
  }

  try {
    chrome.runtime.sendMessage({
      type: 'modelProgress',
      modelId,
      ...update,
    });
  } catch {
    // Popup may be closed
  }
}

export async function trackDownloadedModel(
  modelId: string,
  options: {
    name?: string;
    size?: number;
    lastUsed?: number;
  } = {},
): Promise<void> {
  const stored = await chrome.storage.local.get(['downloadedModels']) as {
    downloadedModels?: unknown[];
  };
  const trackedSize = readFinitePositiveNumber(options.size) ?? trackedModelSizes.get(modelId);

  await chrome.storage.local.set({
    downloadedModels: upsertDownloadedModelRecord(stored.downloadedModels, {
      id: modelId,
      name: options.name ?? getTrackedModelName(modelId),
      size: trackedSize,
      lastUsed: options.lastUsed ?? Date.now(),
    }),
  });
}

export function logDownloadedModelTrackingFailure(
  action: string,
  error: unknown,
): void {
  log.warn(`Failed to ${action}:`, error);
}
