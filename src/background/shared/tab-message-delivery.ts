import { extractErrorMessage } from '../../core/errors';
import type { ContentCommand } from '../../types';

export interface TabMessageDeliveryLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface CreateTabMessageSenderOptions {
  log: TabMessageDeliveryLogger;
  sendMessage: (tabId: number, message: ContentCommand) => Promise<unknown>;
  injectContentScript: (tabId: number) => Promise<unknown>;
  waitForContentScriptReady: () => Promise<void>;
  unavailablePagePrefix?: string;
}

export function isRecoverableContentScriptConnectionError(message: string): boolean {
  return message.includes('establish connection') || message.includes('Receiving end does not exist');
}

export function createTabMessageSender({
  log,
  sendMessage,
  injectContentScript,
  waitForContentScriptReady,
  unavailablePagePrefix = 'Translation not available on this page.',
}: CreateTabMessageSenderOptions) {
  return async (tabId: number, message: ContentCommand): Promise<void> => {
    try {
      await sendMessage(tabId, message);
    } catch (firstError) {
      const errMsg = extractErrorMessage(firstError);

      if (!isRecoverableContentScriptConnectionError(errMsg)) {
        throw firstError;
      }

      log.info(`Content script not ready in tab ${tabId}, injecting...`);

      try {
        await injectContentScript(tabId);
        await waitForContentScriptReady();
        await sendMessage(tabId, message);
        log.info(`Message delivered to tab ${tabId} after injection`);
      } catch (injectError) {
        const injectMsg = extractErrorMessage(injectError);
        log.warn(`Cannot inject content script into tab ${tabId}: ${injectMsg}`);
        throw new Error(`${unavailablePagePrefix} ${injectMsg}`);
      }
    }
  };
}
