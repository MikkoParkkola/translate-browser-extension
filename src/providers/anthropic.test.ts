/**
 * Anthropic Provider unit tests
 *
 * Tests for Claude translation provider.
 * Note: Actual API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installCloudProviderTestHarness } from '../__contract__/cloud-provider-test-harness';
import { AnthropicProvider } from './anthropic';

const {
  mockStorage,
  resetStorage,
  mockFetch,
  queueJsonResponse,
  queueRejectedFetch,
  queueHttpError,
  queueFetchSequence,
} = installCloudProviderTestHarness();

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStorage();
    provider = new AnthropicProvider();
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
      await expect(
        noKeyProvider.translate('Hello', 'en', 'fi'),
      ).rejects.toThrow();
    });

    it('sends correct request for single text', async () => {
      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        usage: { input_tokens: 10, output_tokens: 5 },
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
      queueJsonResponse({
        content: [
          {
            type: 'text',
            text: '<text id="0">Hei</text>\n<text id="1">Maailma</text>',
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('includes source language hint when not auto', async () => {
      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('English');
    });

    it('handles API error responses', async () => {
      queueHttpError(401, 'Unauthorized');

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles rate limit errors', async () => {
      queueHttpError(429, 'Rate limited', { headers: { 'Retry-After': '60' } });

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

      queueJsonResponse({
        content: [{ type: 'text', text: 'en' }],
      });

      const result = await provider.detectLanguage('Hello world');
      expect(result).toBe('en');
    });

    it('returns auto on API error', async () => {
      await provider.setApiKey('sk-test-key');

      queueHttpError(500);

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('uses Haiku model for detection', async () => {
      await provider.setApiKey('sk-test-key');
      await provider.setModel('claude-sonnet-4-20250514');

      queueJsonResponse({
        content: [{ type: 'text', text: 'en' }],
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

      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      await provider.setApiKey('sk-test-key');

      queueRejectedFetch(new Error('Network error'));

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

  describe('formality branches in system prompt', () => {
    it('includes formal instruction in system prompt', async () => {
      await provider.setApiKey('sk-test-key');
      await provider.setFormality('formal');

      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toContain(
        'Use formal register and polite forms where appropriate.',
      );
    });

    it('includes informal instruction in system prompt', async () => {
      await provider.setApiKey('sk-test-key');
      await provider.setFormality('informal');

      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toContain('Use casual, conversational language.');
    });
  });

  describe('batch XML fill missing', () => {
    it('fills missing items with empty string when XML is incomplete', async () => {
      await provider.setApiKey('sk-test-key');

      queueJsonResponse({
        content: [
          {
            type: 'text',
            text: '<text id="0">Hei</text>',
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      });

      const result = await provider.translate(
        ['Hello', 'World', 'Foo'],
        'en',
        'fi',
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', '', '']);
    });
  });

  describe('detectLanguage error catch', () => {
    it('returns auto when fetch throws during detectLanguage', async () => {
      await provider.setApiKey('sk-test-key');

      queueRejectedFetch(new Error('Network error'));

      const result = await provider.detectLanguage('Bonjour');
      expect(result).toBe('auto');
    });
  });

  describe('setApiKey when config already exists', () => {
    it('updates existing config apiKey without resetting other fields', async () => {
      // Initialize provider so config is set
      mockStorage['anthropic_api_key'] = 'sk-original';
      const freshProvider = new AnthropicProvider();
      await freshProvider.initialize();

      // Now call setApiKey — should update existing config via the truthy branch
      await freshProvider.setApiKey('sk-updated');

      // Verify storage was updated and provider remains available
      expect(mockStorage['anthropic_api_key']).toBe('sk-updated');
      expect(await freshProvider.isAvailable()).toBe(true);
    });
  });

  describe('buildSystemPrompt formality branches (lines 147-155)', () => {
    it('includes formal instruction for formal tone', async () => {
      const freshProvider = new AnthropicProvider();
      mockStorage['anthropic_api_key'] = 'sk-key';
      mockStorage['anthropic_formality'] = 'formal';

      await freshProvider.initialize();

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Formal response' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await freshProvider.translate('hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.system).toContain('formal');
    });

    it('includes informal instruction for informal tone', async () => {
      const freshProvider = new AnthropicProvider();
      mockStorage['anthropic_api_key'] = 'sk-key';
      mockStorage['anthropic_formality'] = 'informal';

      await freshProvider.initialize();

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Informal response' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await freshProvider.translate('hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.system).toContain('casual');
    });

    it('omits formality instruction for neutral tone', async () => {
      const freshProvider = new AnthropicProvider();
      mockStorage['anthropic_api_key'] = 'sk-key';
      mockStorage['anthropic_formality'] = 'neutral';

      await freshProvider.initialize();

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Neutral response' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await freshProvider.translate('hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      const systemMsg = body.system;
      expect(systemMsg).not.toContain('formal register');
      expect(systemMsg).not.toContain('colloquial');
    });
  });

  describe('translate batch handling', () => {
    it('parses numbered <tN> XML tags for batch translations (primary format)', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '<t0>Hei</t0>\n<t1>Maailma</t1>',
          },
        ],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 10 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('pads results when batch returns fewer translations than input', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '<text id="0">Hei</text>', // Only one translation
          },
        ],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 10 },
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

    it('includes extra translations when batch returns more than input', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '<text id="0">Hei</text>\n<text id="1">Maailma</text>\n<text id="2">Extra</text>',
          },
        ],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 15 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      // Provider returns all parsed results, doesn't truncate
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0]).toBe('Hei');
      expect(result[1]).toBe('Maailma');
      expect(result[2]).toBe('Extra');
    });
  });

  describe('translate with missing content (line 233)', () => {
    it('handles missing text in content array', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text' }], // Missing text field
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('');
    });

    it('handles empty content array', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [], // Empty content
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('');
    });
  });

  describe('detectLanguage response handling (line 284)', () => {
    it('returns auto when detected language is empty string', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '' }], // Empty
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      const result = await provider.detectLanguage('text');
      expect(result).toBe('auto');
    });

    it('returns detected language when response is 2-letter code', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'FI' }], // Uppercase
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      const result = await provider.detectLanguage('Terve');
      expect(result).toBe('fi'); // Should be lowercased
    });

    it('returns auto when detected language is longer than 2 chars', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Finnish' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });
  });

  describe('setFormality and setModel when config exists', () => {
    it('setFormality updates existing config', async () => {
      const freshProvider = new AnthropicProvider();
      mockStorage['anthropic_api_key'] = 'sk-key';
      mockStorage['anthropic_formality'] = 'neutral';

      await freshProvider.initialize();
      await freshProvider.setFormality('formal');

      expect(mockStorage['anthropic_formality']).toBe('formal');
    });

    it('setModel updates existing config', async () => {
      const freshProvider = new AnthropicProvider();
      mockStorage['anthropic_api_key'] = 'sk-key';
      mockStorage['anthropic_model'] = 'claude-3-5-haiku-20241022';

      await freshProvider.initialize();
      await freshProvider.setModel('claude-sonnet-4-20250514');

      expect(mockStorage['anthropic_model']).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('clearApiKey fully resets state', () => {
    it('removes all config keys from storage', async () => {
      mockStorage['anthropic_api_key'] = 'key';
      mockStorage['anthropic_model'] = 'claude-3-5-haiku-20241022';
      mockStorage['anthropic_formality'] = 'formal';
      mockStorage['anthropic_tokens_used'] = 1000;

      await provider.clearApiKey();

      expect(mockStorage['anthropic_api_key']).toBeUndefined();
      expect(mockStorage['anthropic_model']).toBeUndefined();
      expect(mockStorage['anthropic_formality']).toBeUndefined();
      expect(mockStorage['anthropic_tokens_used']).toBeUndefined();
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('translate with source language hint', () => {
    it('includes source language in prompt for known languages', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hei' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.translate('Hello', 'en', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.messages[0].content).toContain('[Source language: English]');
    });

    it('omits source hint for auto-detection', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Translated' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.translate('Hello', 'auto', 'fi');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.messages[0].content).not.toContain('[Source language:');
    });
  });

  describe('error handling in translate', () => {
    it('handles malformed response json gracefully', async () => {
      await provider.setApiKey('key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles response.text() error when response is not ok', async () => {
      await provider.setApiKey('key');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('Cannot read text')),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns extensive language pair combinations', () => {
      const pairs = provider.getSupportedLanguages();

      expect(pairs.length).toBeGreaterThan(500);

      for (const pair of pairs) {
        expect(pair.src).not.toBe(pair.tgt);
      }
    });
  });

  describe('initialize error handling (line 80)', () => {
    it('catches and logs error when chrome.storage.local.get throws', async () => {
      const freshProvider = new AnthropicProvider();

      // Mock chrome.storage to throw an error
      const mockGetError = new Error('Storage access denied');
      vi.mocked(chrome.storage.local.get as any).mockRejectedValueOnce(
        mockGetError,
      );

      // Should not throw — safeStorageGet handles the error at the storage layer
      await expect(freshProvider.initialize()).resolves.not.toThrow();
      // Provider remains uninitialised (no API key in empty result)
      expect(await freshProvider.isAvailable()).toBe(false);
    });
  });

  describe('getUsage', () => {
    it('returns zero usage initially', async () => {
      const freshProvider = new AnthropicProvider();
      const usage = await freshProvider.getUsage();
      expect(usage.tokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.limitReached).toBe(false);
    });

    it('tracks token usage across translations', async () => {
      await provider.setApiKey('key');

      queueFetchSequence(
        {
          type: 'json',
          body: {
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hei' }],
            model: 'claude-3-5-haiku-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        },
        {
          type: 'json',
          body: {
            id: 'msg-2',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Maailma' }],
            model: 'claude-3-5-haiku-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 15, output_tokens: 8 },
          },
        },
      );

      await provider.translate('Hello', 'en', 'fi');
      await provider.translate('World', 'en', 'fi');

      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(38); // 10+5+15+8
    });
  });

  // ---------------------------------------------------------------------------
  // Coverage: setModel/setFormality when config is null (branches at lines 105, 115)
  // ---------------------------------------------------------------------------

  describe('setModel and setFormality without config', () => {
    it('setModel is a no-op on config when config is null', async () => {
      const freshProvider = new AnthropicProvider();
      // Do NOT call initialize or setApiKey — config remains null
      await freshProvider.setModel('claude-sonnet-4-20250514');

      // Storage was updated
      expect(mockStorage['anthropic_model']).toBe('claude-sonnet-4-20250514');
      // But getInfo still shows default since config is null
      const info = freshProvider.getInfo();
      expect(info.model).toBe('claude-3-5-haiku-20241022');
    });

    it('setFormality is a no-op on config when config is null', async () => {
      const freshProvider = new AnthropicProvider();
      // Do NOT call initialize or setApiKey — config remains null
      await freshProvider.setFormality('formal');

      // Storage was updated
      expect(mockStorage['anthropic_formality']).toBe('formal');
      // But getInfo still shows default since config is null
      const info = freshProvider.getInfo();
      expect(info.formality).toBe('neutral');
    });
  });

  // ---------------------------------------------------------------------------
  // Coverage: response without usage field (branch at line 230)
  // ---------------------------------------------------------------------------

  describe('translate response missing usage field', () => {
    it('handles response without usage object', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        // No usage field
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('Hei');

      // Token count should remain at 0
      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Coverage: single-element array returns [translated] (branch at line 258)
  // ---------------------------------------------------------------------------

  describe('translate with single-element array', () => {
    it('wraps result in array when input is single-element array', async () => {
      await provider.setApiKey('sk-key');

      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await provider.translate(['Hello'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei']);
    });
  });

  // ---------------------------------------------------------------------------
  // Coverage: batch XML fallback parsing (lines 247-267)
  // ---------------------------------------------------------------------------

  describe('batch XML fallback parsing', () => {
    beforeEach(async () => {
      await provider.setApiKey('sk-test-key');
    });

    it('falls back to legacy <text id="N"> format when <tN> tags are absent', async () => {
      queueJsonResponse({
        content: [
          {
            type: 'text',
            text: '<text id="0">Hei</text>\n<text id="1">Maailma</text>',
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('falls back to newline splitting when no XML tags are present', async () => {
      queueJsonResponse({
        content: [
          {
            type: 'text',
            text: 'Hei\nMaailma',
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('returns empty strings for each input when response is empty', async () => {
      queueJsonResponse({
        content: [
          {
            type: 'text',
            text: '',
          },
        ],
        usage: { input_tokens: 20, output_tokens: 0 },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['', '']);
    });
  });

  // ---------------------------------------------------------------------------
  // Coverage: chrome.storage.local.set catch in token tracking (stmt at line 232)
  // ---------------------------------------------------------------------------

  describe('token tracking storage failure', () => {
    it('continues without throwing when storage.set fails during token tracking', async () => {
      await provider.setApiKey('sk-key');

      // Make storage.set reject for the token usage write
      // @ts-expect-error unused side-effect
      const _originalSet = chrome.storage.local.set;
      vi.mocked(chrome.storage.local.set as any).mockImplementationOnce(
        (items: Record<string, unknown>) => {
          // Allow the setApiKey call to succeed, but fail on token tracking
          if ('anthropic_tokens_used' in items) {
            return Promise.reject(new Error('Storage quota exceeded'));
          }
          Object.assign(mockStorage, items);
          return Promise.resolve();
        },
      );

      queueJsonResponse({
        content: [{ type: 'text', text: 'Hei' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      // Should not throw despite storage failure
      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('Hei');
    });
  });
});
