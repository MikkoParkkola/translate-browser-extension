import { vi } from 'vitest';

type UiChromeMockFn = ReturnType<typeof vi.fn>;

export interface UiChromeMockOptions {
  runtimeSendMessage?: UiChromeMockFn;
  runtimeOpenOptionsPage?: UiChromeMockFn;
  runtimeOnMessageAddListener?: UiChromeMockFn;
  runtimeOnMessageRemoveListener?: UiChromeMockFn;
  storageLocalGet?: UiChromeMockFn;
  storageLocalSet?: UiChromeMockFn;
  storageLocalRemove?: UiChromeMockFn;
  storageSyncGet?: UiChromeMockFn;
  storageSyncSet?: UiChromeMockFn;
  tabsQuery?: UiChromeMockFn;
  tabsSendMessage?: UiChromeMockFn;
  scriptingExecuteScript?: UiChromeMockFn;
}

export function createUiChromeMock(options: UiChromeMockOptions = {}) {
  return {
    runtime: {
      sendMessage: options.runtimeSendMessage ?? vi.fn().mockResolvedValue({}),
      onMessage: {
        addListener: options.runtimeOnMessageAddListener ?? vi.fn(),
        removeListener: options.runtimeOnMessageRemoveListener ?? vi.fn(),
      },
      openOptionsPage: options.runtimeOpenOptionsPage ?? vi.fn(),
    },
    storage: {
      local: {
        get: options.storageLocalGet ?? vi.fn().mockResolvedValue({}),
        set: options.storageLocalSet ?? vi.fn().mockResolvedValue(undefined),
        remove: options.storageLocalRemove ?? vi.fn().mockResolvedValue(undefined),
      },
      sync: {
        get: options.storageSyncGet ?? vi.fn().mockResolvedValue({}),
        set: options.storageSyncSet ?? vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      query: options.tabsQuery ?? vi.fn().mockResolvedValue([]),
      sendMessage: options.tabsSendMessage ?? vi.fn().mockResolvedValue({}),
    },
    scripting: {
      executeScript: options.scriptingExecuteScript ?? vi.fn().mockResolvedValue(undefined),
    },
  };
}

export function setupUiChromeMock(options: UiChromeMockOptions = {}) {
  const chromeMock = createUiChromeMock(options);
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}
