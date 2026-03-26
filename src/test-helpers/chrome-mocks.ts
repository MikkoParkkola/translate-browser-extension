import { vi } from 'vitest';

type ChromeMockFn = ReturnType<typeof vi.fn>;

interface ChromeEventMock {
  addListener: ChromeMockFn;
  removeListener: ChromeMockFn;
  hasListener: ChromeMockFn;
}

interface ChromeStorageAreaMock {
  get: ChromeMockFn;
  set: ChromeMockFn;
  remove: ChromeMockFn;
  clear: ChromeMockFn;
}

interface ChromeStorageAreaOptions {
  get?: ChromeMockFn;
  set?: ChromeMockFn;
  remove?: ChromeMockFn;
  clear?: ChromeMockFn;
}

function normalizeKeys(keys?: string | string[] | null): string[] | null {
  if (keys == null) return null;
  return Array.isArray(keys) ? keys : [keys];
}

function readStorage(
  storageState: Record<string, unknown>,
  keys?: string | string[] | null,
) {
  const keyList = normalizeKeys(keys);

  if (keyList === null) {
    return { ...storageState };
  }

  const result: Record<string, unknown> = {};
  for (const key of keyList) {
    if (storageState[key] !== undefined) {
      result[key] = storageState[key];
    }
  }

  return result;
}

function createChromeEventMock(
  overrides: Partial<ChromeEventMock> = {},
): ChromeEventMock {
  return {
    addListener: overrides.addListener ?? vi.fn(),
    removeListener: overrides.removeListener ?? vi.fn(),
    hasListener: overrides.hasListener ?? vi.fn().mockReturnValue(false),
  };
}

function createStorageAreaMock(
  storageState: Record<string, unknown>,
  options: ChromeStorageAreaOptions = {},
): ChromeStorageAreaMock {
  return {
    get:
      options.get ??
      vi.fn((keys?: string | string[] | null, callback?: (value: Record<string, unknown>) => void) => {
        const result = readStorage(storageState, keys);
        if (typeof callback === 'function') {
          callback(result);
        }
        return Promise.resolve(result);
      }),
    set:
      options.set ??
      vi.fn((items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(storageState, items);
        if (typeof callback === 'function') {
          callback();
        }
        return Promise.resolve();
      }),
    remove:
      options.remove ??
      vi.fn((keys: string | string[], callback?: () => void) => {
        for (const key of normalizeKeys(keys) ?? []) {
          delete storageState[key];
        }
        if (typeof callback === 'function') {
          callback();
        }
        return Promise.resolve();
      }),
    clear:
      options.clear ??
      vi.fn((callback?: () => void) => {
        Object.keys(storageState).forEach((key) => delete storageState[key]);
        if (typeof callback === 'function') {
          callback();
        }
        return Promise.resolve();
      }),
  };
}

export interface ChromeApiMockOptions {
  runtime?: {
    sendMessage?: ChromeMockFn;
    openOptionsPage?: ChromeMockFn;
    getURL?: ChromeMockFn;
    getContexts?: ChromeMockFn;
    onMessage?: Partial<ChromeEventMock>;
    onInstalled?: Partial<ChromeEventMock>;
    onStartup?: Partial<ChromeEventMock>;
    onConnect?: Partial<ChromeEventMock>;
    lastError?: unknown;
    ContextType?: Record<string, string>;
  };
  storage?: {
    localState?: Record<string, unknown>;
    syncState?: Record<string, unknown>;
    local?: ChromeStorageAreaOptions;
    sync?: ChromeStorageAreaOptions;
  };
  tabs?: {
    create?: ChromeMockFn;
    query?: ChromeMockFn;
    sendMessage?: ChromeMockFn;
    onUpdated?: Partial<ChromeEventMock>;
  };
  scripting?: {
    executeScript?: ChromeMockFn;
  };
  action?: {
    onClicked?: Partial<ChromeEventMock>;
  };
  contextMenus?: {
    create?: ChromeMockFn;
    removeAll?: ChromeMockFn;
    onClicked?: Partial<ChromeEventMock>;
  };
  commands?: {
    onCommand?: Partial<ChromeEventMock>;
  };
  offscreen?: {
    createDocument?: ChromeMockFn;
    closeDocument?: ChromeMockFn;
    Reason?: Record<string, string>;
  };
  i18n?: {
    getUILanguage?: ChromeMockFn;
  };
}

