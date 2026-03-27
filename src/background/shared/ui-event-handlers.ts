import type { ContentCommand } from '../../types';

import type { ActionSettings } from './message-handlers';

export type UIEventCommandId =
  | 'translate-selection'
  | 'translate-page'
  | 'undo-translation'
  | 'translate-image'
  | 'toggle-widget'
  | 'screenshot-translate';

export interface UIEventLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface UIEventHandlerDependencies {
  getActionSettings: () => Promise<ActionSettings>;
  sendMessageToTab: (tabId: number, message: ContentCommand) => Promise<void>;
  log: UIEventLogger;
}

function resolveContentCommand(
  commandId: string | number,
  settings: ActionSettings,
  options: { imageUrl?: string } = {},
): ContentCommand | undefined {
  switch (commandId) {
    case 'translate-selection':
      return {
        type: 'translateSelection',
        ...settings,
      };

    case 'translate-page':
      return {
        type: 'translatePage',
        ...settings,
      };

    case 'undo-translation':
      return {
        type: 'undoTranslation',
      };

    case 'translate-image':
      return {
        type: 'translateImage',
        imageUrl: options.imageUrl,
        ...settings,
      };

    case 'toggle-widget':
      return {
        type: 'toggleWidget',
      };

    case 'screenshot-translate':
      return {
        type: 'enterScreenshotMode',
      };

    default:
      return undefined;
  }
}

export function createContextMenuClickHandler({
  getActionSettings,
  sendMessageToTab,
  log,
}: UIEventHandlerDependencies) {
  return async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> => {
    if (!tab?.id) return;

    const settings = await getActionSettings();

    try {
      const message = resolveContentCommand(info.menuItemId, settings, {
        imageUrl: info.srcUrl,
      });

      if (!message) return;

      await sendMessageToTab(tab.id, message);
    } catch (error) {
      log.warn('Context menu action failed:', error);
    }
  };
}

export function createKeyboardShortcutHandler({
  getActionSettings,
  sendMessageToTab,
  log,
}: UIEventHandlerDependencies) {
  return async (command: string, tab?: chrome.tabs.Tab): Promise<void> => {
    log.info('Command received:', command);

    if (!tab?.id) return;

    const settings = await getActionSettings();

    try {
      const message = resolveContentCommand(command, settings);

      if (!message) return;

      await sendMessageToTab(tab.id, message);
    } catch (error) {
      log.warn('Keyboard shortcut action failed:', error);
    }
  };
}

export { resolveContentCommand };
