import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionSettings } from './message-handlers';
import {
  createContextMenuClickHandler,
  createKeyboardShortcutHandler,
  resolveContentCommand,
  type UIEventHandlerDependencies,
} from './ui-event-handlers';

const DEFAULT_SETTINGS: ActionSettings = {
  sourceLang: 'en',
  targetLang: 'fi',
  strategy: 'smart',
  provider: 'opus-mt',
};

function createDependencies(
  overrides: Partial<UIEventHandlerDependencies> = {},
): {
  dependencies: UIEventHandlerDependencies;
  getActionSettings: ReturnType<typeof vi.fn>;
  sendMessageToTab: ReturnType<typeof vi.fn>;
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
} {
  const getActionSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
  const sendMessageToTab = vi.fn().mockResolvedValue(undefined);
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
  };

  return {
    dependencies: {
      getActionSettings,
      sendMessageToTab,
      log,
      ...overrides,
    },
    getActionSettings,
    sendMessageToTab,
    log,
  };
}

describe('resolveContentCommand', () => {
  it('builds translation commands with shared action settings', () => {
    expect(resolveContentCommand('translate-selection', DEFAULT_SETTINGS)).toEqual({
      type: 'translateSelection',
      ...DEFAULT_SETTINGS,
    });

    expect(resolveContentCommand('translate-page', DEFAULT_SETTINGS)).toEqual({
      type: 'translatePage',
      ...DEFAULT_SETTINGS,
    });

    expect(
      resolveContentCommand('translate-image', DEFAULT_SETTINGS, {
        imageUrl: 'https://example.com/image.png',
      }),
    ).toEqual({
      type: 'translateImage',
      imageUrl: 'https://example.com/image.png',
      ...DEFAULT_SETTINGS,
    });
  });

  it('builds non-translation commands without settings payloads', () => {
    expect(resolveContentCommand('undo-translation', DEFAULT_SETTINGS)).toEqual({
      type: 'undoTranslation',
    });

    expect(resolveContentCommand('toggle-widget', DEFAULT_SETTINGS)).toEqual({
      type: 'toggleWidget',
    });

    expect(resolveContentCommand('screenshot-translate', DEFAULT_SETTINGS)).toEqual({
      type: 'enterScreenshotMode',
    });
  });

  it('returns undefined for unknown command ids', () => {
    expect(resolveContentCommand('unknown-command', DEFAULT_SETTINGS)).toBeUndefined();
    expect(resolveContentCommand(123, DEFAULT_SETTINGS)).toBeUndefined();
  });
});

describe('createContextMenuClickHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches translate-image with existing message shape', async () => {
    const { dependencies, getActionSettings, sendMessageToTab } = createDependencies();
    const handler = createContextMenuClickHandler(dependencies);

    await handler(
      {
        menuItemId: 'translate-image',
        srcUrl: 'https://example.com/image.png',
      } as chrome.contextMenus.OnClickData,
      { id: 42 } as chrome.tabs.Tab,
    );

    expect(getActionSettings).toHaveBeenCalledOnce();
    expect(sendMessageToTab).toHaveBeenCalledWith(42, {
      type: 'translateImage',
      imageUrl: 'https://example.com/image.png',
      ...DEFAULT_SETTINGS,
    });
  });

  it('does nothing when the tab id is missing', async () => {
    const { dependencies, getActionSettings, sendMessageToTab } = createDependencies();
    const handler = createContextMenuClickHandler(dependencies);

    await handler(
      { menuItemId: 'translate-page' } as chrome.contextMenus.OnClickData,
      {} as chrome.tabs.Tab,
    );

    expect(getActionSettings).not.toHaveBeenCalled();
    expect(sendMessageToTab).not.toHaveBeenCalled();
  });

  it('keeps unknown menu items as no-ops after loading settings', async () => {
    const { dependencies, getActionSettings, sendMessageToTab } = createDependencies();
    const handler = createContextMenuClickHandler(dependencies);

    await handler(
      { menuItemId: 'unknown-item' } as chrome.contextMenus.OnClickData,
      { id: 7 } as chrome.tabs.Tab,
    );

    expect(getActionSettings).toHaveBeenCalledOnce();
    expect(sendMessageToTab).not.toHaveBeenCalled();
  });

  it('logs warning when dispatch fails', async () => {
    const { dependencies, log } = createDependencies({
      sendMessageToTab: vi.fn().mockRejectedValue(new Error('Cannot inject script')),
    });
    const handler = createContextMenuClickHandler(dependencies);

    await handler(
      { menuItemId: 'translate-selection' } as chrome.contextMenus.OnClickData,
      { id: 9 } as chrome.tabs.Tab,
    );

    expect(log.warn).toHaveBeenCalledWith(
      'Context menu action failed:',
      expect.any(Error),
    );
  });
});

describe('createKeyboardShortcutHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches keyboard shortcuts with existing message shapes', async () => {
    const { dependencies, log, sendMessageToTab } = createDependencies();
    const handler = createKeyboardShortcutHandler(dependencies);

    await handler('toggle-widget', { id: 12 } as chrome.tabs.Tab);
    await handler('screenshot-translate', { id: 13 } as chrome.tabs.Tab);

    expect(log.info).toHaveBeenNthCalledWith(1, 'Command received:', 'toggle-widget');
    expect(log.info).toHaveBeenNthCalledWith(
      2,
      'Command received:',
      'screenshot-translate',
    );
    expect(sendMessageToTab).toHaveBeenNthCalledWith(1, 12, {
      type: 'toggleWidget',
    });
    expect(sendMessageToTab).toHaveBeenNthCalledWith(2, 13, {
      type: 'enterScreenshotMode',
    });
  });

  it('logs the received command before returning on missing tab ids', async () => {
    const { dependencies, log, getActionSettings, sendMessageToTab } = createDependencies();
    const handler = createKeyboardShortcutHandler(dependencies);

    await handler('translate-page', {} as chrome.tabs.Tab);

    expect(log.info).toHaveBeenCalledWith('Command received:', 'translate-page');
    expect(getActionSettings).not.toHaveBeenCalled();
    expect(sendMessageToTab).not.toHaveBeenCalled();
  });

  it('keeps unknown commands as no-ops after loading settings', async () => {
    const { dependencies, getActionSettings, sendMessageToTab } = createDependencies();
    const handler = createKeyboardShortcutHandler(dependencies);

    await handler('unknown-command', { id: 21 } as chrome.tabs.Tab);

    expect(getActionSettings).toHaveBeenCalledOnce();
    expect(sendMessageToTab).not.toHaveBeenCalled();
  });

  it('logs warning when keyboard shortcut dispatch fails', async () => {
    const { dependencies, log } = createDependencies({
      sendMessageToTab: vi.fn().mockRejectedValue(new Error('Tab not found')),
    });
    const handler = createKeyboardShortcutHandler(dependencies);

    await handler('translate-page', { id: 22 } as chrome.tabs.Tab);

    expect(log.warn).toHaveBeenCalledWith(
      'Keyboard shortcut action failed:',
      expect.any(Error),
    );
  });
});
