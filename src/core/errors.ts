/**
 * Error handling utilities for the translation extension
 * Provides user-friendly error messages and categorized error types
 */

// Error categories for routing to appropriate handlers
export type ErrorCategory =
  | 'network'
  | 'model'
  | 'memory'
  | 'input'
  | 'language'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'internal';

// User-friendly error with technical details preserved
export interface TranslationError {
  category: ErrorCategory;
  message: string;        // User-friendly message
  technicalDetails: string; // For logging
  retryable: boolean;
  suggestion?: string;    // Actionable advice for user
}

// Common error patterns to detect
const ERROR_PATTERNS = {
  network: [
    /fetch failed/i,
    /network/i,
    /ERR_NETWORK/i,
    /ERR_CONNECTION/i,
    /ERR_INTERNET/i,
    /offline/i,
    /CORS/i,
    /Failed to fetch/i,
    /net::/i,
    /Connection refused/i,
    /timeout.*network/i,
  ],
  memory: [
    /out of memory/i,
    /OOM/i,
    /allocation failed/i,
    /memory limit/i,
    /heap/i,
    /RangeError.*Maximum/i,
    /WebAssembly.*memory/i,
    /wasm.*memory/i,
  ],
  model: [
    /model.*download/i,
    /model.*load/i,
    /model.*not found/i,
    /HuggingFace/i,
    /pipeline/i,
    /transformers/i,
    /ONNX/i,
    /wasm.*load/i,
    /WebGPU/i,
  ],
  language: [
    /unsupported language/i,
    /language pair/i,
    /invalid.*lang/i,
    /unknown language/i,
  ],
  timeout: [
    /timeout/i,
    /timed out/i,
    /deadline/i,
    /took too long/i,
    /AbortError/i,
    /aborted/i,
  ],
  auth: [
    /401/,
    /403/,
    /unauthorized/i,
    /forbidden/i,
    /invalid.*api.*key/i,
    /authentication/i,
    /not configured/i,
    /API key/i,
  ],
  rate_limit: [
    /429/,
    /rate.?limit/i,
    /too many requests/i,
    /quota.*exceeded/i,
    /limit.*reached/i,
    /Retry-After/i,
  ],
  input: [
    /invalid input/i,
    /empty text/i,
    /text too long/i,
    /invalid character/i,
    /malformed/i,
  ],
};

/**
 * Categorize an error based on its message
 */
function categorizeError(error: unknown): ErrorCategory {
  const message = error instanceof Error ? error.message : String(error);

  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(message))) {
      return category as ErrorCategory;
    }
  }

  return 'internal';
}

/**
 * Create a user-friendly error from any thrown value
 */
export function createTranslationError(error: unknown): TranslationError {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const category = categorizeError(error);

  switch (category) {
    case 'network':
      return {
        category,
        message: 'Unable to connect to translation service',
        technicalDetails: rawMessage,
        retryable: true,
        suggestion: 'Check your internet connection and try again',
      };

    case 'memory':
      return {
        category,
        message: 'Not enough memory to complete translation',
        technicalDetails: rawMessage,
        retryable: true,
        suggestion: 'Try closing other tabs or using a smaller text selection',
      };

    case 'model':
      return {
        category,
        message: 'Translation model failed to load',
        technicalDetails: rawMessage,
        retryable: true,
        suggestion: 'The model may still be downloading. Please wait and try again.',
      };

    case 'language': {
      // Extract language codes from error message if available
      const pairMatch = rawMessage.match(/(\w+)\s*->\s*(\w+)/);
      const sourceLang = pairMatch?.[1]?.toUpperCase() || 'source';
      const targetLang = pairMatch?.[2]?.toUpperCase() || 'target';

      return {
        category,
        message: `${sourceLang} to ${targetLang} translation not available`,
        technicalDetails: rawMessage,
        retryable: false,
        suggestion: 'Try selecting a different language pair, or switch to a cloud provider (DeepL, OpenAI) for more language options.',
      };
    }

    case 'timeout':
      return {
        category,
        message: 'Translation request timed out',
        technicalDetails: rawMessage,
        retryable: true,
        suggestion: 'The service may be slow. Try again, or use a shorter text.',
      };

    case 'auth':
      return {
        category,
        message: 'Authentication failed',
        technicalDetails: rawMessage,
        retryable: false,
        suggestion: 'Check your API key in Settings. It may be invalid or expired.',
      };

    case 'rate_limit':
      return {
        category,
        message: 'Too many requests',
        technicalDetails: rawMessage,
        retryable: true,
        suggestion: 'You have hit the API rate limit. Wait a moment and try again.',
      };

    case 'input':
      return {
        category,
        message: 'Invalid text for translation',
        technicalDetails: rawMessage,
        retryable: false,
        suggestion: 'Please check the text and try again',
      };

    default:
      return {
        category: 'internal',
        message: 'Translation failed unexpectedly',
        technicalDetails: rawMessage,
        retryable: true,
        suggestion: 'Please try again. If the problem persists, reload the extension.',
      };
  }
}

