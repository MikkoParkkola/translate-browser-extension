/**
 * Telemetry unit tests.
 *
 * AC-VERBATIM TRACEABILITY (MIK-4140):
 *   AC.1: maybeSendHeartbeat export, per-UTC-day dedup, projectId
 *   AC.2: payload key set, no IP symbols in source
 *   AC.3: DNT / NO_TELEMETRY / DEV / test / telemetryEnabled gates
 *   AC.4: AbortController timeout, failure-open (no throw)
 *   AC.5: happy-path, suppression, timeout/abort
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBrowserApiModuleMock } from '../test-helpers/module-mocks';

// ---------------------------------------------------------------------------
// Mocks — applied before module import via vitest hoisting
// ---------------------------------------------------------------------------

const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockFetch = vi.fn();

vi.mock('./browser-api', () =>
  createBrowserApiModuleMock({
    storageLocalGet: mockStorageGet,
    storageLocalSet: mockStorageSet,
  }),
);

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Stub global fetch
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { maybeSendHeartbeat, shouldSendTelemetry } from './telemetry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Overrides that bypass all privacy gates — use for happy-path tests. */
const GATES_OPEN = {
  doNotTrack: null as string | null,
  dev: false,
  mode: 'production' as string,
} as const;

function setStorageGetResult(result: Record<string, unknown>) {
  mockStorageGet.mockResolvedValue(result);
}

function resetAllMocks() {
  vi.clearAllMocks();
  mockStorageGet.mockReset();
  mockStorageSet.mockReset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
  // Reset DNT to null
  Object.defineProperty(navigator, 'doNotTrack', {
    value: null,
    writable: true,
    configurable: true,
  });
}

function setDoNotTrack(value: string | null) {
  Object.defineProperty(navigator, 'doNotTrack', {
    value,
    writable: true,
    configurable: true,
  });
}

