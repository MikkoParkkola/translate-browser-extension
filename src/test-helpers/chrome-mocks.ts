import { vi } from 'vitest';

export function createUiChromeMock() {
  return {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({}),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({}),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue(undefined),
    },
  };
}

export function setupUiChromeMock() {
  const chromeMock = createUiChromeMock();
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}
