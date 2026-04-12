import type { ContentCommand } from '../../types';
import type { ActionSettings } from './message-handlers';

export type TabActionId =
  | 'translate-selection'
  | 'translate-page'
  | 'undo-translation'
  | 'translate-image'
  | 'toggle-widget'
  | 'screenshot-translate';

export interface TabActionMessageOptions {
  imageUrl?: string;
}

export function buildTabActionMessage(
  action: TabActionId,
  settings: ActionSettings,
  options: TabActionMessageOptions = {}
): ContentCommand {
  switch (action) {
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
  }
}
