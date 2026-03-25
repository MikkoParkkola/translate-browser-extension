import { createLogger } from '../core/logger';
import { sendBackgroundMessage } from '../shared/background-message';
import { deriveDownloadedModelName } from '../shared/downloaded-models';
import type {
  MessageResponse,
  ModelProgressMessage,
  OffscreenDownloadedModelUpdateMessage,
  OffscreenModelProgressMessage,
} from '../types';

const log = createLogger('ModelDownloadTracker');
const trackedModelSizes = new Map<string, number>();

function readFinitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

async function sendBackgroundModelMessage(
  message: OffscreenModelProgressMessage | OffscreenDownloadedModelUpdateMessage,
): Promise<void> {
  const response = await sendBackgroundMessage<MessageResponse | undefined>(message);
  if (response && !response.success) {
    throw new Error(
      typeof response.error === 'string'
        ? response.error
        : 'Background model message failed',
    );
  }
}

export function reportModelProgress(
  modelId: string,
  update: Omit<ModelProgressMessage, 'type' | 'modelId' | 'target'>,
): void {
  const trackedSize = readFinitePositiveNumber(update.total);
  if (trackedSize !== undefined) {
    trackedModelSizes.set(
      modelId,
      Math.max(trackedSize, trackedModelSizes.get(modelId) ?? 0),
    );
  }

  void sendBackgroundModelMessage({
    type: 'offscreenModelProgress',
    target: 'background',
    modelId,
    ...update,
  } satisfies OffscreenModelProgressMessage).catch((error) => {
    logDownloadedModelTrackingFailure('report model progress', error);
  });
}

export async function trackDownloadedModel(
  modelId: string,
  options: {
    name?: string;
    size?: number;
    lastUsed?: number;
  } = {},
): Promise<void> {
  const trackedSize = readFinitePositiveNumber(options.size) ?? trackedModelSizes.get(modelId);
  await sendBackgroundModelMessage({
    type: 'offscreenDownloadedModelUpdate',
    target: 'background',
    modelId,
    name: options.name ?? deriveDownloadedModelName(modelId),
    size: trackedSize,
    lastUsed: options.lastUsed ?? Date.now(),
  } satisfies OffscreenDownloadedModelUpdateMessage);
}

export function logDownloadedModelTrackingFailure(
  action: string,
  error: unknown,
): void {
  log.warn(`Failed to ${action}:`, error);
}
