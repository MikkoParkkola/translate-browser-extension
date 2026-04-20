import { vi } from 'vitest';

type FixtureResetter = () => void;

type MockLike = {
  getMockImplementation?: () => ((...args: unknown[]) => unknown) | undefined;
  mockImplementation: (fn: (...args: unknown[]) => unknown) => unknown;
  mockReset: () => unknown;
};

const globalFixtureRegistry = new Map<string, FixtureResetter>();

export function registerGlobalFixture(key: string, resetFixture: FixtureResetter) {
  globalFixtureRegistry.set(key, resetFixture);
}

export function cleanupGlobalFixtures() {
  for (const resetFixture of globalFixtureRegistry.values()) {
    resetFixture();
  }
}

export function createMockResetter(mock: MockLike) {
  const initialImplementation = mock.getMockImplementation?.();

  return () => {
    mock.mockReset();

    if (initialImplementation) {
      mock.mockImplementation(initialImplementation);
    }
  };
}

export function collectMockResetters(
  value: unknown,
  seen = new Set<unknown>(),
): FixtureResetter[] {
  if (value == null) {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }

  if (typeof value === 'function' && vi.isMockFunction(value)) {
    seen.add(value);
    return [createMockResetter(value as MockLike)];
  }

  if (typeof value !== 'object') {
    return [];
  }

  seen.add(value);

  const resetters: FixtureResetter[] = [];
  for (const nestedValue of Object.values(value)) {
    resetters.push(...collectMockResetters(nestedValue, seen));
  }

  return resetters;
}

export function resetMutableRecord(
  target: Record<string, unknown>,
  initialState: Record<string, unknown>,
) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, initialState);
}
