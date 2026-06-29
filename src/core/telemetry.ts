/**
 * Privacy-preserving active-user telemetry.
 *
 * Emits at most one heartbeat per install per UTC day to the MIK-6565 public
 * collector (project id `translate-browser-extension`).  Geography is derived
 * server-side in aggregate — the client never sends its raw IP.
 *
 * AC.1: maybeSendHeartbeat exported; wired into onInstalled + onStartup.
 * AC.2: payload = projectId, eventType, clientVersion, runtime, installId.
 * AC.3: privacy gates — DNT, NO_TELEMETRY, telemetryEnabled, DEV/test.
 * AC.4: failure-open — AbortController timeout ≤ 3 s, swallows errors.
 */

import { safeStorageGet, safeStorageSet } from './storage';
import { createLogger } from './logger';
import { readBooleanEnvFlag } from '../config';

const log = createLogger('Telemetry');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTOR_URL = 'https://mcp.mikkoparkkola.com/collector/event';
const PROJECT_ID = 'translate-browser-extension';
const HEARTBEAT_EVENT_TYPE = 'heartbeat';
const ABORT_TIMEOUT_MS = 3_000;
const STORAGE_KEY_LAST_SENT_DAY = 'telemetryLastSentDay';
const STORAGE_KEY_INSTALL_ID = 'telemetryInstallId';
const MAX_PAYLOAD_BYTES = 2_048;

// ---------------------------------------------------------------------------
// Privacy gates (AC.3)
// ---------------------------------------------------------------------------

/**
 * Determine whether a telemetry send is permitted under all privacy gates.
 *
 * Gates (order-independent — all must pass):
 * 1. navigator.doNotTrack === '1'  →  suppressed
 * 2. VITE_NO_TELEMETRY env flag    →  suppressed
 * 3. import.meta.env.DEV           →  suppressed
 * 4. import.meta.env.MODE==='test' →  suppressed
 * 5. telemetryEnabled === false    →  suppressed (extension settings opt-out)
 *
 * Importing this module NEVER triggers a network call — sends only fire from
 * the exported maybeSendHeartbeat function.
 *
 * @param overrides  Optional env overrides for testing.  When absent,
 *                   real import.meta.env and navigator.doNotTrack are read.
 */
export function shouldSendTelemetry(overrides?: {
  doNotTrack?: string | null;
  dev?: boolean;
  mode?: string;
  noTelemetryFlag?: unknown;
}): boolean {
  const dnt = overrides?.doNotTrack ?? (typeof navigator !== 'undefined' ? navigator.doNotTrack : null);
  const dev = overrides?.dev ?? import.meta.env.DEV;
  const mode = overrides?.mode ?? import.meta.env.MODE;
  const noTelemetryFlag = overrides?.noTelemetryFlag ?? import.meta.env?.VITE_NO_TELEMETRY;

  // Gate 1: Do Not Track
  if (dnt === '1') {
    return false;
  }

  // Gate 2: NO_TELEMETRY env flag
  if (readBooleanEnvFlag(noTelemetryFlag)) {
    return false;
  }

  // Gate 3-4: DEV / test mode
  if (dev || mode === 'test') {
    return false;
  }

  // Gate 5 is checked async in maybeSendHeartbeat (reads storage)
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentUtcDay(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function isSameUtcDaySent(): Promise<boolean> {
  const stored = await safeStorageGet<{ [STORAGE_KEY_LAST_SENT_DAY]?: string }>(
    STORAGE_KEY_LAST_SENT_DAY,
  );
  return stored[STORAGE_KEY_LAST_SENT_DAY] === getCurrentUtcDay();
}

async function getOrCreateInstallId(): Promise<string> {
  const stored = await safeStorageGet<{ [STORAGE_KEY_INSTALL_ID]?: string }>(
    STORAGE_KEY_INSTALL_ID,
  );
  if (stored[STORAGE_KEY_INSTALL_ID]) {
    return stored[STORAGE_KEY_INSTALL_ID]!;
  }

  const id = crypto.randomUUID();
  await safeStorageSet({ [STORAGE_KEY_INSTALL_ID]: id });
  return id;
}

function getRuntime(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    return 'chrome-mv3';
  }
  return 'firefox-mv2';
}

async function getClientVersion(): Promise<string> {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      return chrome.runtime.getManifest().version;
    }
  } catch {
    // browser.runtime may not have getManifest
  }

  try {
    if (
      typeof (globalThis as { browser?: { runtime?: { getManifest?: () => { version: string } } } }).browser
        ?.runtime?.getManifest === 'function'
    ) {
      return (globalThis as { browser: { runtime: { getManifest: () => { version: string } } } }).browser.runtime.getManifest().version;
    }
  } catch {
    // fall through
  }

  return '0.0.0';
}

