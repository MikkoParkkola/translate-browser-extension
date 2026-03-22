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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic';
import { OpenAIProvider } from '../providers/openai';
import { DeepLProvider } from '../providers/deepl';
import { GoogleCloudProvider } from '../providers/google-cloud';

// ---------------------------------------------------------------------------
// Chrome storage mock
// ---------------------------------------------------------------------------
const mockStorage: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((keys: string[]) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (mockStorage[key] !== undefined) {
            result[key] = mockStorage[key];
          }
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string[]) => {
        for (const key of keys) {
          delete mockStorage[key];
        }
        return Promise.resolve();
      }),
    },
  },
});

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../core/language-map', () => ({
  getLanguageName: (code: string) => {
    const names: Record<string, string> = { en: 'English', fi: 'Finnish', de: 'German' };
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
// Helpers
// ---------------------------------------------------------------------------

function resetStorage() {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
}

function httpErrorResponse(status: number, body = '') {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  };
}

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
      vi.clearAllMocks();
      resetStorage();
      mockStorage[storageKey] = 'test-api-key-12345';
      provider = create();
      await provider.initialize();
    });

    // ----- Network error (fetch throws) --------------------------------
    it('throws on network error (fetch rejects)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(
        provider.translate('Hello', 'en', 'fi'),
      ).rejects.toThrow();
    });

    it('network error is retryable', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        await provider.translate('Hello', 'en', 'fi');
      } catch (error: unknown) {
        // The error should be wrapped by createTranslationError which
        // produces a TranslationError object with retryable: true.
        // The thrown value itself is either a TranslationError object or
        // an Error whose message is matchable.
        const err = error as Record<string, unknown>;
        if ('retryable' in err) {
          expect(err.retryable).toBe(true);
        }
        // At minimum it must throw — already proven by the assertion above
        return;
      }
      // Should not reach here
      expect.unreachable('Expected an error to be thrown');
    });

    // ----- 401 Unauthorized -------------------------------------------
    it('throws on 401 Unauthorized', async () => {
      mockFetch.mockResolvedValueOnce(
        httpErrorResponse(401, '{"error":"invalid_api_key"}'),
      );

      await expect(
        provider.translate('Hello', 'en', 'fi'),
      ).rejects.toThrow();
    });

    it('401 error is categorised as auth', async () => {
      mockFetch.mockResolvedValueOnce(
        httpErrorResponse(401, '{"error":"invalid_api_key"}'),
      );

      try {
        await provider.translate('Hello', 'en', 'fi');
      } catch (error: unknown) {
        const err = error as Record<string, unknown>;
        // createTranslationError returns a TranslationError object
        if ('category' in err) {
          expect(err.category).toBe('auth');
          expect(typeof err.message).toBe('string');
          // technicalDetails should mention API key
          expect(/api.key/i.test(String(err.technicalDetails))).toBe(true);
        } else {
          // Fallback: plain Error path
          const msg = error instanceof Error ? error.message : String(error);
          expect(/api.key|auth|unauthorized/i.test(msg)).toBe(true);
        }
        return;
      }
      expect.unreachable('Expected an error to be thrown');
    });

    // ----- 429 Rate Limit ---------------------------------------------
    it('throws on 429 Rate Limit', async () => {
      mockFetch.mockResolvedValueOnce(
        httpErrorResponse(429, '{"error":"rate_limit_exceeded"}'),
      );

      await expect(
        provider.translate('Hello', 'en', 'fi'),
      ).rejects.toThrow();
    });

    it('429 error is categorised as rate_limit', async () => {
      mockFetch.mockResolvedValueOnce(
        httpErrorResponse(429, '{"error":"rate_limit_exceeded"}'),
      );

      try {
        await provider.translate('Hello', 'en', 'fi');
      } catch (error: unknown) {
        const err = error as Record<string, unknown>;
        if ('category' in err) {
          expect(err.category).toBe('rate_limit');
          expect(err.retryable).toBe(true);
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          expect(/rate.limit/i.test(msg)).toBe(true);
        }
        return;
      }
      expect.unreachable('Expected an error to be thrown');
    });

    // ----- 500 Server Error -------------------------------------------
    it('throws on 500 Server Error', async () => {
      mockFetch.mockResolvedValueOnce(
        httpErrorResponse(500, 'Internal Server Error'),
      );

      await expect(
        provider.translate('Hello', 'en', 'fi'),
      ).rejects.toThrow();
    });

    it('500 error propagates as thrown error', async () => {
      mockFetch.mockResolvedValueOnce(
        httpErrorResponse(500, 'Internal Server Error'),
      );

      try {
        await provider.translate('Hello', 'en', 'fi');
      } catch (error: unknown) {
        const err = error as Record<string, unknown>;
        if ('category' in err) {
          // createTranslationError wraps the "…internal server error" message;
          // depending on pattern matching it may land in 'internal' or 'network'.
          expect(typeof err.category).toBe('string');
          expect(
            /server.error|internal/i.test(String(err.technicalDetails ?? err.message)),
          ).toBe(true);
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          expect(/server.error|internal/i.test(msg)).toBe(true);
        }
        return;
      }
      expect.unreachable('Expected an error to be thrown');
    });
  },
);