export function createChromeApiMock(options: ChromeApiMockOptions = {}) {
  const localStorageState = { ...(options.storage?.localState ?? {}) };
  const syncStorageState = { ...(options.storage?.syncState ?? {}) };

  const chromeMock = {
    runtime: {
      sendMessage: options.runtime?.sendMessage ?? vi.fn().mockResolvedValue({}),
      onMessage: createChromeEventMock(options.runtime?.onMessage),
      onInstalled: createChromeEventMock(options.runtime?.onInstalled),
      onStartup: createChromeEventMock(options.runtime?.onStartup),
      onConnect: createChromeEventMock(options.runtime?.onConnect),
      openOptionsPage: options.runtime?.openOptionsPage ?? vi.fn(),
      getURL:
        options.runtime?.getURL ??
        vi.fn((path: string) => `chrome-extension://test-id/${path}`),
      getContexts: options.runtime?.getContexts ?? vi.fn().mockResolvedValue([]),
      lastError: options.runtime?.lastError ?? null,
      ContextType: options.runtime?.ContextType ?? {},
    },
    storage: {
      local: createStorageAreaMock(
        localStorageState,
        options.storage?.local,
      ),
      sync: createStorageAreaMock(syncStorageState, options.storage?.sync),
    },
    tabs: {
      create: options.tabs?.create ?? vi.fn(),
      query: options.tabs?.query ?? vi.fn().mockResolvedValue([]),
      sendMessage: options.tabs?.sendMessage ?? vi.fn().mockResolvedValue({}),
      onUpdated: createChromeEventMock(options.tabs?.onUpdated),
    },
    scripting: {
      executeScript:
        options.scripting?.executeScript ?? vi.fn().mockResolvedValue(undefined),
    },
    action: {
      onClicked: createChromeEventMock(options.action?.onClicked),
    },
    contextMenus: {
      create: options.contextMenus?.create ?? vi.fn(),
      removeAll:
        options.contextMenus?.removeAll ??
        vi.fn((callback?: () => void) => {
          if (typeof callback === 'function') {
            callback();
          }
        }),
      onClicked: createChromeEventMock(options.contextMenus?.onClicked),
    },
    commands: {
      onCommand: createChromeEventMock(options.commands?.onCommand),
    },
    offscreen: {
      createDocument:
        options.offscreen?.createDocument ?? vi.fn().mockResolvedValue(undefined),
      closeDocument:
        options.offscreen?.closeDocument ?? vi.fn().mockResolvedValue(undefined),
      Reason: options.offscreen?.Reason ?? {},
    },
    i18n: {
      getUILanguage:
        options.i18n?.getUILanguage ?? vi.fn(() => 'en-US'),
    },
  };

  return {
    chrome: chromeMock,
    storageState: {
      local: localStorageState,
      sync: syncStorageState,
    },
    events: {
      runtime: {
        onMessage: chromeMock.runtime.onMessage,
        onInstalled: chromeMock.runtime.onInstalled,
        onStartup: chromeMock.runtime.onStartup,
        onConnect: chromeMock.runtime.onConnect,
      },
      action: {
        onClicked: chromeMock.action.onClicked,
      },
      tabs: {
        onUpdated: chromeMock.tabs.onUpdated,
      },
      contextMenus: {
        onClicked: chromeMock.contextMenus.onClicked,
      },
      commands: {
        onCommand: chromeMock.commands.onCommand,
      },
    },
  };
}

export function setupChromeApiMock(options: ChromeApiMockOptions = {}) {
  const chromeMock = createChromeApiMock(options);
  vi.stubGlobal('chrome', chromeMock.chrome);
  return chromeMock;
}

export interface UiChromeMockOptions {
  runtimeSendMessage?: ChromeMockFn;
  runtimeOpenOptionsPage?: ChromeMockFn;
  runtimeOnMessageAddListener?: ChromeMockFn;
  runtimeOnMessageRemoveListener?: ChromeMockFn;
  storageLocalGet?: ChromeMockFn;
  storageLocalSet?: ChromeMockFn;
  storageLocalRemove?: ChromeMockFn;
  storageSyncGet?: ChromeMockFn;
  storageSyncSet?: ChromeMockFn;
  tabsQuery?: ChromeMockFn;
  tabsSendMessage?: ChromeMockFn;
  scriptingExecuteScript?: ChromeMockFn;
}

export function createUiChromeMock(options: UiChromeMockOptions = {}) {
  return createChromeApiMock({
    runtime: {
      sendMessage: options.runtimeSendMessage,
      openOptionsPage: options.runtimeOpenOptionsPage,
      onMessage: {
        addListener: options.runtimeOnMessageAddListener,
        removeListener: options.runtimeOnMessageRemoveListener,
      },
    },
    storage: {
      local: {
        get: options.storageLocalGet,
        set: options.storageLocalSet,
        remove: options.storageLocalRemove,
      },
      sync: {
        get: options.storageSyncGet,
        set: options.storageSyncSet,
      },
    },
    tabs: {
      query: options.tabsQuery,
      sendMessage: options.tabsSendMessage,
    },
    scripting: {
      executeScript: options.scriptingExecuteScript,
    },
  }).chrome;
}

export function setupUiChromeMock(options: UiChromeMockOptions = {}) {
  const chromeMock = createUiChromeMock(options);
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}
