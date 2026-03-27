import { vi } from 'vitest';
import {
  createStorageAreaMock,
  type ChromeStorageAreaOptions,
} from './chrome-mocks';
import {
  collectMockResetters,
  registerGlobalFixture,
  resetMutableRecord,
} from './global-fixture-registry';

type MockFn = ReturnType<typeof vi.fn>;
type Listener = (...args: any[]) => unknown;
type ListenerImplementation<TListener extends Listener> = (
  listener: TListener,
) => unknown;

type ChromeEventRecord = {
  addListener?: unknown;
  removeListener?: unknown;
  hasListener?: unknown;
};

type ChromeLike = Record<string, any> & {
  runtime?: Record<string, any>;
  tabs?: Record<string, any>;
  storage?: Record<string, any> & {
    local?: Record<string, any>;
  };
  action?: Record<string, any>;
  browserAction?: Record<string, any>;
  commands?: Record<string, any>;
  contextMenus?: Record<string, any>;
};

interface CapturedChromeEvent<TListener extends Listener> {
  addListener: MockFn;
  removeListener: MockFn;
  hasListener: MockFn;
  listeners: TListener[];
  getLatestListener(): TListener | undefined;
  reset(): void;
}

export interface ChromeRuntimeMessagingMockOptions {
  chromeApi?: ChromeLike;
  runtime?: {
    sendMessage?: MockFn;
  };
  tabs?: {
    sendMessage?: MockFn;
  };
  storage?: {
    localState?: Record<string, unknown>;
    local?: ChromeStorageAreaOptions;
  };
}

function ensureRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const currentValue = record[key];

  if (currentValue && typeof currentValue === 'object') {
    return currentValue as Record<string, unknown>;
  }

  const created: Record<string, unknown> = {};
  record[key] = created;
  return created;
}

function ensureMock(
  record: Record<string, unknown>,
  key: string,
  fallback: MockFn,
): MockFn {
  const currentValue = record[key];

  if (typeof currentValue === 'function' && vi.isMockFunction(currentValue)) {
    return currentValue as MockFn;
  }

  if (typeof currentValue === 'function') {
    const wrapped = vi.fn(currentValue as (...args: unknown[]) => unknown);
    record[key] = wrapped;
    return wrapped;
  }

  record[key] = fallback;
  return fallback;
}

function createCapturedEvent<TListener extends Listener>(
  record: Record<string, unknown>,
  key: string,
): CapturedChromeEvent<TListener> {
  const event = ensureRecord(record, key) as ChromeEventRecord;
  const listeners: TListener[] = [];

  const addListener = ensureMock(
    event as Record<string, unknown>,
    'addListener',
    vi.fn(),
  );
  const removeListener = ensureMock(
    event as Record<string, unknown>,
    'removeListener',
    vi.fn(),
  );
  const hasListener = ensureMock(
    event as Record<string, unknown>,
    'hasListener',
    vi.fn(),
  );

  const initialAddImplementation = addListener.getMockImplementation?.() as
    | ListenerImplementation<TListener>
    | undefined;
  const initialRemoveImplementation = removeListener.getMockImplementation?.() as
    | ListenerImplementation<TListener>
    | undefined;
  const initialHasImplementation = hasListener.getMockImplementation?.() as
    | ListenerImplementation<TListener>
    | undefined;

  const applyImplementations = () => {
    addListener.mockImplementation((listener: TListener) => {
      listeners.push(listener);
      return initialAddImplementation?.(listener);
    });

    removeListener.mockImplementation((listener: TListener) => {
      const index = listeners.lastIndexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
      return initialRemoveImplementation?.(listener);
    });

    hasListener.mockImplementation((listener: TListener) => {
      if (initialHasImplementation) {
        return initialHasImplementation(listener);
      }
      return listeners.includes(listener);
    });
  };

  applyImplementations();

  return {
    addListener,
    removeListener,
    hasListener,
    listeners,
    getLatestListener: () => listeners[listeners.length - 1],
    reset() {
      event.addListener = addListener;
      event.removeListener = removeListener;
      event.hasListener = hasListener;
      addListener.mockReset();
      removeListener.mockReset();
      hasListener.mockReset();
      applyImplementations();
    },
  };
}

