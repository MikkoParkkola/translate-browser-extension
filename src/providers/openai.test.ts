/**
 * OpenAI Provider unit tests
 *
 * Tests for OpenAI GPT translation provider.
 * Note: Actual API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installCloudProviderTestHarness } from '../__contract__/cloud-provider-test-harness';
import { OpenAIProvider } from './openai';

const {
  mockStorage,
  resetStorage,
  mockFetch,
  queueJsonResponse,
  queueRejectedFetch,
  queueHttpError,
} = installCloudProviderTestHarness();

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
  getAllLanguageCodes: () => [
    'en',
    'fi',
    'de',
    'fr',
    'es',
    'it',
    'ja',
    'zh',
    'ko',
    'ru',
  ],
}));

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStorage();
    provider = new OpenAIProvider();
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

  describe('translate', () => {
    beforeEach(async () => {
      await provider.setApiKey('sk-test-key');
    });

    it('throws when API key not configured', async () => {
      const noKeyProvider = new OpenAIProvider();
      await expect(
        noKeyProvider.translate('Hello', 'en', 'fi'),
      ).rejects.toThrow();
    });

    it('sends correct request for single text', async () => {
      queueJsonResponse({
        choices: [{ message: { content: 'Hei' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
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

      queueJsonResponse({
        choices: [{ message: { content: 'Test' } }],
        usage: { total_tokens: 20 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content.toLowerCase()).toContain('formal');
    });

    it('includes formality instructions for informal', async () => {
      await provider.setFormality('informal');

      queueJsonResponse({
        choices: [{ message: { content: 'Test' } }],
        usage: { total_tokens: 20 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content.toLowerCase()).toContain('informal');
    });

    it('handles batch translation with separators', async () => {
      queueJsonResponse({
        choices: [
          {
            message: {
              content: 'Hei\n---TRANSLATE_SEPARATOR---\nMaailma',
            },
          },
        ],
        usage: { total_tokens: 30 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('fills missing results in batch', async () => {
      queueJsonResponse({
        choices: [
          {
            message: { content: 'Only one result' },
          },
        ],
        usage: { total_tokens: 20 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Only one result');
      expect(result[1]).toBe('');
    });

    it('includes source language hint when not auto', async () => {
      queueJsonResponse({
        choices: [{ message: { content: 'Hei' } }],
        usage: { total_tokens: 20 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1].content).toContain('English');
    });

    it('handles API errors', async () => {
      queueHttpError(401, 'Invalid API key');

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles API errors when response.text() fails (line 215)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('Failed to read error body')),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles rate limits', async () => {
      queueHttpError(429, 'Rate limited', { headers: { 'Retry-After': '30' } });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('tracks token usage', async () => {
      queueJsonResponse({
        choices: [{ message: { content: 'Hei' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
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

      queueJsonResponse({
        choices: [{ message: { content: 'fi' } }],
      });

      const result = await provider.detectLanguage('Hei maailma');
      expect(result).toBe('fi');
    });

    it('uses mini model for detection', async () => {
      await provider.setApiKey('sk-key');
      await provider.setModel('gpt-4o');

      queueJsonResponse({
        choices: [{ message: { content: 'en' } }],
      });

      await provider.detectLanguage('Hello');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
    });

    it('uses temperature 0 for detection', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'en' } }],
      });

      await provider.detectLanguage('Hello');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0);
    });

    it('returns auto for non-2-letter responses', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'English' } }],
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('returns auto on API error', async () => {
      await provider.setApiKey('sk-key');

      queueRejectedFetch(new Error('Network error'));

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

      queueJsonResponse({
        choices: [{ message: { content: 'Hei' } }],
        usage: { total_tokens: 20 },
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      await provider.setApiKey('sk-key');

      queueRejectedFetch(new Error('Network error'));

      const result = await provider.test();
      expect(result).toBe(false);
    });

    it('returns false on empty response', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: '' } }],
        usage: { total_tokens: 10 },
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
      expect(info.name).toBe('OpenAI');
    });
  });

  describe('initialize error', () => {
    it('does not crash when chrome.storage.local.get throws', async () => {
      (
        chrome.storage.local.get as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('Storage error'));

      await expect(provider.initialize()).resolves.not.toThrow();
    });
  });

  describe('setApiKey when config is null', () => {
    it('creates config with defaults when config is null', async () => {
      // Fresh provider, never initialized — config is null
      const freshProvider = new OpenAIProvider();

      await freshProvider.setApiKey('sk-new-key');

      const info = freshProvider.getInfo();
      expect(info.model).toBe('gpt-4o-mini');
      expect(info.formality).toBe('neutral');
    });
  });

  describe('setApiKey when config already exists', () => {
    it('updates existing config apiKey without resetting other fields', async () => {
      // Initialize provider so config is set
      mockStorage['openai_api_key'] = 'sk-original';
      mockStorage['openai_model'] = 'gpt-4o';
      const freshProvider = new OpenAIProvider();
      await freshProvider.initialize();

      // Now call setApiKey — should update existing config, not create new one
      await freshProvider.setApiKey('sk-updated');

      // Verify storage was updated and provider remains available
      expect(mockStorage['openai_api_key']).toBe('sk-updated');
      expect(await freshProvider.isAvailable()).toBe(true);
    });
  });

  describe('buildPrompt formality branches (lines 151-156)', () => {
    it('includes formal instruction for formal tone', async () => {
      const freshProvider = new OpenAIProvider();
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_formality'] = 'formal';

      await freshProvider.initialize();

      queueJsonResponse({
        choices: [{ message: { content: 'Formal translation' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      await freshProvider.translate('hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.messages[0].content).toContain('formal');
    });

    it('includes informal instruction for informal tone', async () => {
      const freshProvider = new OpenAIProvider();
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_formality'] = 'informal';

      await freshProvider.initialize();

      queueJsonResponse({
        choices: [{ message: { content: 'Informal translation' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      await freshProvider.translate('hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.messages[0].content).toContain('informal');
    });

    it('omits formality instruction for neutral tone', async () => {
      const freshProvider = new OpenAIProvider();
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_formality'] = 'neutral';

      await freshProvider.initialize();

      queueJsonResponse({
        choices: [{ message: { content: 'Neutral translation' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      await freshProvider.translate('hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      const systemMsg = body.messages[0].content;
      // Should not add formality instruction for neutral
      expect(systemMsg).not.toContain('formal language');
      expect(systemMsg).not.toContain('casual');
    });
  });

  describe('translate batch handling (lines 236-242)', () => {
    it('parses <tN> XML tags for batch translations (primary format)', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [
          {
            message: {
              content: '<t0>Hei</t0>\n<t1>Maailma</t1>',
            },
          },
        ],
        usage: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('falls back to separator splitting when no XML tags found', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [
          {
            message: {
              content: 'Hei\n---TRANSLATE_SEPARATOR---\nMaailma',
            },
          },
        ],
        usage: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('pads results when batch returns fewer translations than input', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [
          {
            message: {
              content: 'Hei', // Only one translation
            },
          },
        ],
        usage: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10 },
      });

      const result = await provider.translate(
        ['Hello', 'World', 'Test'],
        'en',
        'fi',
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0]).toBe('Hei');
      expect(result[1]).toBe(''); // Padded
      expect(result[2]).toBe(''); // Padded
    });

    it('truncates results when batch returns more translations than input', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [
          {
            message: {
              content:
                'Hei\n---TRANSLATE_SEPARATOR---\nMaailma\n---TRANSLATE_SEPARATOR---\nExtra',
            },
          },
        ],
        usage: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result).toEqual(['Hei', 'Maailma']);
    });
  });

  describe('translate with missing usage data (line 228)', () => {
    it('handles missing usage field gracefully', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'Hei' } }],
        // No usage field
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('Hei');

      // Should not crash, tokens should remain unchanged
      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(0);
    });
  });

  describe('translate missing content (line 233)', () => {
    it('handles null message content', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: null } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('');
    });

    it('handles missing message field', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: undefined }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('');
    });

    it('handles missing choices array', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('');
    });
  });

  describe('detectLanguage response handling (lines 282-287)', () => {
    it('returns auto when detected language is empty string', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: '' } }],
        usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
      });

      const result = await provider.detectLanguage('text');
      expect(result).toBe('auto');
    });

    it('returns detected language when response is 2-letter code', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'FI' } }], // Uppercase
        usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
      });

      const result = await provider.detectLanguage('Terve');
      expect(result).toBe('fi'); // Should be lowercased
    });

    it('returns auto when detected language is longer than 2 chars', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'English' } }],
        usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });
  });

  describe('setFormality when config exists', () => {
    it('updates existing config formality', async () => {
      const freshProvider = new OpenAIProvider();
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_formality'] = 'neutral';

      await freshProvider.initialize();
      await freshProvider.setFormality('formal');

      expect(mockStorage['openai_formality']).toBe('formal');
    });

    it('creates config if null before setFormality', async () => {
      const freshProvider = new OpenAIProvider();
      // No API key, so config won't initialize
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (freshProvider as any).config = null;

      await freshProvider.setFormality('informal');

      // setFormality doesn't create config, only updates it
      // So this should not create config
      expect(await freshProvider.isAvailable()).toBe(false);
    });
  });

  describe('setModel when config exists', () => {
    it('updates existing config model', async () => {
      const freshProvider = new OpenAIProvider();
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_model'] = 'gpt-4o-mini';

      await freshProvider.initialize();
      await freshProvider.setModel('gpt-4o');

      expect(mockStorage['openai_model']).toBe('gpt-4o');
    });
  });

  describe('clearApiKey fully resets state', () => {
    it('removes all config keys from storage', async () => {
      mockStorage['openai_api_key'] = 'key';
      mockStorage['openai_model'] = 'gpt-4o';
      mockStorage['openai_formality'] = 'formal';
      mockStorage['openai_temperature'] = 0.5;

      await provider.clearApiKey();

      expect(mockStorage['openai_api_key']).toBeUndefined();
      expect(mockStorage['openai_model']).toBeUndefined();
      expect(mockStorage['openai_formality']).toBeUndefined();
      expect(mockStorage['openai_temperature']).toBeUndefined();
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('getUsage with different models', () => {
    it('calculates cost correctly for gpt-4o', async () => {
      const freshProvider = new OpenAIProvider();
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_model'] = 'gpt-4o';
      mockStorage['openai_tokens_used'] = 1000;

      await freshProvider.initialize();

      const usage = await freshProvider.getUsage();
      // gpt-4o: $0.005 per 1K tokens
      expect(usage.cost).toBeCloseTo(0.005);
    });

    it('calculates cost for gpt-3.5-turbo', async () => {
      const freshProvider = new OpenAIProvider();
      mockStorage['openai_api_key'] = 'sk-key';
      mockStorage['openai_model'] = 'gpt-3.5-turbo';
      mockStorage['openai_tokens_used'] = 1000;

      await freshProvider.initialize();

      const usage = await freshProvider.getUsage();
      // gpt-3.5-turbo: $0.0005 per 1K tokens
      expect(usage.cost).toBeCloseTo(0.0005);
    });
  });

  describe('translate with source language hint', () => {
    it('includes source language in prompt for known languages', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'Hei' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.messages[1].content).toContain('[Source: English]');
    });

    it('omits source hint for auto-detection', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'Translated' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      await provider.translate('Hello', 'auto', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.messages[1].content).not.toContain('[Source:');
    });
  });

  describe('setModel when config exists (line 108)', () => {
    it('updates model in existing config', async () => {
      await provider.setApiKey('sk-key');
      expect(provider.getInfo().model).toBe('gpt-4o-mini');

      await provider.setModel('gpt-4-turbo');
      expect(provider.getInfo().model).toBe('gpt-4-turbo');
    });

    it('initializes config when config is null before setModel', async () => {
      // Create fresh provider without config
      const freshProvider = new OpenAIProvider();
      expect((freshProvider as any).config).toBeNull();

      // setModel stores to storage but config remains null if not set via setApiKey
      await freshProvider.setModel('gpt-4-turbo');

      // Config should still be null (only apiKey creation initializes config)
      expect((freshProvider as any).config).toBeNull();
    });
  });

  describe('translate single text wrapped in array (line 245)', () => {
    it('returns single translated text wrapped in array when input is array of length 1', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'Hei' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      const result = await provider.translate(['Hello'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei']);
    });
  });

  describe('token tracking storage failure', () => {
    it('continues without throwing when storage.set fails during token tracking', async () => {
      await provider.setApiKey('sk-key');

      vi.mocked(chrome.storage.local.set as any).mockImplementationOnce(
        (items: Record<string, unknown>) => {
          if ('openai_tokens_used' in items) {
            return Promise.reject(new Error('Storage quota exceeded'));
          }
          Object.assign(mockStorage, items);
          return Promise.resolve();
        },
      );

      queueJsonResponse({
        choices: [{ message: { content: 'Hei' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      });

      const result = await provider.translate('Hello', 'en', 'fi');

      expect(result).toBe('Hei');
    });
  });

  describe('detectLanguage response not ok (line 282)', () => {
    it('returns auto when detectLanguage response is not ok', async () => {
      await provider.setApiKey('sk-key');

      queueHttpError(500);

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('returns auto when detectLanguage detects invalid response', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        choices: [{ message: { content: 'invalid' } }],
        usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });
  });
});
