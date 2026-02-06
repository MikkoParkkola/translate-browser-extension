/**
 * Shared HTTP error handling for translation providers
 * Centralizes common HTTP status code handling across all cloud providers
 */

export interface HttpErrorResult {
  message: string;
  retryable: boolean;
  retryAfter?: number; // milliseconds
}

/**
 * Parse Retry-After header value
 * Supports both delta-seconds and HTTP-date formats
 */
function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }

  // Try parsing as seconds first (most common)
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000; // Convert to milliseconds
  }

  // Try parsing as HTTP-date
  const date = Date.parse(headerValue);
  if (!isNaN(date)) {
    const delay = date - Date.now();
    return delay > 0 ? delay : undefined;
  }

  return undefined;
}

/**
 * Handle common HTTP errors across all translation providers
 * Returns a standardized error result with message, retryability, and optional retry delay
 *
 * @param status HTTP status code
 * @param provider Provider name for error messages (e.g., 'OpenAI', 'DeepL')
 * @param responseText Optional response body text for additional context
 * @param retryAfterHeader Optional Retry-After header value
 */
export function handleProviderHttpError(
  status: number,
  provider: string,
  responseText?: string,
  retryAfterHeader?: string | null
): HttpErrorResult {
  // Parse retry-after for rate limits
  const retryAfter = parseRetryAfter(retryAfterHeader ?? null);

  switch (status) {
    // Authentication errors
    case 401:
      return {
        message: `Invalid ${provider} API key`,
        retryable: false,
      };

    // Payment required
    case 402:
      return {
        message: `${provider} payment required - check your billing`,
        retryable: false,
      };

    // Forbidden (could be invalid key or API not enabled)
    case 403:
      return {
        message: `${provider} access forbidden - check API key or permissions`,
        retryable: false,
      };

    // Rate limiting
    case 429:
      return {
        message: `${provider} rate limit exceeded`,
        retryable: true,
        retryAfter: retryAfter ?? 60000, // Default to 60s if no header
      };

    // DeepL-specific: quota exceeded
    case 456:
      return {
        message: `${provider} quota exceeded`,
        retryable: false,
      };

    // Server errors (5xx) - generally retryable
    case 500:
      return {
        message: `${provider} internal server error`,
        retryable: true,
        retryAfter: 5000, // Wait 5s before retry
      };

    case 502:
      return {
        message: `${provider} service temporarily unavailable (bad gateway)`,
        retryable: true,
        retryAfter: 10000,
      };

    case 503:
      return {
        message: `${provider} service temporarily unavailable`,
        retryable: true,
        retryAfter: retryAfter ?? 30000,
      };

    case 504:
      return {
        message: `${provider} gateway timeout`,
        retryable: true,
        retryAfter: 15000,
      };

    // Anthropic-specific: API overloaded
    case 529:
      return {
        message: `${provider} API overloaded`,
        retryable: true,
        retryAfter: retryAfter ?? 30000,
      };

    // Bad request - usually not retryable
    case 400:
      return {
        message: responseText
          ? `${provider} bad request: ${truncateMessage(responseText)}`
          : `${provider} bad request`,
        retryable: false,
      };

    // Default for other errors
    default:
      if (status >= 500 && status < 600) {
        // Other 5xx errors are retryable
        return {
          message: `${provider} server error (${status})`,
          retryable: true,
          retryAfter: 10000,
        };
      }
      return {
        message: responseText
          ? `${provider} error (${status}): ${truncateMessage(responseText)}`
          : `${provider} error (${status})`,
        retryable: false,
      };
  }
}

/**
 * Truncate error message for display (avoid huge JSON dumps)
 */
function truncateMessage(text: string, maxLength: number = 200): string {
  // Try to parse as JSON and extract message field
  try {
    const parsed = JSON.parse(text);
    if (parsed.error?.message) {
      return truncateString(parsed.error.message, maxLength);
    }
    if (parsed.message) {
      return truncateString(parsed.message, maxLength);
    }
  } catch {
    // Not JSON, use raw text
  }

  return truncateString(text, maxLength);
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}
