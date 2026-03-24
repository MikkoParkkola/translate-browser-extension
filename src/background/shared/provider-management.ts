/**
 * Shared Provider Management
 *
 * Provider state, rate limiting, error formatting, and constants
 * used by both Chrome and Firefox background scripts.
 */

import type { Strategy, TranslationProviderId, CloudProviderId, SetProviderMessage, MessageResponse } from '../../types';
import type { TranslationError } from '../../core/errors';
import { strictStorageSet } from '../../core/storage';
import { approxTokens } from '../../core/text-utils';
import { createLogger } from '../../core/logger';
import { CONFIG } from '../../config';
import { BACKGROUND_PROVIDER_LIST, DEFAULT_PROVIDER_ID } from '../../shared/provider-options';
import { CLOUD_PROVIDER_CONFIGS } from '../../shared/cloud-provider-configs';

const log = createLogger('ProviderMgmt');

// ============================================================================
// Provider State
// ============================================================================

let currentStrategy: Strategy = 'smart';
let currentProvider: TranslationProviderId = DEFAULT_PROVIDER_ID;

export function getStrategy(): Strategy {
  return currentStrategy;
}
export function setStrategy(s: Strategy): void {
  currentStrategy = s;
}
export function getProvider(): TranslationProviderId {
  return currentProvider;
}
export function setProvider(p: TranslationProviderId): void {
  currentProvider = p;
}

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitState {
  requests: number;
  tokens: number;
  windowStart: number;
}

const rateLimit: RateLimitState = {
  requests: 0,
  tokens: 0,
  windowStart: Date.now(),
};

export function checkRateLimit(tokenEstimate: number): boolean {
  const now = Date.now();
  if (now - rateLimit.windowStart > CONFIG.rateLimits.windowMs) {
    rateLimit.requests = 0;
    rateLimit.tokens = 0;
    rateLimit.windowStart = now;
  }

  if (rateLimit.requests >= CONFIG.rateLimits.requestsPerMinute) return false;
  if (rateLimit.tokens + tokenEstimate > CONFIG.rateLimits.tokensPerMinute) return false;

  return true;
}

export function recordUsage(tokens: number): void {
  rateLimit.requests++;
  rateLimit.tokens += tokens;
}

export function estimateTokens(text: string | string[]): number {
  const str = Array.isArray(text) ? text.join(' ') : text;
  return approxTokens(str);
}

export function getRateLimitState(): Readonly<RateLimitState> {
  return rateLimit;
}

// ============================================================================
// Error Formatting
// ============================================================================

export function formatUserError(error: TranslationError): string {
  let message = error.message;
  if (error.suggestion) {
    message += `. ${error.suggestion}`;
  }
  return message;
}

// ============================================================================
// Provider Constants
// ============================================================================

function buildCloudProviderRecord<T>(select: (config: typeof CLOUD_PROVIDER_CONFIGS[number]) => T): Record<CloudProviderId, T> {
  return Object.freeze(
    Object.fromEntries(CLOUD_PROVIDER_CONFIGS.map((config) => [config.id, select(config)]))
  ) as Record<CloudProviderId, T>;
}

/** Cloud provider API key storage keys. */
export const CLOUD_PROVIDER_KEYS: Record<CloudProviderId, string> = buildCloudProviderRecord(
  (config) => config.storage.apiKey
);

/** Full storage lifecycle keys for each cloud provider. */
export const CLOUD_PROVIDER_STORAGE_KEYS = buildCloudProviderRecord(
  (config) => Object.freeze([
    config.storage.apiKey,
    config.enabledField,
    ...config.storage.related,
  ])
) as Readonly<Record<CloudProviderId, readonly string[]>>;

/** Writable option field -> storage key mappings for each cloud provider. */
export const CLOUD_PROVIDER_OPTION_FIELDS = buildCloudProviderRecord(
  (config) => Object.freeze({ ...(config.optionFields ?? {}) })
) as Readonly<Record<CloudProviderId, Readonly<Record<string, string>>>>;

/** Enabled flag storage key for each cloud provider. */
export const CLOUD_PROVIDER_ENABLED_FIELDS = buildCloudProviderRecord(
  (config) => config.enabledField
);

/** Static provider list shown in the UI. */
export const PROVIDER_LIST = BACKGROUND_PROVIDER_LIST;

// ============================================================================
// Common Handlers
// ============================================================================

/** Handle 'setProvider' message. */
export async function handleSetProvider(message: SetProviderMessage): Promise<MessageResponse<{ provider: TranslationProviderId }>> {
  currentProvider = message.provider;
  log.info(`Provider set to: ${currentProvider}`);
  await strictStorageSet({ provider: currentProvider });
  return { success: true, provider: currentProvider };
}
