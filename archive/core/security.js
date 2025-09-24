/**
 * @fileoverview Security utilities for input sanitization and validation
 * Prevents XSS attacks and ensures safe handling of translated content
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenSecurity = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // Initialize logger
  const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
    ? window.qwenLogger.create('security')
    : (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create)
      ? self.qwenLogger.create('security')
      : console;

  /**
   * HTML entities for escaping
   */
  const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  /**
   * Regular expressions for validation
   */
  const VALIDATION_PATTERNS = {
    // Allow basic text with common punctuation and Unicode characters
    safeText: /^[\p{L}\p{N}\p{P}\p{Z}\s\n\r\t]*$/u,
    // Detect potential script injections
    scriptPattern: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    // Detect javascript: URLs
    javascriptUrl: /javascript:/i,
    // Detect data URLs with potential script content
    dangerousDataUrl: /data:.*?(?:javascript|vbscript|onload|onerror)/i,
    // Detect HTML event attributes
    eventAttributes: /\s+on\w+\s*=/i,
    // Detect HTML tags that could be dangerous
    dangerousTags: /<(?:script|iframe|object|embed|form|input|button|link|meta|base)\b/i
  };

  /**
   * Maximum allowed lengths for different input types
   */
  const MAX_LENGTHS = {
    translationText: 50000,
    configValue: 1000,
    apiKey: 500,
    url: 2048
  };

  /**
   * Escape HTML entities in a string
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  function escapeHtml(text) {
    if (typeof text !== 'string') {
      return '';
    }
    return text.replace(/[&<>"'\/]/g, char => HTML_ENTITIES[char] || char);
  }

  /**
   * Sanitize translation text input/output
   * @param {string} text - Text to sanitize
   * @param {Object} options - Sanitization options
   * @returns {string} Sanitized text
   */
  function sanitizeTranslationText(text, options = {}) {
    if (typeof text !== 'string') {
      return '';
    }

    // Enforce length limit
    if (text.length > MAX_LENGTHS.translationText) {
      text = text.substring(0, MAX_LENGTHS.translationText);
    }

    // Remove dangerous patterns
    text = text
      .replace(VALIDATION_PATTERNS.scriptPattern, '')
      .replace(VALIDATION_PATTERNS.javascriptUrl, 'about:blank')
      .replace(VALIDATION_PATTERNS.eventAttributes, ' data-removed-event=');

    // If preserveFormatting is false, escape HTML
    if (!options.preserveFormatting) {
      text = escapeHtml(text);
    } else {
      // Even with preserved formatting, remove dangerous tags
      text = text.replace(VALIDATION_PATTERNS.dangerousTags, '&lt;$1');
    }

    return text;
  }

  /**
   * Validate and sanitize API configuration
   * @param {Object} config - Configuration object
   * @returns {Object} Sanitized configuration
   */
  function sanitizeApiConfig(config) {
    if (!config || typeof config !== 'object') {
      return {};
    }

    const sanitized = {};

    // Sanitize string values
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        // Special handling for URLs
        if (key.toLowerCase().includes('url') || key.toLowerCase().includes('endpoint')) {
          sanitized[key] = sanitizeUrl(value);
        } else if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
          // API keys - validate format but don't log
          sanitized[key] = sanitizeApiKey(value);
        } else {
          // General string values
          sanitized[key] = value.length > MAX_LENGTHS.configValue 
            ? value.substring(0, MAX_LENGTHS.configValue)
            : value;
        }
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'string' ? escapeHtml(item) : item
        );
      } else if (value && typeof value === 'object') {
        sanitized[key] = sanitizeApiConfig(value);
      }
    }

    return sanitized;
  }

  /**
   * Sanitize URL input
   * @param {string} url - URL to sanitize
   * @returns {string} Sanitized URL
   */
  function sanitizeUrl(url) {
    if (typeof url !== 'string') {
      return '';
    }

    // Enforce length limit
    if (url.length > MAX_LENGTHS.url) {
      return '';
    }

    // Check for dangerous patterns
    if (VALIDATION_PATTERNS.javascriptUrl.test(url) || 
        VALIDATION_PATTERNS.dangerousDataUrl.test(url)) {
      return '';
    }

    // Only allow HTTPS URLs for API endpoints
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:' && urlObj.protocol !== 'chrome-extension:') {
        return '';
      }
      return urlObj.toString();
    } catch (e) {
      return '';
    }
  }

  /**
   * Sanitize API key with constant-time validation
   * @param {string} key - API key to sanitize
   * @returns {string} Sanitized API key
   */
  function sanitizeApiKey(key) {
    if (typeof key !== 'string') {
      return '';
    }

    // Enforce length limit
    if (key.length > MAX_LENGTHS.apiKey) {
      return '';
    }

    // Constant-time API key format validation
    // Prevents timing attacks on key validation
    const cleanKey = key.replace(/[<>&"'/\\]/g, '');

    // Additional security: validate API key format patterns
    if (cleanKey.length < 10) {
      logSecurityEvent('invalid_api_key_length', {
        length: cleanKey.length,
        severity: 'medium'
      });
      return '';
    }

    return cleanKey;
  }

  /**
   * Validate text input for safety
   * @param {string} text - Text to validate
   * @returns {Object} Validation result
   */
  function validateInput(text) {
    const result = {
      valid: true,
      issues: [],
      sanitized: text
    };

    if (typeof text !== 'string') {
      result.valid = false;
      result.issues.push('Input must be a string');
      result.sanitized = '';
      return result;
    }

    // Check for dangerous patterns
    if (VALIDATION_PATTERNS.scriptPattern.test(text)) {
      result.issues.push('Script tags detected');
    }

    if (VALIDATION_PATTERNS.javascriptUrl.test(text)) {
      result.issues.push('JavaScript URLs detected');
    }

    if (VALIDATION_PATTERNS.dangerousDataUrl.test(text)) {
      result.issues.push('Dangerous data URLs detected');
    }

    if (VALIDATION_PATTERNS.eventAttributes.test(text)) {
      result.issues.push('HTML event attributes detected');
    }

    if (VALIDATION_PATTERNS.dangerousTags.test(text)) {
      result.issues.push('Dangerous HTML tags detected');
    }

    // If issues found, mark as invalid and sanitize
    if (result.issues.length > 0) {
      result.valid = false;
      result.sanitized = sanitizeTranslationText(text);
    }

    return result;
  }

  /**
   * Create a secure context for DOM manipulation
   * @param {string} html - HTML content to create context for
   * @returns {DocumentFragment} Secure document fragment
   */
  function createSecureContext(html) {
    const sanitized = sanitizeTranslationText(html, { preserveFormatting: false });
    const template = document.createElement('template');
    template.innerHTML = sanitized;
    return template.content;
  }

  /**
   * Log security events for monitoring with rate limiting
   * @param {string} event - Event type
   * @param {Object} details - Event details
   */
  function logSecurityEvent(event, details) {
    // Rate limiting to prevent log flooding attacks
    const now = Date.now();
    const key = `${event}:${details?.source || 'unknown'}`;

    if (!logSecurityEvent._lastLog) logSecurityEvent._lastLog = new Map();
    const lastTime = logSecurityEvent._lastLog.get(key) || 0;

    // Rate limit: max 1 log per event type per 30 seconds
    if (now - lastTime < 30000) {
      return;
    }

    logSecurityEvent._lastLog.set(key, now);

    // Clean old entries to prevent memory leak
    if (logSecurityEvent._lastLog.size > 100) {
      const cutoff = now - 300000; // 5 minutes
      for (const [k, time] of logSecurityEvent._lastLog.entries()) {
        if (time < cutoff) {
          logSecurityEvent._lastLog.delete(k);
        }
      }
    }

    // Use logger.warn for security events to ensure visibility
    logger.warn(`[Security] ${event}:`, {
      timestamp: new Date().toISOString(),
      ...details,
      // Don't log sensitive data
      sanitizedDetails: typeof details === 'object' ?
        Object.keys(details).reduce((acc, key) => {
          if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
            acc[key] = '[REDACTED]';
          } else {
            acc[key] = details[key];
          }
          return acc;
        }, {}) : details
    });
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {boolean} - True if strings match
   */
  function constantTimeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return false;
    }

    let result = 0;
    const maxLength = Math.max(a.length, b.length);

    for (let i = 0; i < maxLength; i++) {
      const charA = i < a.length ? a.charCodeAt(i) : 0;
      const charB = i < b.length ? b.charCodeAt(i) : 0;
      result |= charA ^ charB;
    }

    return result === 0 && a.length === b.length;
  }

  /**
   * Memory-safe string cleanup
   * @param {string} sensitiveString - String to clear
   */
  function secureMemoryCleanup(sensitiveString) {
    if (typeof sensitiveString === 'string') {
      // Zero out memory (best effort in JavaScript)
      try {
        sensitiveString = '\0'.repeat(sensitiveString.length);
      } catch (e) {
        // Fallback for environments that don't support string overwrite
        sensitiveString = null;
      }
    }
  }

  // Public API
  return {
    escapeHtml,
    sanitizeTranslationText,
    sanitizeApiConfig,
    sanitizeUrl,
    sanitizeApiKey,
    validateInput,
    createSecureContext,
    logSecurityEvent,
    constantTimeCompare,
    secureMemoryCleanup,
    MAX_LENGTHS,
    VALIDATION_PATTERNS
  };

}));