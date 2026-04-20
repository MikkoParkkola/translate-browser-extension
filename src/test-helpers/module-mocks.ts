import { vi } from 'vitest';
import { createBrowserApiModuleExports } from './browser-api-mocks';

type MockFn = ReturnType<typeof vi.fn>;

export function createLoggerModuleMock() {
  return {
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
}

export interface BrowserApiModuleMockOptions {
  runtimeSendMessage?: MockFn;
  runtimeGetURL?: (path: string) => string;
  runtimeOnMessageAddListener?: MockFn;
  runtimeOnMessageRemoveListener?: MockFn;
  runtimeOpenOptionsPage?: MockFn;
  storageLocalGet?: MockFn;
  storageLocalSet?: MockFn;
  storageLocalRemove?: MockFn;
  storageLocalClear?: MockFn;
  tabsQuery?: MockFn;
  tabsSendMessage?: MockFn;
  scriptingExecuteScript?: MockFn;
  i18nGetUILanguage?: MockFn | (() => string);
  includeSendMessageExport?: boolean;
}

export function createBrowserApiModuleMock(
  options: BrowserApiModuleMockOptions = {},
) {
  const browserAPI: Record<string, unknown> = {};

  const hasRuntimeMock =
    options.runtimeSendMessage !== undefined ||
    options.runtimeGetURL !== undefined ||
    options.runtimeOnMessageAddListener !== undefined ||
    options.runtimeOnMessageRemoveListener !== undefined ||
    options.runtimeOpenOptionsPage !== undefined ||
    options.includeSendMessageExport;

  if (hasRuntimeMock) {
    const runtime: Record<string, unknown> = {};

    if (options.runtimeSendMessage !== undefined) {
      runtime.sendMessage = options.runtimeSendMessage;
    }

    if (options.runtimeGetURL !== undefined) {
      runtime.getURL = options.runtimeGetURL;
    }

    if (
      options.runtimeOnMessageAddListener !== undefined ||
      options.runtimeOnMessageRemoveListener !== undefined
    ) {
      runtime.onMessage = {
        addListener: options.runtimeOnMessageAddListener ?? vi.fn(),
        removeListener: options.runtimeOnMessageRemoveListener ?? vi.fn(),
      };
    }

    if (options.runtimeOpenOptionsPage !== undefined) {
      runtime.openOptionsPage = options.runtimeOpenOptionsPage;
    }

    if (
      options.includeSendMessageExport &&
      options.runtimeSendMessage === undefined
    ) {
      runtime.sendMessage = vi.fn().mockResolvedValue({});
    }

    browserAPI.runtime = runtime;
  }

  if (
    options.storageLocalGet !== undefined ||
    options.storageLocalSet !== undefined ||
    options.storageLocalRemove !== undefined ||
    options.storageLocalClear !== undefined
  ) {
    browserAPI.storage = {
      local: {
        ...(options.storageLocalGet !== undefined
          ? { get: options.storageLocalGet }
          : {}),
        ...(options.storageLocalSet !== undefined
          ? { set: options.storageLocalSet }
          : {}),
        ...(options.storageLocalRemove !== undefined
          ? { remove: options.storageLocalRemove }
          : {}),
        ...(options.storageLocalClear !== undefined
          ? { clear: options.storageLocalClear }
          : {}),
      },
    };
  }

  if (options.tabsQuery !== undefined || options.tabsSendMessage !== undefined) {
    browserAPI.tabs = {
      ...(options.tabsQuery !== undefined ? { query: options.tabsQuery } : {}),
      ...(options.tabsSendMessage !== undefined
        ? { sendMessage: options.tabsSendMessage }
        : {}),
    };
  }

  if (options.scriptingExecuteScript !== undefined) {
    browserAPI.scripting = {
      executeScript: options.scriptingExecuteScript,
    };
  }

  if (options.i18nGetUILanguage !== undefined) {
    browserAPI.i18n = {
      getUILanguage: options.i18nGetUILanguage,
    };
  }

  return createBrowserApiModuleExports({
    browserAPI,
    getURL: options.runtimeGetURL,
    sendMessage: options.runtimeSendMessage,
    includeSendMessageExport: options.includeSendMessageExport,
  });
}
