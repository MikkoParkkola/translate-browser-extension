import { vi } from 'vitest';
import {
  collectMockResetters,
  registerGlobalFixture,
} from './global-fixture-registry';

type GlobalFixtureRestoreMode = 'baseline' | 'original';

type IndexedDbCacheLikeEntry = {
  key: string;
  timestamp: number;
};

type IndexedDbRequest<T> = {
  onerror: ((ev: Event) => void) | null;
  onsuccess: ((ev: Event) => void) | null;
  result: T;
};

type IndexedDbDatabaseInfo = {
  name?: string;
  version?: number;
};

function applyGlobalFixtureValue(name: string, value: unknown) {
  if (value === undefined) {
    delete (globalThis as Record<string, unknown>)[name];
    return;
  }

  vi.stubGlobal(name, value);
}

export function setupIndexedDbDatabasesMock(options: {
  restore?: GlobalFixtureRestoreMode;
  databases?: IndexedDbDatabaseInfo[];
  includeDatabases?: boolean;
} = {}) {
  const restoreMode = options.restore ?? 'original';
  const originalIndexedDB = (globalThis as Record<string, unknown>).indexedDB;
  const deleteDatabase = vi.fn();
  const databases = options.includeDatabases === false
    ? undefined
    : vi.fn().mockResolvedValue(options.databases ?? []);
  const indexedDBMock: Record<string, unknown> = {
    deleteDatabase,
  };

  if (databases) {
    indexedDBMock.databases = databases;
  }

  const mockResetters = collectMockResetters(indexedDBMock);

  applyGlobalFixtureValue('indexedDB', indexedDBMock);

  registerGlobalFixture('indexedDB', () => {
    mockResetters.forEach((resetMock) => resetMock());

    if (restoreMode === 'original') {
      applyGlobalFixtureValue('indexedDB', originalIndexedDB);
      return;
    }

    applyGlobalFixtureValue('indexedDB', indexedDBMock);
  });

  return {
    indexedDB: indexedDBMock,
    databases,
    deleteDatabase,
  };
}

export function setupIndexedDbStorageMock<T extends IndexedDbCacheLikeEntry>(options: {
  restore?: GlobalFixtureRestoreMode;
} = {}) {
  const restoreMode = options.restore ?? 'baseline';
  const originalIndexedDB = (globalThis as Record<string, unknown>).indexedDB;
  const entries = new Map<string, T>();
  let resetGeneration = 0;

  let store: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    openCursor: ReturnType<typeof vi.fn>;
    index: ReturnType<typeof vi.fn>;
  };

  const scheduleRequestDispatch = (generation: number, callback: () => void) => {
    queueMicrotask(() => {
      if (generation !== resetGeneration) {
        return;
      }

      callback();
    });
  };

  const createCursorRequest = (sourceEntries: T[], deleteCallback?: () => void) => {
    const generation = resetGeneration;
    const request: IndexedDbRequest<{
      value: T;
      continue: () => void;
      delete: () => void;
    } | null> = {
      onerror: null,
      onsuccess: null,
      result: null,
    };

    const createMockCursor = (index: number) => ({
      value: sourceEntries[index],
      continue: () => {
        const nextIndex = index + 1;
        scheduleRequestDispatch(generation, () => {
          request.result = nextIndex < sourceEntries.length ? createMockCursor(nextIndex) : null;
          request.onsuccess?.({ target: { result: request.result } } as unknown as Event);
        });
      },
      delete: () => {
        const key = sourceEntries[index]?.key;
        if (key) {
          entries.delete(key);
          deleteCallback?.();
        }
      },
    });

    scheduleRequestDispatch(generation, () => {
      request.result = sourceEntries.length > 0 ? createMockCursor(0) : null;
      request.onsuccess?.({ target: { result: request.result } } as unknown as Event);
    });

    return request;
  };

  const index = {
    openCursor: vi.fn(() => {
      const sortedEntries = Array.from(entries.values()).sort((a, b) => a.timestamp - b.timestamp);
      return createCursorRequest(sortedEntries);
    }),
  };

  store = {
    get: vi.fn((key: string) => ({
      onerror: null,
      onsuccess: null,
      result: entries.get(key),
    })),
    put: vi.fn((entry: T) => {
      entries.set(entry.key, entry);
      return {
        onerror: null,
        onsuccess: null,
      };
    }),
    clear: vi.fn(() => {
      entries.clear();
      return {
        onerror: null,
        onsuccess: null,
      };
    }),
    openCursor: vi.fn(() => {
      return createCursorRequest(Array.from(entries.values()));
    }),
    index: vi.fn(() => index),
  };

  const transaction = {
    objectStore: vi.fn(() => store),
  };

  const db = {
    transaction: vi.fn(() => transaction),
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(() => ({
      createIndex: vi.fn(),
    })),
    close: vi.fn(),
  };

  const indexedDB = {
    open: vi.fn(() => {
      const request = {
        onerror: null as ((ev: Event) => void) | null,
        onsuccess: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: db,
        error: null,
      };

      scheduleRequestDispatch(resetGeneration, () => {
        request.onsuccess?.({ target: request } as unknown as Event);
      });

      return request;
    }),
    deleteDatabase: vi.fn(() => ({
      onerror: null,
      onsuccess: null,
    })),
  };

  const mockResetters = collectMockResetters({
    index,
    store,
    transaction,
    db,
    indexedDB,
  });

  const reset = () => {
    entries.clear();
    resetGeneration++;
    mockResetters.forEach((resetMock) => resetMock());

    if (restoreMode === 'original') {
      applyGlobalFixtureValue('indexedDB', originalIndexedDB);
      return;
    }

    applyGlobalFixtureValue('indexedDB', indexedDB);
  };

  applyGlobalFixtureValue('indexedDB', indexedDB);
  registerGlobalFixture('indexedDB', reset);

  return {
    entries,
    store,
    index,
    transaction,
    db,
    indexedDB,
    reset,
  };
}