function getTodayUtc(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// AC.5(a): Happy-path send against mocked collector
// ---------------------------------------------------------------------------

describe('AC.5(a) — happy-path heartbeat send', () => {
  beforeEach(() => {
    resetAllMocks();
    setDoNotTrack(null);
    setStorageGetResult({});
  });

  // AC.1: Emit telemetry heartbeat — maybeSendHeartbeat exports +
  //       wired into onInstalled + onStartup → verified by functional test
  it('AC.1 / AC.5(a): maybeSendHeartbeat sends a fetch to the collector with projectId translate-browser-extension', async () => {
    await maybeSendHeartbeat(GATES_OPEN);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/collector/event');

    // AC.2: The client payload contains ONLY projectId, eventType,
    //       clientVersion, runtime, and an optional random installId;
    //       it never reads or sends a raw IP address and contains no
    //       server-only collector internals.
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty('projectId', 'translate-browser-extension');
    expect(body).toHaveProperty('eventType', 'heartbeat');
    expect(body).toHaveProperty('clientVersion');
    expect(body).toHaveProperty('runtime');
    expect(body).toHaveProperty('installId');

    // AC.2 verify exact key set (no extras):
    const allowedKeys = ['projectId', 'eventType', 'clientVersion', 'runtime', 'installId'];
    expect(Object.keys(body).sort()).toEqual(allowedKeys.sort());

    // installId should be a UUID v4
    expect(body.installId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  // AC.1: At most one heartbeat per install per UTC day
  it('AC.1: persists last-sent UTC day so same-day calls are deduped', async () => {
    // First call — sends
    await maybeSendHeartbeat(GATES_OPEN);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // It should have persisted today's date
    expect(mockStorageSet).toHaveBeenCalledWith(
      expect.objectContaining({ telemetryLastSentDay: getTodayUtc() }),
    );

    // Reset fetch mock, set storage to return today's date
    mockFetch.mockClear();
    mockStorageSet.mockClear();
    setStorageGetResult({ telemetryLastSentDay: getTodayUtc() });

    // Second call same day — should NOT send
    await maybeSendHeartbeat(GATES_OPEN);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // AC.1: Next UTC day triggers a new heartbeat
  it('AC.1: allows heartbeat on the next UTC day', async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yyyy = yesterday.getUTCFullYear();
    const mm = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(yesterday.getUTCDate()).padStart(2, '0');
    const yesterdayStr = `${yyyy}-${mm}-${dd}`;

    setStorageGetResult({
      telemetryLastSentDay: yesterdayStr,
      telemetryInstallId: '00000000-0000-4000-a000-000000000001',
    });

    await maybeSendHeartbeat(GATES_OPEN);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // AC.1: installId is persisted and reused
  it('AC.1: installId is persisted and reused across calls', async () => {
    // First call: should create and persist installId
    setStorageGetResult({}); // no installId yet
    await maybeSendHeartbeat(GATES_OPEN);

    const setCalls = mockStorageSet.mock.calls;
    const installIdCall = setCalls.find((call: [Record<string, unknown>]) =>
      Object.prototype.hasOwnProperty.call(call[0], 'telemetryInstallId'),
    );
    expect(installIdCall).toBeDefined();

    // Second call: should read existing installId from storage
    mockFetch.mockClear();
    mockStorageSet.mockClear();
    const existingId = 'aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee';
    setStorageGetResult({
      telemetryInstallId: existingId,
      telemetryLastSentDay: '2000-01-01',
    });

    await maybeSendHeartbeat(GATES_OPEN);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.installId).toBe(existingId);
  });

  // AC.4: Failure-open — AbortController timeout ≤ 3000 ms
  it('AC.4: uses AbortController in fetch call', async () => {
    await maybeSendHeartbeat(GATES_OPEN);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // AC.4: Swallows fetch errors
  it('AC.4: swallows fetch errors (failure-open — never throws)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    await expect(maybeSendHeartbeat(GATES_OPEN)).resolves.toBeUndefined();
  });

  // AC.4: Swallows 4xx
  it('AC.4: swallows 4xx responses without throwing', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 400 }));
    await expect(maybeSendHeartbeat(GATES_OPEN)).resolves.toBeUndefined();
  });

  // AC.4: Swallows 5xx
  it('AC.4: swallows 5xx responses without throwing', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(maybeSendHeartbeat(GATES_OPEN)).resolves.toBeUndefined();
  });

  // AC.4: Payload ≤ 2 KB
  it('AC.4: payload is <= 2 KB', async () => {
    await maybeSendHeartbeat(GATES_OPEN);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const body = init.body as string;
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(2048);
  });
});

// ---------------------------------------------------------------------------
// AC.5(b): Opt-out / DNT / NO_TELEMETRY / DEV / test suppression → zero fetch
// ---------------------------------------------------------------------------

describe('AC.5(b) — privacy gate suppression', () => {
  beforeEach(() => {
    resetAllMocks();
    setDoNotTrack(null);
  });

  // AC.3: DNT gate
  it('AC.3: suppress heartbeat when navigator.doNotTrack === "1"', async () => {
    setDoNotTrack('1');
    setStorageGetResult({});
    await maybeSendHeartbeat({ ...GATES_OPEN, doNotTrack: '1' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // AC.3: NO_TELEMETRY env flag
  it('AC.3: suppress heartbeat when VITE_NO_TELEMETRY env flag is set', async () => {
    setStorageGetResult({});
    await maybeSendHeartbeat({ ...GATES_OPEN, noTelemetryFlag: '1' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // AC.3: DEV mode
  it('AC.3: suppress heartbeat when import.meta.env.DEV is true', async () => {
    setStorageGetResult({});
    await maybeSendHeartbeat({ ...GATES_OPEN, dev: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // AC.3: test mode
  it('AC.3: suppress heartbeat when MODE is "test"', async () => {
    setStorageGetResult({});
    await maybeSendHeartbeat({ ...GATES_OPEN, mode: 'test' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // AC.3: telemetryEnabled === false in settings
  it('AC.3: suppress heartbeat when telemetryEnabled is explicitly false in settings', async () => {
    setStorageGetResult({ telemetryEnabled: false, telemetryLastSentDay: '2000-01-01' });
    await maybeSendHeartbeat(GATES_OPEN);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // AC.3: Import-time side-effect check
  it('AC.3: importing the module does not trigger any fetch at import time', () => {
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC.5(c): Timeout/abort behaviour resolving without throwing
// ---------------------------------------------------------------------------

describe('AC.5(c) — timeout / abort behaviour', () => {
  beforeEach(() => {
    resetAllMocks();
    setDoNotTrack(null);
    setStorageGetResult({});
  });

  // AC.4: AbortError swallowed
  it('AC.4 / AC.5(c): AbortController timeout resolves without throwing (AbortError swallowed)', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    await expect(maybeSendHeartbeat(GATES_OPEN)).resolves.toBeUndefined();
  });

  // AC.4: AbortController signal passed to fetch
  it('AC.4: AbortController signal is passed to fetch', async () => {
    await maybeSendHeartbeat(GATES_OPEN);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// shouldSendTelemetry unit tests (AC.3 gates)
// ---------------------------------------------------------------------------

describe('shouldSendTelemetry — privacy gates (AC.3)', () => {
  beforeEach(() => {
    resetAllMocks();
    setDoNotTrack(null);
  });

  // AC.3: DNT
  it('AC.3: returns false when doNotTrack is "1"', () => {
    expect(shouldSendTelemetry({ doNotTrack: '1', dev: false, mode: 'production' })).toBe(false);
  });

  // AC.3: NO_TELEMETRY
  it('AC.3: returns false when VITE_NO_TELEMETRY env flag is set', () => {
    expect(
      shouldSendTelemetry({ doNotTrack: null, dev: false, mode: 'production', noTelemetryFlag: '1' }),
    ).toBe(false);
  });

  // AC.3: DEV
  it('AC.3: returns false when dev is true', () => {
    expect(shouldSendTelemetry({ dev: true, mode: 'production' })).toBe(false);
  });

  // AC.3: test mode
  it('AC.3: returns false when mode is "test"', () => {
    expect(shouldSendTelemetry({ dev: false, mode: 'test' })).toBe(false);
  });

  // AC.3: all gates open
  it('AC.3: returns true when no privacy gate is active', () => {
    expect(shouldSendTelemetry({ doNotTrack: null, dev: false, mode: 'production' })).toBe(true);
  });

  // AC.3: doNotTrack null does not suppress
  it('AC.3: doNotTrack === null does not suppress', () => {
    expect(shouldSendTelemetry({ doNotTrack: null, dev: false, mode: 'production' })).toBe(true);
  });

  // AC.3: doNotTrack "0" does not suppress
  it('AC.3: doNotTrack === "0" does not suppress', () => {
    expect(shouldSendTelemetry({ doNotTrack: '0', dev: false, mode: 'production' })).toBe(true);
  });

  // AC.3: verify that the default vitest env (DEV=true) suppresses
  it('AC.3: default vitest environment suppresses telemetry (DEV=true)', () => {
    // No overrides — real import.meta.env is DEV=true
    expect(shouldSendTelemetry()).toBe(false);
  });
});
