import { vi } from 'vitest';
import { registerGlobalFixture } from './global-fixture-registry';

type MockFn = ReturnType<typeof vi.fn>;

type ChromeLike = {
  tabs?: Record<string, unknown>;
  scripting?: Record<string, unknown>;
};

export function createExecuteScriptResult<T>(
  result: T,
): chrome.scripting.InjectionResult<T>[] {
  return [{ result }] as chrome.scripting.InjectionResult<T>[];
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

export function setupChromeTabsScriptingMocks(
  chromeApi: ChromeLike = globalThis.chrome as ChromeLike,
) {
  const tabs = (chromeApi.tabs ??= {});
  const scripting = (chromeApi.scripting ??= {});

  const queryMock = ensureMock(
    tabs,
    'query',
    vi.fn().mockResolvedValue([] as chrome.tabs.Tab[]),
  );
  const captureVisibleTabMock = ensureMock(
    tabs,
    'captureVisibleTab',
    vi.fn().mockResolvedValue(undefined),
  );
  const executeScriptMock = ensureMock(
    scripting,
    'executeScript',
    vi.fn().mockResolvedValue([] as chrome.scripting.InjectionResult<unknown>[]),
  );

  const initialQueryImplementation = queryMock.getMockImplementation?.();
  const initialCaptureVisibleTabImplementation =
    captureVisibleTabMock.getMockImplementation?.();
  const initialExecuteScriptImplementation =
    executeScriptMock.getMockImplementation?.();

  const reset = () => {
    tabs.query = queryMock;
    tabs.captureVisibleTab = captureVisibleTabMock;
    scripting.executeScript = executeScriptMock;

    queryMock.mockReset();
    captureVisibleTabMock.mockReset();
    executeScriptMock.mockReset();

    if (initialQueryImplementation) {
      queryMock.mockImplementation(initialQueryImplementation);
    }
    if (initialCaptureVisibleTabImplementation) {
      captureVisibleTabMock.mockImplementation(
        initialCaptureVisibleTabImplementation,
      );
    }
    if (initialExecuteScriptImplementation) {
      executeScriptMock.mockImplementation(initialExecuteScriptImplementation);
    }
  };

  registerGlobalFixture('chrome-tabs-scripting', reset);

  return {
    queryMock,
    captureVisibleTabMock,
    executeScriptMock,
    reset,
    queueTabsQueryResult(tabsResult: chrome.tabs.Tab[]) {
      queryMock.mockResolvedValueOnce(tabsResult);
    },
    queueActiveTab(tab: Partial<chrome.tabs.Tab> = { id: 1 }) {
      queryMock.mockResolvedValueOnce([tab as chrome.tabs.Tab]);
    },
    queueExecuteScriptResult<T>(result: T) {
      executeScriptMock.mockResolvedValueOnce(createExecuteScriptResult(result));
    },
    queueExecuteScriptError(error: Error) {
      executeScriptMock.mockRejectedValueOnce(error);
    },
    queueCaptureVisibleTabResult(dataUrl: string) {
      captureVisibleTabMock.mockResolvedValueOnce(dataUrl);
    },
    queueCaptureVisibleTabError(error: Error) {
      captureVisibleTabMock.mockRejectedValueOnce(error);
    },
  };
}
