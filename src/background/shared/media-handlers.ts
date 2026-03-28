import { extractErrorMessage } from '../../core/errors';
import type {
  CaptureScreenshotMessage,
  DeleteModelMessage,
  ExtensionMessageResponseByType,
  OCRImageMessage,
} from '../../types';
import type { OffscreenTransport } from './offscreen-transport';

export interface MediaHandlersLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface MediaHandlers {
  handleDeleteModel: (
    message: DeleteModelMessage
  ) => Promise<ExtensionMessageResponseByType<'deleteModel'>>;
  handleClearAllModels: () => Promise<ExtensionMessageResponseByType<'clearAllModels'>>;
  handleOCRImage: (
    message: OCRImageMessage
  ) => Promise<ExtensionMessageResponseByType<'ocrImage'>>;
  handleCaptureScreenshot: (
    message: CaptureScreenshotMessage
  ) => Promise<ExtensionMessageResponseByType<'captureScreenshot'>>;
}

export interface CreateMediaHandlersOptions {
  offscreenTransport: Pick<OffscreenTransport, 'send'>;
  captureVisibleTab: (options: { format: 'png' }) => Promise<string>;
  deleteDownloadedModelInventoryEntry: (modelId: string) => Promise<unknown>;
  clearDownloadedModelInventory: () => Promise<void>;
  clearMatchingCaches: (patterns: readonly string[]) => Promise<string[] | null>;
  log: MediaHandlersLogger;
}

async function tryClearOffscreenPipelineCache(
  offscreenTransport: Pick<OffscreenTransport, 'send'>,
  log: MediaHandlersLogger
): Promise<void> {
  try {
    await offscreenTransport.send({ type: 'clearPipelineCache' });
  } catch {
    /* v8 ignore start */
    log.warn('Could not clear offscreen pipeline cache (may not be running)');
    /* v8 ignore stop */
  }
}

export function createMediaHandlers({
  offscreenTransport,
  captureVisibleTab,
  deleteDownloadedModelInventoryEntry,
  clearDownloadedModelInventory,
  clearMatchingCaches,
  log,
}: CreateMediaHandlersOptions): MediaHandlers {
  async function handleDeleteModel(
    message: DeleteModelMessage
  ): Promise<ExtensionMessageResponseByType<'deleteModel'>> {
    const { modelId } = message;
    log.info(`Deleting model: ${modelId}`);

    try {
      await tryClearOffscreenPipelineCache(offscreenTransport, log);
      await deleteDownloadedModelInventoryEntry(modelId);

      log.info(`Model ${modelId} deleted`);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete model:', error);
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  async function handleClearAllModels(): Promise<
    ExtensionMessageResponseByType<'clearAllModels'>
  > {
    log.info('Clearing all downloaded models...');

    try {
      await tryClearOffscreenPipelineCache(offscreenTransport, log);
      await clearDownloadedModelInventory();

      try {
        const clearedCaches = await clearMatchingCaches(['transformers', 'onnx', 'model']);
        if (clearedCaches === null) {
          log.info('CacheStorage unavailable in service worker; skipping model cache cleanup');
        } else {
          for (const name of clearedCaches) {
            log.info(`Cleared cache: ${name}`);
          }
          log.info(`Cleared ${clearedCaches.length} model caches`);
        }
      } catch (cacheError) {
        log.warn('Model cache cleanup failed:', cacheError);
      }

      log.info('All models cleared');
      return { success: true };
    } catch (error) {
      log.error('Failed to clear all models:', error);
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  async function handleOCRImage(
    message: OCRImageMessage
  ): Promise<ExtensionMessageResponseByType<'ocrImage'>> {
    try {
      log.info('Processing OCR request...');

      const result = await offscreenTransport.send<'ocrImage'>({
        type: 'ocrImage',
        imageData: message.imageData,
        lang: message.lang,
      });

      if (result.success) {
        log.info(
          `OCR completed: ${result.blocks?.length || 0} blocks, ${result.confidence?.toFixed(1)}% confidence`
        );
      }

      return result;
    } catch (error) {
      log.error('OCR failed:', error);
      return { success: false, error: extractErrorMessage(error) };
    }
  }

  async function handleCaptureScreenshot(
    message: CaptureScreenshotMessage
  ): Promise<ExtensionMessageResponseByType<'captureScreenshot'>> {
    try {
      const dataUrl = await captureVisibleTab({ format: 'png' });

      if (message.rect) {
        const cropResponse = await offscreenTransport.send<'cropImage'>({
          type: 'cropImage',
          imageData: dataUrl,
          rect: message.rect,
          devicePixelRatio: message.devicePixelRatio || 1,
        });

        return {
          success: true,
          imageData: cropResponse.success ? cropResponse.imageData : dataUrl,
        };
      }

      return { success: true, imageData: dataUrl };
    } catch (error) {
      log.error('Screenshot capture failed:', error);
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  return {
    handleDeleteModel,
    handleClearAllModels,
    handleOCRImage,
    handleCaptureScreenshot,
  };
}
