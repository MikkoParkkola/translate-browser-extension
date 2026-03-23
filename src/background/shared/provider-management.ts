/**
 * Shared Provider Management
 *
 * Provider state, rate limiting, error formatting, and constants
 * used by both Chrome and Firefox background scripts.
 */

import type { Strategy, TranslationProviderId, SetProviderMessage, MessageResponse } from '../../types';
import type { TranslationError } from '../../core/errors';
import { safeStorageSet } from '../../core/storage';
import { approxTokens } from '../../core/text-utils';
import { createLogger } from '../../core/logger';
import { CONFIG } from '../../config';

const log = createLogger('ProviderMgmt');

// ============================================================================
// Provider State
// ============================================================================

let currentStrategy: Strategy = 'smart';
let currentProvider: TranslationProviderId = 'opus-mt';

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

/** Cloud provider API key storage keys. */
export const CLOUD_PROVIDER_KEYS: Record<string, string> = {
  deepl: 'deepl_api_key',
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  'google-cloud': 'google_cloud_api_key',
};

/** Static provider list shown in the UI. */
export const PROVIDER_LIST = [
  {
    id: 'opus-mt',
    name: 'Helsinki-NLP OPUS-MT',
    type: 'local',
    qualityTier: 'standard',
    description: 'Fast, lightweight (~170MB per pair)',
    icon: '',
  },
  {
    id: 'translategemma',
    name: 'TranslateGemma 4B',
    type: 'local',
    qualityTier: 'premium',
    description: 'High quality, single model (~3.6GB)',
    icon: '',
  },
] as const;

// ============================================================================
// Common Handlers
// ============================================================================

/** Handle 'setProvider' message. */
export async function handleSetProvider(message: SetProviderMessage): Promise<MessageResponse<{ provider: TranslationProviderId }>> {
  currentProvider = message.provider;
  log.info(`Provider set to: ${currentProvider}`);
  await safeStorageSet({ provider: currentProvider });
  return { success: true, provider: currentProvider };
}
