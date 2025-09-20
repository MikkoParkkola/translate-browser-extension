/**
 * Chrome Extension API type definitions for Qwen Translator Extension
 * Extends the @types/chrome package with project-specific interfaces
 */

/// <reference types="chrome"/>

declare global {
  interface Window {
    chrome: typeof chrome;
  }
  
  namespace chrome {
    namespace runtime {
      interface Port {
        name: string;
        disconnect(): void;
        onDisconnect: chrome.events.Event<() => void>;
        onMessage: chrome.events.Event<(message: any) => void>;
        postMessage(message: any): void;
        sender?: chrome.runtime.MessageSender;
      }
    }

    namespace storage {
      interface StorageChange {
        oldValue?: any;
        newValue?: any;
      }
      
      interface StorageArea {
        get(callback: (items: { [key: string]: any }) => void): void;
        get(keys: string | string[] | { [key: string]: any } | null, callback: (items: { [key: string]: any }) => void): void;
        getBytesInUse(callback: (bytesInUse: number) => void): void;
        getBytesInUse(keys: string | string[] | null, callback: (bytesInUse: number) => void): void;
        set(items: { [key: string]: any }, callback?: () => void): void;
        remove(keys: string | string[], callback?: () => void): void;
        clear(callback?: () => void): void;
        onChanged: chrome.events.Event<(changes: { [key: string]: StorageChange }) => void>;
      }
    }

    namespace scripting {
      interface InjectionTarget {
        tabId: number;
        frameIds?: number[];
        documentIds?: string[];
        allFrames?: boolean;
      }

      interface ScriptInjection {
        target: InjectionTarget;
        files?: string[];
        func?: Function;
        args?: any[];
        world?: 'ISOLATED' | 'MAIN';
        injectImmediately?: boolean;
      }

      interface InjectionResult {
        result?: any;
        error?: any;
        frameId: number;
      }

      export function executeScript(
        injection: ScriptInjection
      ): Promise<InjectionResult[]>;

      export function executeScript(
        injection: ScriptInjection,
        callback: (results: InjectionResult[]) => void
      ): void;
    }

    namespace webRequest {
      interface RequestFilter {
        urls: string[];
        types?: ResourceType[];
        tabId?: number;
        windowId?: number;
      }

      interface BlockingResponse {
        cancel?: boolean;
        redirectUrl?: string;
        requestHeaders?: HttpHeader[];
        responseHeaders?: HttpHeader[];
      }

      type ResourceType = 
        | 'main_frame'
        | 'sub_frame' 
        | 'stylesheet'
        | 'script'
        | 'image'
        | 'font'
        | 'object'
        | 'xmlhttprequest'
        | 'ping'
        | 'csp_report'
        | 'media'
        | 'websocket'
        | 'other';

      interface HttpHeader {
        name: string;
        value?: string;
        binaryValue?: ArrayBuffer;
      }
    }
  }

  // Extension-specific globals
  interface QwenExtensionGlobals {
    qwenCore?: typeof import('../src/core/types');
    qwenConfig?: typeof import('../src/core/config-manager.js');
    qwenCache?: typeof import('../src/core/cache-manager');
    qwenLogger?: typeof import('../src/core/logger');
  }

  var qwenCore: QwenExtensionGlobals['qwenCore'];
  var qwenConfig: QwenExtensionGlobals['qwenConfig'];
  var qwenCache: QwenExtensionGlobals['qwenCache'];
  var qwenLogger: QwenExtensionGlobals['qwenLogger'];
}

export {};