export function setupChromeRuntimeMessagingMocks(
  options: ChromeRuntimeMessagingMockOptions = {},
) {
  const chromeApi = (options.chromeApi ?? globalThis.chrome) as ChromeLike;
  const runtime = (chromeApi.runtime ??= {});
  const tabs = (chromeApi.tabs ??= {});
  const storage = (chromeApi.storage ??= {});
  const localStorage = (storage.local ??= {});
  const action = (chromeApi.action ??= {});
  const browserAction = (chromeApi.browserAction ??= {});
  const commands = (chromeApi.commands ??= {});
  const contextMenus = (chromeApi.contextMenus ??= {});

  const localState = { ...(options.storage?.localState ?? {}) };
  const initialLocalState = { ...localState };
  const fallbackStorageArea = createStorageAreaMock(
    localState,
    options.storage?.local,
  );

  const runtimeSendMessage = ensureMock(
    runtime,
    'sendMessage',
    options.runtime?.sendMessage ?? vi.fn().mockResolvedValue({}),
  );
  const tabsSendMessage = ensureMock(
    tabs,
    'sendMessage',
    options.tabs?.sendMessage ?? vi.fn().mockResolvedValue({}),
  );
  const storageGet = ensureMock(
    localStorage,
    'get',
    fallbackStorageArea.get,
  );
  const storageSet = ensureMock(
    localStorage,
    'set',
    fallbackStorageArea.set,
  );
  const storageRemove = ensureMock(
    localStorage,
    'remove',
    fallbackStorageArea.remove,
  );
  const storageClear = ensureMock(
    localStorage,
    'clear',
    fallbackStorageArea.clear,
  );

  const runtimeOnMessage = createCapturedEvent(runtime, 'onMessage');
  const runtimeOnInstalled = createCapturedEvent(runtime, 'onInstalled');
  const runtimeOnStartup = createCapturedEvent(runtime, 'onStartup');
  const runtimeOnConnect = createCapturedEvent(runtime, 'onConnect');
  const tabsOnUpdated = createCapturedEvent(tabs, 'onUpdated');
  const actionOnClicked = createCapturedEvent(action, 'onClicked');
  const browserActionOnClicked = createCapturedEvent(browserAction, 'onClicked');
  const commandsOnCommand = createCapturedEvent(commands, 'onCommand');
  const contextMenusOnClicked = createCapturedEvent(contextMenus, 'onClicked');

  const mockResetters = collectMockResetters({
    runtimeSendMessage,
    tabsSendMessage,
    storage: {
      get: storageGet,
      set: storageSet,
      remove: storageRemove,
      clear: storageClear,
    },
  });

  const resetEventMocks = [
    runtimeOnMessage,
    runtimeOnInstalled,
    runtimeOnStartup,
    runtimeOnConnect,
    tabsOnUpdated,
    actionOnClicked,
    browserActionOnClicked,
    commandsOnCommand,
    contextMenusOnClicked,
  ];

  registerGlobalFixture('chrome-runtime-messaging', () => {
    mockResetters.forEach((resetMock) => resetMock());
    resetMutableRecord(localState, initialLocalState);
    runtime.sendMessage = runtimeSendMessage;
    tabs.sendMessage = tabsSendMessage;
    localStorage.get = storageGet;
    localStorage.set = storageSet;
    localStorage.remove = storageRemove;
    localStorage.clear = storageClear;

    resetEventMocks.forEach((eventMock) => {
      eventMock.reset();
    });
  });

  return {
    chrome: chromeApi,
    runtime: {
      sendMessage: runtimeSendMessage,
      onMessage: runtimeOnMessage,
      onInstalled: runtimeOnInstalled,
      onStartup: runtimeOnStartup,
      onConnect: runtimeOnConnect,
    },
    tabs: {
      sendMessage: tabsSendMessage,
      onUpdated: tabsOnUpdated,
    },
    action: {
      onClicked: actionOnClicked,
    },
    browserAction: {
      onClicked: browserActionOnClicked,
    },
    commands: {
      onCommand: commandsOnCommand,
    },
    contextMenus: {
      onClicked: contextMenusOnClicked,
    },
    storage: {
      state: localState,
      local: {
        get: storageGet,
        set: storageSet,
        remove: storageRemove,
        clear: storageClear,
      },
    },
  };
}
