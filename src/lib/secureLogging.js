/**
 * Secure logging utilities with sensitive data redaction
 * Prevents accidental logging of API keys, tokens, and other secrets
 */

import { logger } from './logger.js';

/**
 * Patterns for detecting sensitive data in logs
 */
const SENSITIVE_PATTERNS = [
  // API keys
  /api[_-]?key['":\s]*[=:]\s*["']?[a-zA-Z0-9+/]{20,}["']?/gi,
  /bearer\s+[a-zA-Z0-9+/]{20,}/gi,
  /sk-[a-zA-Z0-9]{48}/gi, // OpenAI style
  /pk-[a-zA-Z0-9]{48}/gi, // Public keys

  // Authorization headers
  /authorization['":\s]*[=:]\s*["']?bearer\s+[^"'\s]+["']?/gi,
  /authorization['":\s]*[=:]\s*["']?[^"'\s]{20,}["']?/gi,

  // Common secret patterns
  /password['":\s]*[=:]\s*["']?[^"'\s]{8,}["']?/gi,
  /secret['":\s]*[=:]\s*["']?[^"'\s]{16,}["']?/gi,
  /token['":\s]*[=:]\s*["']?[a-zA-Z0-9+/]{16,}["']?/gi,

  // Credit card numbers
  /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,

  // Email addresses (partial redaction)
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
];

/**
 * Keys that should be completely redacted if present
 */
const REDACTED_KEYS = new Set([
  'apiKey', 'api_key', 'apikey',
  'password', 'pass', 'pwd',
  'secret', 'secretKey', 'secret_key',
  'token', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token',
  'authorization', 'auth',
  'privateKey', 'private_key',
  'clientSecret', 'client_secret'
]);

/**
 * Redact sensitive information from a string
 */
export function redactSensitiveData(text) {
  if (typeof text !== 'string') {
    return text;
  }

  let redacted = text;

  // Apply pattern-based redaction
  SENSITIVE_PATTERNS.forEach(pattern => {
    redacted = redacted.replace(pattern, (match) => {
      if (match.includes('=') || match.includes(':')) {
        // Keep the key name but redact the value
        const parts = match.split(/[=:]/);
        const key = parts[0].trim();
        return `${key}="[REDACTED]"`;
      }
      return '[REDACTED]';
    });
  });

  return redacted;
}

/**
 * Redact sensitive keys from an object recursively
 */
export function redactSensitiveKeys(obj, maxDepth = 10) {
  if (maxDepth <= 0 || obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveKeys(item, maxDepth - 1));
  }

  const redacted = {};

  Object.entries(obj).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();

    if (REDACTED_KEYS.has(lowerKey)) {
      // Completely redact sensitive keys
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 16) {
      // Check if string value looks like a secret
      if (SENSITIVE_PATTERNS.some(pattern => pattern.test(value))) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value);
      }
    } else if (typeof value === 'object') {
      redacted[key] = redactSensitiveKeys(value, maxDepth - 1);
    } else {
      redacted[key] = value;
    }
  });

  return redacted;
}

/**
 * Secure logger wrapper that automatically redacts sensitive data
 */
export class SecureLogger {
  constructor(baseLogger = logger) {
    this.baseLogger = baseLogger;
  }

  debug(component, message, data = null) {
    this.baseLogger.debug(component, this.sanitizeMessage(message), this.sanitizeData(data));
  }

  info(component, message, data = null) {
    this.baseLogger.info(component, this.sanitizeMessage(message), this.sanitizeData(data));
  }

  warn(component, message, data = null) {
    this.baseLogger.warn(component, this.sanitizeMessage(message), this.sanitizeData(data));
  }

  error(component, message, data = null) {
    this.baseLogger.error(component, this.sanitizeMessage(message), this.sanitizeData(data));
  }

  sanitizeMessage(message) {
    if (typeof message === 'string') {
      return redactSensitiveData(message);
    }
    return message;
  }

  sanitizeData(data) {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return redactSensitiveData(data);
    }

    if (typeof data === 'object') {
      return redactSensitiveKeys(data);
    }

    return data;
  }
}

/**
 * Global secure logger instance
 */
export const secureLogger = new SecureLogger(logger);

/**
 * Utility to safely log configuration objects
 */
export function logConfig(component, config) {
  const safeConfig = redactSensitiveKeys(config);
  logger.debug(component, 'Configuration loaded', safeConfig);
}

/**
 * Utility to safely log API requests (without sensitive headers)
 */
export function logAPIRequest(component, url, method = 'GET', headers = {}) {
  const safeHeaders = redactSensitiveKeys(headers);
  logger.debug(component, `API Request: ${method} ${url}`, { headers: safeHeaders });
}

/**
 * Test function to verify redaction is working
 */
export function testRedaction() {
  const testData = {
    apiKey: 'sk-1234567890abcdef1234567890abcdef12345678',
    password: 'mySecretPassword123',
    normalField: 'this should not be redacted',
    authorization: 'Bearer sk-1234567890abcdef1234567890abcdef12345678',
    nested: {
      secret: 'another-secret-value',
      publicData: 'visible data'
    }
  };

  const redacted = redactSensitiveKeys(testData);
  console.log('Original:', testData);
  console.log('Redacted:', redacted);

  const testString = 'API request with apiKey="sk-1234567890abcdef" failed';
  const redactedString = redactSensitiveData(testString);
  console.log('Original string:', testString);
  console.log('Redacted string:', redactedString);
}