/**
 * Exponential backoff configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number; // 0-1, adds randomness to prevent thundering herd
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
};

/**
 * Calculate delay for retry attempt with exponential backoff and jitter
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter: delay +/- (jitterFactor * delay)
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);

  return Math.max(config.baseDelayMs, Math.floor(cappedDelay + jitter));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  shouldRetry?: (error: TranslationError) => boolean
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: TranslationError | null = null;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = createTranslationError(error);

      // Check if we should retry
      const canRetry = shouldRetry
        ? shouldRetry(lastError)
        : lastError.retryable;

      if (!canRetry || attempt === fullConfig.maxRetries) {
        throw error;
      }

      const delay = calculateRetryDelay(attempt, fullConfig);
      console.log(
        `[Retry] Attempt ${attempt + 1}/${fullConfig.maxRetries} failed: ${lastError.message}. ` +
        `Retrying in ${delay}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Input validation for translation text
 */
export interface InputValidationResult {
  valid: boolean;
  error?: TranslationError;
  sanitizedText?: string | string[];
}

// Maximum text length per request (in characters)
export const MAX_TEXT_LENGTH = 10000;
// Maximum batch size
export const MAX_BATCH_SIZE = 100;

/**
 * Validate and sanitize translation input
 */
export function validateInput(
  text: string | string[],
  sourceLang: string,
  targetLang: string
): InputValidationResult {
  // Check for empty input
  if (!text) {
    return {
      valid: false,
      error: {
        category: 'input',
        message: 'No text provided for translation',
        technicalDetails: 'Input text was null, undefined, or empty',
        retryable: false,
        suggestion: 'Please select or enter some text to translate',
      },
    };
  }

  // Handle array input
  if (Array.isArray(text)) {
    if (text.length === 0) {
      return {
        valid: false,
        error: {
          category: 'input',
          message: 'No text provided for translation',
          technicalDetails: 'Input array was empty',
          retryable: false,
        },
      };
    }

    if (text.length > MAX_BATCH_SIZE) {
      return {
        valid: false,
        error: {
          category: 'input',
          message: `Too many texts in batch (max ${MAX_BATCH_SIZE})`,
          technicalDetails: `Batch size ${text.length} exceeds limit of ${MAX_BATCH_SIZE}`,
          retryable: false,
          suggestion: 'Please translate fewer items at once',
        },
      };
    }

    // Sanitize each text in array
    const sanitized = text.map(t => sanitizeText(t));
    const totalLength = sanitized.reduce((sum, t) => sum + t.length, 0);

    if (totalLength > MAX_TEXT_LENGTH * 2) {
      return {
        valid: false,
        error: {
          category: 'input',
          message: 'Total text length exceeds maximum',
          technicalDetails: `Total length ${totalLength} exceeds limit`,
          retryable: false,
          suggestion: 'Please translate smaller portions of text',
        },
      };
    }

    return { valid: true, sanitizedText: sanitized };
  }

  // Handle string input
  const sanitized = sanitizeText(text);

  if (sanitized.length === 0) {
    return {
      valid: false,
      error: {
        category: 'input',
        message: 'Text contains no translatable content',
        technicalDetails: 'After sanitization, text was empty',
        retryable: false,
      },
    };
  }

  if (sanitized.length > MAX_TEXT_LENGTH) {
    return {
      valid: false,
      error: {
        category: 'input',
        message: `Text too long (max ${MAX_TEXT_LENGTH} characters)`,
        technicalDetails: `Text length ${sanitized.length} exceeds limit of ${MAX_TEXT_LENGTH}`,
        retryable: false,
        suggestion: 'Please select a smaller portion of text',
      },
    };
  }

  // Validate language codes (basic check)
  if (sourceLang !== 'auto' && !/^[a-z]{2,3}$/i.test(sourceLang)) {
    return {
      valid: false,
      error: {
        category: 'language',
        message: 'Invalid source language code',
        technicalDetails: `Source language "${sourceLang}" is not a valid ISO code`,
        retryable: false,
      },
    };
  }

  if (!/^[a-z]{2,3}$/i.test(targetLang)) {
    return {
      valid: false,
      error: {
        category: 'language',
        message: 'Invalid target language code',
        technicalDetails: `Target language "${targetLang}" is not a valid ISO code`,
        retryable: false,
      },
    };
  }

  return { valid: true, sanitizedText: sanitized };
}

/**
 * Sanitize text for translation - remove problematic characters
 */
function sanitizeText(text: string): string {
  return text
    // Normalize Unicode
    .normalize('NFC')
    // Remove null bytes and other control characters (except newlines/tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize whitespace (but preserve newlines)
    .replace(/[ \t]+/g, ' ')
    // Trim
    .trim();
}

/**
 * Check if an error is a specific type for targeted handling
 */
export function isNetworkError(error: unknown): boolean {
  return categorizeError(error) === 'network';
}

export function isMemoryError(error: unknown): boolean {
  return categorizeError(error) === 'memory';
}

export function isModelError(error: unknown): boolean {
  return categorizeError(error) === 'model';
}

export function isRetryableError(error: unknown): boolean {
  const translationError = createTranslationError(error);
  return translationError.retryable;
}
