/**
 * OpenAI Provider unit tests
 *
 * Tests for OpenAI GPT translation provider.
 * Note: Actual API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';

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

// Mock language-map module
vi.mock('../core/language-map', () => ({
  getLanguageName: (code: string) => {
    const map: Record<string, string> = {
      en: 'English',
      fi: 'Finnish',
      de: 'German',
      fr: 'French',
      es: 'Spanish',
      ja: 'Japanese',
      zh: 'Chinese',
    };
    return map[code.toLowerCase()] || code;
  },
  getAllLanguageCodes: () => ['en', 'fi', 'de', 'fr', 'es', 'it', 'ja', 'zh', 'ko', 'ru'],
}));

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    provider = new OpenAIProvider();
  });

  describe('constructor', () => {
    it('sets correct provider info', () => {
      const info = provider.getInfo();
      expect(info.id).toBe('openai');
      expect(info.name).toBe('OpenAI GPT-4');
      expect(info.type).toBe('cloud');
      expect(info.qualityTier).toBe('premium');
    });

    it('sets cost per million', () => {
      expect(provider.costPerMillion).toBe(5000);
    });
  });

  describe('initialize', () => {
    it('loads config from storage when API key exists', async () => {
      mockStorage['openai_api_key'] = 'sk-test-key';
      mockStorage['openai_model'] = 'gpt-4o';
      mockStorage['openai_formality'] = 'formal';
      mockStorage['openai_temperature'] = 0.5;
      mockStorage['openai_tokens_used'] = 2000;

      await provider.initialize();

      expect(await provider.isAvailable()).toBe(true);
      const info = provider.getInfo();
      expect(info.model).toBe('gpt-4o');
      expect(info.formality).toBe('formal');
    });

    it('handles missing API key', async () => {
      await provider.initialize();
      expect(await provider.isAvailable()).toBe(false);
    });

    it('uses default settings when not set', async () => {
      mockStorage['openai_api_key'] = 'sk-key';

      await provider.initialize();

      const info = provider.getInfo();
      expect(info.model).toBe('gpt-4o-mini');
      expect(info.formality).toBe('neutral');
    });
  });

  describe('setApiKey', () => {
    it('stores API key in storage', async () => {
      await provider.setApiKey('sk-new-key');

      expect(mockStorage['openai_api_key']).toBe('sk-new-key');
      expect(await provider.isAvailable()).toBe(true);
    });

    it('initializes config with defaults', async () => {
      await provider.setApiKey('sk-key');

      const info = provider.getInfo();
      expect(info.model).toBe('gpt-4o-mini');
      expect(info.formality).toBe('neutral');
    });
  });

  describe('setModel', () => {
    it('stores model preference', async () => {
      await provider.setApiKey('sk-key');
      await provider.setModel('gpt-4o');

      expect(mockStorage['openai_model']).toBe('gpt-4o');
    });
  });

  describe('setFormality', () => {
    it('stores formality preference', async () => {
      await provider.setApiKey('sk-key');
      await provider.setFormality('informal');

      expect(mockStorage['openai_formality']).toBe('informal');
    });
  });

  describe('clearApiKey', () => {
    it('removes all config from storage', async () => {
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_model'] = 'gpt-4o';
      mockStorage['openai_formality'] = 'formal';
      mockStorage['openai_temperature'] = 0.5;

      await provider.setApiKey('sk-key');
      await provider.clearApiKey();

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('translate', () => {
    beforeEach(async () => {
      await provider.setApiKey('sk-test-key');
    });

    it('throws when API key not configured', async () => {
      const noKeyProvider = new OpenAIProvider();
      await expect(noKeyProvider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('sends correct request for single text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Hei' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          }),
      });

      const result = await provider.translate('Hello', 'en', 'fi');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('https://api.openai.com/v1/chat/completions');

      const options = call[1];
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer sk-test-key');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');

      expect(result).toBe('Hei');
    });

    it('includes formality instructions for formal', async () => {
      await provider.setFormality('formal');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Test' } }],
            usage: { total_tokens: 20 },
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content.toLowerCase()).toContain('formal');
    });

    it('includes formality instructions for informal', async () => {
      await provider.setFormality('informal');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Test' } }],
            usage: { total_tokens: 20 },
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content.toLowerCase()).toContain('informal');
    });

    it('handles batch translation with separators', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: 'Hei\n---TRANSLATE_SEPARATOR---\nMaailma',
                },
              },
            ],
            usage: { total_tokens: 30 },
          }),
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('fills missing results in batch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: { content: 'Only one result' },
              },
            ],
            usage: { total_tokens: 20 },
          }),
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Only one result');
      expect(result[1]).toBe('');
    });

    it('includes source language hint when not auto', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Hei' } }],
            usage: { total_tokens: 20 },
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1].content).toContain('English');
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid API key'),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles rate limits', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
        headers: { get: (k: string) => (k === 'Retry-After' ? '30' : null) },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('tracks token usage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Hei' } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(60);
    });
  });

  describe('detectLanguage', () => {
    it('returns auto without API key', async () => {
      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('detects language using chat API', async () => {
      await provider.setApiKey('sk-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'fi' } }],
          }),
      });

      const result = await provider.detectLanguage('Hei maailma');
      expect(result).toBe('fi');
    });

    it('uses mini model for detection', async () => {
      await provider.setApiKey('sk-key');
      await provider.setModel('gpt-4o');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'en' } }],
          }),
      });

      await provider.detectLanguage('Hello');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
    });

    it('uses temperature 0 for detection', async () => {
      await provider.setApiKey('sk-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'en' } }],
          }),
      });

      await provider.detectLanguage('Hello');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0);
    });

    it('returns auto for non-2-letter responses', async () => {
      await provider.setApiKey('sk-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'English' } }],
          }),
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('returns auto on API error', async () => {
      await provider.setApiKey('sk-key');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });
  });

  describe('getUsage', () => {
    it('returns zero usage initially', async () => {
      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.limitReached).toBe(false);
    });

    it('calculates cost based on model - gpt-4o-mini', async () => {
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_model'] = 'gpt-4o-mini';
      mockStorage['openai_tokens_used'] = 1000;

      await provider.initialize();
      const usage = await provider.getUsage();

      // gpt-4o-mini: $0.00015 per 1K tokens
      expect(usage.tokens).toBe(1000);
      expect(usage.cost).toBeCloseTo(0.00015);
    });

    it('calculates cost based on model - gpt-4o', async () => {
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_model'] = 'gpt-4o';
      mockStorage['openai_tokens_used'] = 1000;

      await provider.initialize();
      const usage = await provider.getUsage();

      // gpt-4o: $0.005 per 1K tokens
      expect(usage.tokens).toBe(1000);
      expect(usage.cost).toBeCloseTo(0.005);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns all language pair combinations', () => {
      const pairs = provider.getSupportedLanguages();

      expect(pairs.length).toBeGreaterThan(50);

      for (const pair of pairs) {
        expect(pair.src).not.toBe(pair.tgt);
      }
    });

    it('includes common pairs', () => {
      const pairs = provider.getSupportedLanguages();

      expect(pairs).toContainEqual({ src: 'en', tgt: 'fi' });
      expect(pairs).toContainEqual({ src: 'fi', tgt: 'en' });
      expect(pairs).toContainEqual({ src: 'ja', tgt: 'zh' });
    });
  });

  describe('test', () => {
    it('returns true on successful translation', async () => {
      await provider.setApiKey('sk-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Hei' } }],
            usage: { total_tokens: 20 },
          }),
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      await provider.setApiKey('sk-key');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.test();
      expect(result).toBe(false);
    });

    it('returns false on empty response', async () => {
      await provider.setApiKey('sk-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: '' } }],
            usage: { total_tokens: 10 },
          }),
      });

      const result = await provider.test();
      expect(result).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('includes model and formality', async () => {
      await provider.setApiKey('sk-key');
      await provider.setModel('gpt-4-turbo');
      await provider.setFormality('informal');

      const info = provider.getInfo();

      expect(info.model).toBe('gpt-4-turbo');
      expect(info.formality).toBe('informal');
      expect(info.id).toBe('openai');
      expect(info.name).toBe('OpenAI GPT-4');
    });
  });
});