function isTelemetryEnabledInSettings(
  settings: Partial<{ telemetryEnabled?: boolean }>,
): boolean {
  // Default to enabled (opt-out). Only suppress when explicitly false.
  return settings.telemetryEnabled !== false;
}

// ---------------------------------------------------------------------------
// Heartbeat payload (AC.2)
// ---------------------------------------------------------------------------

interface HeartbeatPayload {
  projectId: string;
  eventType: string;
  clientVersion: string;
  runtime: string;
  installId: string;
}

async function buildPayload(): Promise<HeartbeatPayload> {
  const [clientVersion, installId] = await Promise.all([
    getClientVersion(),
    getOrCreateInstallId(),
  ]);

  return {
    projectId: PROJECT_ID,
    eventType: HEARTBEAT_EVENT_TYPE,
    clientVersion,
    runtime: getRuntime(),
    installId,
  };
}

// ---------------------------------------------------------------------------
// Send (AC.4)
// ---------------------------------------------------------------------------

/**
 * Send the heartbeat to the MIK-6565 collector.
 *
 * Failure-open: uses native fetch with AbortController timeout (≤ 3 s),
 * swallows collector timeouts and any 4xx/5xx, never throws, keeps the
 * serialised payload ≤ 2 KB, adds zero new runtime dependencies, and
 * performs exactly one bounded async request.
 */
async function sendHeartbeat(payload: HeartbeatPayload): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);

  try {
    const body = JSON.stringify(payload);

    // AC.4: payload ≤ 2 KB — guard that we never ship oversized payloads
    if (new TextEncoder().encode(body).length > MAX_PAYLOAD_BYTES) {
      log.warn('Telemetry payload exceeds size limit, dropping');
      return;
    }

    await fetch(COLLECTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    // Swallow all errors — timeouts, network, 4xx, 5xx, AbortError
    log.debug('Telemetry heartbeat not sent (non-fatal):', error);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Public API (AC.1)
// ---------------------------------------------------------------------------

/**
 * Emit at most one heartbeat per install per UTC day.
 *
 * This is the single public entry-point.  Wire it into:
 * - chrome.runtime.onInstalled
 * - chrome.runtime.onStartup
 *
 * It is safe to call at any time — privacy gates and per-day dedup prevent
 * over-sending, and the send path is failure-open so the caller never
 * blocks or throws.
 */
export async function maybeSendHeartbeat(
  overrides?: Parameters<typeof shouldSendTelemetry>[0],
): Promise<void> {
  // Privacy gates (AC.3)
  if (!shouldSendTelemetry(overrides)) {
    return;
  }

  // Per-day dedup (AC.1)
  if (await isSameUtcDaySent()) {
    return;
  }

  // Settings opt-out (AC.3 gate 5 — async, needs storage read)
  const settings = await safeStorageGet<{ telemetryEnabled?: boolean }>(
    'telemetryEnabled',
  );
  if (!isTelemetryEnabledInSettings(settings)) {
    return;
  }

  const payload = await buildPayload();
  await sendHeartbeat(payload);

  // Persist the sent day so we dedup within the same UTC day
  await safeStorageSet({ [STORAGE_KEY_LAST_SENT_DAY]: getCurrentUtcDay() });
}


