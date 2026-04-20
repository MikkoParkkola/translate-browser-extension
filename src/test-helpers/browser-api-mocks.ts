import { vi } from 'vitest';
import {
  createChromeApiMock,
  type ChromeApiMockOptions,
} from './chrome-mocks';

type BrowserApiMockFn = ReturnType<typeof vi.fn>;

export type BrowserApiNamespace =
  | 'runtime'
  | 'storage'
  | 'tabs'
  | 'scripting'
  | 'i18n'
  | 'browserAction'
  | 'commands';

export interface BrowserApiMockOptions {
  runtime?: ChromeApiMockOptions['runtime'];
  storage?: ChromeApiMockOptions['storage'];
  tabs?: ChromeApiMockOptions['tabs'];
  scripting?: ChromeApiMockOptions['scripting'];
  i18n?: ChromeApiMockOptions['i18n'];
  browserAction?: ChromeApiMockOptions['action'];
  commands?: ChromeApiMockOptions['commands'];
  omit?: BrowserApiNamespace[];
}

export interface BrowserApiModuleExportsOptions {
  browserAPI: Record<string, unknown>;
  getURL?: (path: string) => string;
  sendMessage?: BrowserApiMockFn;
  includeSendMessageExport?: boolean;
  isFirefox?: boolean | (() => boolean);
  isChrome?: boolean | (() => boolean);
}

export interface BrowserApiModuleMockOptions extends BrowserApiMockOptions {
  getURL?: (path: string) => string;
  sendMessage?: BrowserApiMockFn;
  includeSendMessageExport?: boolean;
  isFirefox?: boolean;
  isChrome?: boolean;
}

type BrowserRuntimeLike = {
  getURL?: (path: string) => string;
  sendMessage?: BrowserApiMockFn;
  onMessage?: {
    addListener?: BrowserApiMockFn;
  };
};

type BrowserStorageLike = {
  local?: {
    get?: BrowserApiMockFn;
    set?: BrowserApiMockFn;
    remove?: BrowserApiMockFn;
    clear?: BrowserApiMockFn;
  };
};

function resolveBrowserFlag(
  value: boolean | (() => boolean) | undefined,
  fallback: boolean,
) {
  if (typeof value === 'function') {
    return value;
  }

  return () => value ?? fallback;
}

export function createBrowserApiMock(options: BrowserApiMockOptions = {}) {
  const chromeMock = createChromeApiMock({
    runtime: options.runtime,
    storage: options.storage,
    tabs: options.tabs,
    scripting: options.scripting,
    i18n: options.i18n,
    action: options.browserAction,
    commands: options.commands,
  }).chrome;

  const omittedNamespaces = new Set(options.omit ?? []);
  const browserAPI: Record<string, unknown> = {};

  if (!omittedNamespaces.has('runtime')) {
    browserAPI.runtime = chromeMock.runtime;
  }

  if (!omittedNamespaces.has('storage')) {
    browserAPI.storage = chromeMock.storage;
  }

  if (!omittedNamespaces.has('tabs')) {
    browserAPI.tabs = chromeMock.tabs;
  }

  if (!omittedNamespaces.has('scripting')) {
    browserAPI.scripting = chromeMock.scripting;
  }

  if (!omittedNamespaces.has('i18n')) {
    browserAPI.i18n = chromeMock.i18n;
  }

  if (!omittedNamespaces.has('browserAction')) {
    browserAPI.browserAction = chromeMock.action;
  }

  if (!omittedNamespaces.has('commands')) {
    browserAPI.commands = chromeMock.commands;
  }

  return browserAPI;
}

export function createBrowserApiModuleExports(
  options: BrowserApiModuleExportsOptions,
) {
  const runtime = (options.browserAPI.runtime ?? {}) as BrowserRuntimeLike;
  const storage = (options.browserAPI.storage ?? {}) as BrowserStorageLike;

  const getURL = options.getURL ?? runtime.getURL ?? vi.fn((path: string) => path);
  const sendMessage = options.sendMessage ?? runtime.sendMessage;
  const isFirefox = resolveBrowserFlag(options.isFirefox, false);
  const isChrome = resolveBrowserFlag(options.isChrome, !isFirefox());

  const moduleMock: Record<string, unknown> = {
    browserAPI: options.browserAPI,
    getURL,
    isFirefox,
    isChrome,
    getPlatform: () => {
      if (isFirefox()) return 'firefox';
      if (isChrome()) return 'chrome';
      return 'unknown';
    },
  };

  if (runtime.onMessage?.addListener) {
    moduleMock.onMessage = runtime.onMessage.addListener;
  }

  if (storage.local) {
    moduleMock.storage = {
      get: storage.local.get,
      set: storage.local.set,
      remove: storage.local.remove,
      clear: storage.local.clear,
    };
  }

  if (options.includeSendMessageExport) {
    moduleMock.sendMessage =
      sendMessage ?? vi.fn().mockResolvedValue({});
  }

  return moduleMock;
}

export function createBrowserApiModuleMock(
  options: BrowserApiModuleMockOptions = {},
) {
  const browserAPI = createBrowserApiMock(options);

  return createBrowserApiModuleExports({
    browserAPI,
    getURL: options.getURL,
    sendMessage: options.sendMessage,
    includeSendMessageExport: options.includeSendMessageExport,
    isFirefox: options.isFirefox,
    isChrome: options.isChrome,
  });
}

export function createFirefoxBrowserApiModuleMock(
  options: Omit<BrowserApiModuleMockOptions, 'isFirefox' | 'isChrome'> = {},
) {
  return createBrowserApiModuleMock({
    ...options,
    getURL:
      options.getURL ??
      vi.fn((path: string) => `moz-extension://test-id/${path}`),
    isFirefox: true,
    isChrome: false,
  });
}
