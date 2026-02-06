/**
 * Anthropic Provider unit tests
 *
 * Tests for Claude translation provider.
 * Note: Actual API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from './anthropic';

// Mock chrome.storage
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

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    provider = new AnthropicProvider();
  });

  describe('constructor', () => {
    it('sets correct provider info', () => {
      const info = provider.getInfo();
      expect(info.id).toBe('anthropic');
      expect(info.name).toBe('Claude');
      expect(info.type).toBe('cloud');
      expect(info.qualityTier).toBe('premium');
    });

    it('sets cost per million', () => {
      expect(provider.costPerMillion).toBe(3000);
    });
  });

  describe('initialize', () => {
    it('loads config from storage when API key exists', async () => {
      mockStorage['anthropic_api_key'] = 'sk-test-key';
      mockStorage['anthropic_model'] = 'claude-sonnet-4-20250514';
      mockStorage['anthropic_formality'] = 'formal';
      mockStorage['anthropic_tokens_used'] = 1000;

      await provider.initialize();

      expect(await provider.isAvailable()).toBe(true);
      const info = provider.getInfo();
      expect(info.model).toBe('claude-sonnet-4-20250514');
      expect(info.formality).toBe('formal');
    });

    it('handles missing API key', async () => {
      await provider.initialize();
      expect(await provider.isAvailable()).toBe(false);
    });

    it('uses default model and formality when not set', async () => {
      mockStorage['anthropic_api_key'] = 'sk-test-key';

      await provider.initialize();

      const info = provider.getInfo();
      expect(info.model).toBe('claude-3-5-haiku-20241022');
      expect(info.formality).toBe('neutral');
    });
  });

  describe('setApiKey', () => {
    it('stores API key in storage', async () => {
      await provider.setApiKey('sk-new-key');

      expect(mockStorage['anthropic_api_key']).toBe('sk-new-key');
      expect(await provider.isAvailable()).toBe(true);
    });

    it('initializes config with defaults', async () => {
      await provider.setApiKey('sk-new-key');

      const info = provider.getInfo();
      expect(info.model).toBe('claude-3-5-haiku-20241022');
      expect(info.formality).toBe('neutral');
    });
  });

  describe('setModel', () => {
    it('stores model preference', async () => {
      await provider.setApiKey('sk-key');
      await provider.setModel('claude-sonnet-4-20250514');

      expect(mockStorage['anthropic_model']).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('setFormality', () => {
    it('stores formality preference', async () => {
      await provider.setApiKey('sk-key');
      await provider.setFormality('formal');

      expect(mockStorage['anthropic_formality']).toBe('formal');
    });
  });

  describe('clearApiKey', () => {
    it('removes all config from storage', async () => {
      mockStorage['anthropic_api_key'] = 'sk-key';
      mockStorage['anthropic_model'] = 'claude-sonnet-4-20250514';
      mockStorage['anthropic_formality'] = 'formal';
      mockStorage['anthropic_tokens_used'] = 1000;

      await provider.setApiKey('sk-key');
      await provider.clearApiKey();

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('returns false without API key', async () => {
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns true with API key', async () => {
      mockStorage['anthropic_api_key'] = 'sk-key';
      await provider.initialize();
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns all language pair combinations', () => {
      const pairs = provider.getSupportedLanguages();

      // Should have many pairs (n * (n-1) for n languages)
      expect(pairs.length).toBeGreaterThan(100);

      // Each pair should have src and tgt
      for (const pair of pairs) {
        expect(pair).toHaveProperty('src');
        expect(pair).toHaveProperty('tgt');
        expect(pair.src).not.toBe(pair.tgt);
      }

      // Should include common pairs
      expect(pairs).toContainEqual({ src: 'en', tgt: 'fi' });
      expect(pairs).toContainEqual({ src: 'fi', tgt: 'en' });
      expect(pairs).toContainEqual({ src: 'de', tgt: 'fr' });
    });
  });

  describe('translate', () => {
    beforeEach(async () => {
      await provider.setApiKey('sk-test-key');
    });

    it('throws when API key not configured', async () => {
      const noKeyProvider = new AnthropicProvider();
      await expect(noKeyProvider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('sends correct request for single text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Hei' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      });

      const result = await provider.translate('Hello', 'en', 'fi');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('https://api.anthropic.com/v1/messages');

      const options = call[1];
      expect(options.method).toBe('POST');
      expect(options.headers['x-api-key']).toBe('sk-test-key');
      expect(options.headers['anthropic-version']).toBe('2023-06-01');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('claude-3-5-haiku-20241022');
      expect(body.messages[0].role).toBe('user');

      expect(result).toBe('Hei');
    });

    it('sends correct request for batch texts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [
              {
                type: 'text',
                text: '<text id="0">Hei</text>\n<text id="1">Maailma</text>',
              },
            ],
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('includes source language hint when not auto', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Hei' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('English');
    });

    it('handles API error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
        headers: {
          get: () => null,
        },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
        headers: {
          get: (key: string) => (key === 'Retry-After' ? '60' : null),
        },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });
  });

  describe('detectLanguage', () => {
    it('returns auto without API key', async () => {
      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('detects language with API key', async () => {
      await provider.setApiKey('sk-test-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'en' }],
          }),
      });

      const result = await provider.detectLanguage('Hello world');
      expect(result).toBe('en');
    });

    it('returns auto on API error', async () => {
      await provider.setApiKey('sk-test-key');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('uses Haiku model for detection', async () => {
      await provider.setApiKey('sk-test-key');
      await provider.setModel('claude-sonnet-4-20250514');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'en' }],
          }),
      });

      await provider.detectLanguage('Hello');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-3-5-haiku-20241022');
    });
  });

  describe('getUsage', () => {
    it('returns zero usage initially', async () => {
      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.limitReached).toBe(false);
    });

    it('calculates cost based on model', async () => {
      mockStorage['anthropic_api_key'] = 'sk-key';
      mockStorage['anthropic_model'] = 'claude-3-5-haiku-20241022';
      mockStorage['anthropic_tokens_used'] = 1000;

      await provider.initialize();
      const usage = await provider.getUsage();

      // Haiku: $0.00025 per 1K tokens
      expect(usage.tokens).toBe(1000);
      expect(usage.cost).toBeCloseTo(0.00025);
    });
  });

  describe('test', () => {
    it('returns true on successful translation', async () => {
      await provider.setApiKey('sk-test-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Hei' }],
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      await provider.setApiKey('sk-test-key');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.test();
      expect(result).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('includes model and formality', async () => {
      await provider.setApiKey('sk-key');
      await provider.setModel('claude-sonnet-4-20250514');
      await provider.setFormality('formal');

      const info = provider.getInfo();

      expect(info.model).toBe('claude-sonnet-4-20250514');
      expect(info.formality).toBe('formal');
      expect(info.id).toBe('anthropic');
      expect(info.name).toBe('Claude');
    });
  });
});
