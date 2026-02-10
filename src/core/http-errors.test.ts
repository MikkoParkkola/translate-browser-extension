/**
 * HTTP error handling unit tests
 */

import { describe, it, expect } from 'vitest';
import { handleProviderHttpError } from './http-errors';

describe('handleProviderHttpError', () => {
  const provider = 'TestProvider';

  describe('authentication errors (401)', () => {
    it('returns non-retryable error with API key message', () => {
      const result = handleProviderHttpError(401, provider);
      expect(result.message).toBe('Invalid TestProvider API key');
      expect(result.retryable).toBe(false);
      expect(result.retryAfter).toBeUndefined();
    });
  });

  describe('payment required (402)', () => {
    it('returns non-retryable error with billing message', () => {
      const result = handleProviderHttpError(402, provider);
      expect(result.message).toBe('TestProvider payment required - check your billing');
      expect(result.retryable).toBe(false);
    });
  });

  describe('forbidden (403)', () => {
    it('returns non-retryable error with permissions message', () => {
      const result = handleProviderHttpError(403, provider);
      expect(result.message).toBe('TestProvider access forbidden - check API key or permissions');
      expect(result.retryable).toBe(false);
    });
  });

  describe('rate limiting (429)', () => {
    it('returns retryable error with default 60s delay', () => {
      const result = handleProviderHttpError(429, provider);
      expect(result.message).toBe('TestProvider rate limit exceeded');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(60000);
    });

    it('uses Retry-After header when provided as seconds', () => {
      const result = handleProviderHttpError(429, provider, undefined, '30');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(30000);
    });

    it('uses Retry-After header when provided as HTTP-date', () => {
      const futureDate = new Date(Date.now() + 10000).toUTCString();
      const result = handleProviderHttpError(429, provider, undefined, futureDate);
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(11000);
    });

    it('uses default when Retry-After header is null', () => {
      const result = handleProviderHttpError(429, provider, undefined, null);
      expect(result.retryAfter).toBe(60000);
    });
  });

  describe('DeepL quota exceeded (456)', () => {
    it('returns non-retryable error', () => {
      const result = handleProviderHttpError(456, provider);
      expect(result.message).toBe('TestProvider quota exceeded');
      expect(result.retryable).toBe(false);
    });
  });

  describe('server errors (5xx)', () => {
    it('handles 500 internal server error', () => {
      const result = handleProviderHttpError(500, provider);
      expect(result.message).toBe('TestProvider internal server error');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(5000);
    });

    it('handles 502 bad gateway', () => {
      const result = handleProviderHttpError(502, provider);
      expect(result.message).toBe('TestProvider service temporarily unavailable (bad gateway)');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(10000);
    });

    it('handles 503 service unavailable with default delay', () => {
      const result = handleProviderHttpError(503, provider);
      expect(result.message).toBe('TestProvider service temporarily unavailable');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(30000);
    });

    it('handles 503 with Retry-After header', () => {
      const result = handleProviderHttpError(503, provider, undefined, '15');
      expect(result.retryAfter).toBe(15000);
    });

    it('handles 504 gateway timeout', () => {
      const result = handleProviderHttpError(504, provider);
      expect(result.message).toBe('TestProvider gateway timeout');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(15000);
    });

    it('handles unknown 5xx errors as retryable', () => {
      const result = handleProviderHttpError(599, provider);
      expect(result.message).toBe('TestProvider server error (599)');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(10000);
    });

    it('handles 501 as generic 5xx', () => {
      const result = handleProviderHttpError(501, provider);
      expect(result.message).toBe('TestProvider server error (501)');
      expect(result.retryable).toBe(true);
    });
  });

  describe('Anthropic overloaded (529)', () => {
    it('returns retryable error with default 30s delay', () => {
      const result = handleProviderHttpError(529, provider);
      expect(result.message).toBe('TestProvider API overloaded');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(30000);
    });

    it('uses Retry-After header when provided', () => {
      const result = handleProviderHttpError(529, provider, undefined, '10');
      expect(result.retryAfter).toBe(10000);
    });
  });

  describe('bad request (400)', () => {
    it('returns non-retryable error without response text', () => {
      const result = handleProviderHttpError(400, provider);
      expect(result.message).toBe('TestProvider bad request');
      expect(result.retryable).toBe(false);
    });

    it('includes truncated response text', () => {
      const result = handleProviderHttpError(400, provider, 'Invalid parameter: foo');
      expect(result.message).toBe('TestProvider bad request: Invalid parameter: foo');
      expect(result.retryable).toBe(false);
    });

    it('extracts message from JSON error response', () => {
      const jsonBody = JSON.stringify({ error: { message: 'Missing required field' } });
      const result = handleProviderHttpError(400, provider, jsonBody);
      expect(result.message).toBe('TestProvider bad request: Missing required field');
    });

    it('extracts top-level message from JSON response', () => {
      const jsonBody = JSON.stringify({ message: 'Bad input format' });
      const result = handleProviderHttpError(400, provider, jsonBody);
      expect(result.message).toBe('TestProvider bad request: Bad input format');
    });
  });

  describe('default/unknown status codes', () => {
    it('handles unknown 4xx as non-retryable', () => {
      const result = handleProviderHttpError(418, provider);
      expect(result.message).toBe('TestProvider error (418)');
      expect(result.retryable).toBe(false);
    });

    it('includes response text for unknown codes', () => {
      const result = handleProviderHttpError(418, provider, 'I am a teapot');
      expect(result.message).toBe('TestProvider error (418): I am a teapot');
      expect(result.retryable).toBe(false);
    });

    it('handles status code 0', () => {
      const result = handleProviderHttpError(0, provider);
      expect(result.message).toBe('TestProvider error (0)');
      expect(result.retryable).toBe(false);
    });
  });

  describe('provider name in messages', () => {
    it('uses custom provider name', () => {
      const result = handleProviderHttpError(401, 'OpenAI');
      expect(result.message).toBe('Invalid OpenAI API key');
    });

    it('uses another provider name', () => {
      const result = handleProviderHttpError(429, 'DeepL');
      expect(result.message).toBe('DeepL rate limit exceeded');
    });
  });

  describe('Retry-After header parsing', () => {
    it('handles valid seconds value', () => {
      const result = handleProviderHttpError(429, provider, undefined, '120');
      expect(result.retryAfter).toBe(120000);
    });

    it('handles zero seconds (falls back to default)', () => {
      const result = handleProviderHttpError(429, provider, undefined, '0');
      expect(result.retryAfter).toBe(60000); // Falls back to default
    });

    it('handles negative seconds (falls back to default)', () => {
      const result = handleProviderHttpError(429, provider, undefined, '-10');
      expect(result.retryAfter).toBe(60000);
    });

    it('handles invalid string (falls back to default)', () => {
      const result = handleProviderHttpError(429, provider, undefined, 'not-a-number');
      expect(result.retryAfter).toBe(60000);
    });

    it('handles past HTTP-date (falls back to default)', () => {
      const pastDate = new Date(Date.now() - 60000).toUTCString();
      const result = handleProviderHttpError(429, provider, undefined, pastDate);
      expect(result.retryAfter).toBe(60000);
    });

    it('handles empty string (falls back to default)', () => {
      const result = handleProviderHttpError(429, provider, undefined, '');
      expect(result.retryAfter).toBe(60000);
    });
  });

  describe('response text truncation', () => {
    it('truncates long response text', () => {
      const longText = 'a'.repeat(500);
      const result = handleProviderHttpError(400, provider, longText);
      expect(result.message.length).toBeLessThan(300);
      expect(result.message).toContain('...');
    });

    it('does not truncate short response text', () => {
      const result = handleProviderHttpError(400, provider, 'short error');
      expect(result.message).toBe('TestProvider bad request: short error');
      expect(result.message).not.toContain('...');
    });

    it('truncates JSON error messages that are too long', () => {
      const longMsg = 'x'.repeat(500);
      const jsonBody = JSON.stringify({ error: { message: longMsg } });
      const result = handleProviderHttpError(400, provider, jsonBody);
      expect(result.message.length).toBeLessThan(300);
    });
  });
});
