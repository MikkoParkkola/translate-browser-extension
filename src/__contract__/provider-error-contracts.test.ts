/**
 * Provider Error Contract Tests
 *
 * Validates that ALL cloud translation providers handle error scenarios
 * consistently:
 *   - Network error  (fetch throws)
 *   - 401 Unauthorized → should mention auth / API key
 *   - 429 Rate Limited → should be retryable (message mentions rate limit)
 *   - 500 Server Error → should throw
 */

import { describe, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic';
import { OpenAIProvider } from '../providers/openai';
import { DeepLProvider } from '../providers/deepl';
import { GoogleCloudProvider } from '../providers/google-cloud';
import {
  defineProviderErrorTests,
  installCloudProviderTestHarness,
} from './cloud-provider-test-harness';

const {
  resetCloudProviderState,
  queueRejectedFetch,
  queueHttpError,
} = installCloudProviderTestHarness();

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../core/language-map', () => ({
  getLanguageName: (code: string) => {
    const names: Record<string, string> = {
      en: 'English',
      fi: 'Finnish',
      de: 'German',
    };
    return names[code] ?? code;
  },
  getAllLanguageCodes: () => ['en', 'fi', 'de'],
  toDeepLCode: (code: string) => {
    const map: Record<string, string> = { en: 'EN', fi: 'FI', de: 'DE' };
    return map[code.toLowerCase()] ?? code.toUpperCase();
  },
  getDeepLSupportedLanguages: () => ['en', 'fi', 'de'],
}));

// ---------------------------------------------------------------------------
// Provider factory: create + initialise each cloud provider
// ---------------------------------------------------------------------------

interface CloudProviderEntry {
  name: string;
  storageKey: string;
  create: () =>
    | AnthropicProvider
    | OpenAIProvider
    | DeepLProvider
    | GoogleCloudProvider;
}

const CLOUD_PROVIDERS: CloudProviderEntry[] = [
  {
    name: 'Anthropic',
    storageKey: 'anthropic_api_key',
    create: () => new AnthropicProvider(),
  },
  {
    name: 'OpenAI',
    storageKey: 'openai_api_key',
    create: () => new OpenAIProvider(),
  },
  {
    name: 'DeepL',
    storageKey: 'deepl_api_key',
    create: () => new DeepLProvider(),
  },
  {
    name: 'Google Cloud',
    storageKey: 'google_cloud_api_key',
    create: () => new GoogleCloudProvider(),
  },
];

// =========================================================================
// Run the same error-contract suite for every cloud provider
// =========================================================================

describe.each(CLOUD_PROVIDERS)(
  '$name error contract',
  ({ storageKey, create }) => {
    let provider: ReturnType<typeof create>;

    beforeEach(async () => {
      resetCloudProviderState({
        seed: { [storageKey]: 'test-api-key-12345' },
      });
      provider = create();
      await provider.initialize();
    });

    defineProviderErrorTests({
      run: () => provider.translate('Hello', 'en', 'fi'),
      cases: [
        {
          title: 'throws on network error (fetch rejects)',
          arrange: () => {
            queueRejectedFetch(new TypeError('Failed to fetch'));
          },
          expected: {
            retryable: true,
            messagePattern: /fetch|network|connect/i,
          },
        },
        {
          title: '401 error is categorised as auth',
          arrange: () => {
            queueHttpError(401, '{"error":"invalid_api_key"}');
          },
          expected: {
            category: 'auth',
            messagePattern: /api.key|auth|unauthorized/i,
            technicalDetailsPattern: /api.key|invalid/i,
          },
        },
        {
          title: '429 error is categorised as rate_limit',
          arrange: () => {
            queueHttpError(429, '{"error":"rate_limit_exceeded"}');
          },
          expected: {
            category: 'rate_limit',
            retryable: true,
            messagePattern: /rate.limit|too many requests/i,
          },
        },
        {
          title: '500 error propagates as thrown error',
          arrange: () => {
            queueHttpError(500, 'Internal Server Error');
          },
          expected: {
            messagePattern: /server.error|internal/i,
            technicalDetailsPattern: /server.error|internal/i,
          },
        },
      ],
    });
  },
);
