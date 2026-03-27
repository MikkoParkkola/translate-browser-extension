import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserApiMock,
  createBrowserApiModuleExports,
  createBrowserApiModuleMock,
  createFirefoxBrowserApiModuleMock,
} from './browser-api-mocks';
import { createBrowserApiModuleMock as createLegacyBrowserApiModuleMock } from './module-mocks';

describe('browser-api-mocks', () => {
  it('creates browserAction and commands mocks by default', async () => {
    const browserAPI = createBrowserApiMock();

    expect(browserAPI.browserAction).toBeDefined();
    expect(browserAPI.commands).toBeDefined();
    expect(browserAPI.tabs).toBeDefined();
    expect(
      (
        browserAPI.browserAction as {
          onClicked: { addListener: ReturnType<typeof vi.fn> };
        }
      ).onClicked.addListener
    ).toEqual(expect.any(Function));
  });

  it('omits requested namespaces for fresh-import scenarios', async () => {
    const browserAPI = createBrowserApiMock({
      omit: ['browserAction', 'commands', 'tabs'],
    });

    expect(browserAPI.browserAction).toBeUndefined();
    expect(browserAPI.commands).toBeUndefined();
    expect(browserAPI.tabs).toBeUndefined();
    expect(browserAPI.runtime).toBeDefined();
  });

  it('creates module exports wired to runtime helpers and storage', async () => {
    const getURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`);
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });

    const moduleMock = createBrowserApiModuleMock({
      runtime: {
        getURL,
        sendMessage,
      },
      includeSendMessageExport: true,
    }) as {
      browserAPI: {
        runtime: {
          getURL: (path: string) => string;
          sendMessage: ReturnType<typeof vi.fn>;
        };
        storage: {
          local: {
            get: ReturnType<typeof vi.fn>;
          };
        };
      };
      getURL: (path: string) => string;
      sendMessage: ReturnType<typeof vi.fn>;
      storage: {
        get: ReturnType<typeof vi.fn>;
      };
      isFirefox: () => boolean;
      isChrome: () => boolean;
    };

    expect(moduleMock.getURL('assets/icon.svg')).toBe(
      'chrome-extension://test-id/assets/icon.svg'
    );
    expect(moduleMock.browserAPI.runtime.getURL).toBe(getURL);
    expect(moduleMock.sendMessage).toBe(sendMessage);
    expect(moduleMock.storage.get).toBe(moduleMock.browserAPI.storage.local.get);
    expect(moduleMock.isFirefox()).toBe(false);
    expect(moduleMock.isChrome()).toBe(true);
  });

  it('creates Firefox-flavoured module mocks with moz-extension URLs', async () => {
    const moduleMock = createFirefoxBrowserApiModuleMock({
      omit: ['browserAction', 'commands'],
    }) as {
      browserAPI: {
        browserAction?: unknown;
        commands?: unknown;
      };
      getURL: (path: string) => string;
      isFirefox: () => boolean;
      isChrome: () => boolean;
    };

    expect(moduleMock.getURL('assets/')).toBe('moz-extension://test-id/assets/');
    expect(moduleMock.browserAPI.browserAction).toBeUndefined();
    expect(moduleMock.browserAPI.commands).toBeUndefined();
    expect(moduleMock.isFirefox()).toBe(true);
    expect(moduleMock.isChrome()).toBe(false);
  });

  it('wraps existing browserAPI objects into module exports', async () => {
    const browserAPI = createBrowserApiMock({
      runtime: {
        getURL: vi.fn((path: string) => `wrapped://${path}`),
      },
    });

    const moduleMock = createBrowserApiModuleExports({
      browserAPI,
      isChrome: false,
      isFirefox: false,
    }) as {
      getURL: (path: string) => string;
      getPlatform: () => string;
    };

    expect(moduleMock.getURL('chunks/pdfjs.js')).toBe('wrapped://chunks/pdfjs.js');
    expect(moduleMock.getPlatform()).toBe('unknown');
  });

  it('keeps the legacy module-mocks wrapper sparse and backward compatible', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const legacyModuleMock = createLegacyBrowserApiModuleMock({
      runtimeSendMessage: sendMessage,
      includeSendMessageExport: true,
    }) as {
      browserAPI: {
        runtime: {
          sendMessage: ReturnType<typeof vi.fn>;
        };
        tabs?: unknown;
      };
      sendMessage: ReturnType<typeof vi.fn>;
    };

    expect(legacyModuleMock.browserAPI.runtime.sendMessage).toBe(sendMessage);
    expect(legacyModuleMock.sendMessage).toBe(sendMessage);
    expect(legacyModuleMock.browserAPI.tabs).toBeUndefined();
  });
});
